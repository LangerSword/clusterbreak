import type { Device, Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";
import { RUNTIME_RESERVE_GB, usableMemoryGb } from "./fit";
import { DEFAULT_LINK_GBPS, pipelineBreakdown, type PipelineStage } from "./pipeline";

/**
 * The run simulator: a deterministic token loop with fault injection.
 *
 * A run holds a rig (nodes + links), a model/quant, and a growing context.
 * Each `stepRun` advances simulated time by dtMs and generates tokens at the
 * current throughput; context grows by one token per generated token, so the
 * KV cache grows with it. Nodes are checked against their capacity (physical
 * memory minus the runtime reserve) — the run dies when a node's footprint
 * exceeds it, same rule the fit check and predictOomContext use. Faults
 * (unplug a node, throttle a link) recompute the
 * pipeline on the survivors.
 *
 * Everything here is pure: same inputs → same event timeline (tested).
 */

export interface RunNodeSpec {
  id: string;
  device: Device;
}

export interface RunLinkSpec {
  id: string;
  a: string;
  b: string;
  gbps: number;
}

export interface RunConfig {
  nodes: RunNodeSpec[];
  links: RunLinkSpec[];
  model: Model;
  quant: Quant;
  contextStart: number;
  maxTokens: number;
}

export type RunStatus = "running" | "dead" | "finished";

export interface RunEvent {
  atMs: number;
  kind: "start" | "fault" | "warn" | "death" | "finish";
  message: string;
}

export interface NodeMeter {
  nodeId: string;
  footprintGb: number;
  memGb: number;
  usableGb: number;
  /** footprint / physical memory — the number the meter bar shows. */
  vramPct: number;
  status: "ok" | "tight" | "overloaded";
}

export interface RunDeath {
  cause: string;
  detail: string;
  repairs: string[];
}

export interface RunState {
  config: RunConfig;
  status: RunStatus;
  simMs: number;
  tokens: number;
  contextTokens: number;
  tokensPerSec: number;
  transferMs: number;
  stages: PipelineStage[];
  meters: NodeMeter[];
  events: RunEvent[];
  unplugged: string[];
  warned: Record<string, boolean>;
  death?: RunDeath;
}

/** Per-hop link speed for a chain of node ids, using matching rig links (default 1 GbE). */
export function hopGbpsForChain(
  nodeIds: string[],
  links: { a: string; b: string; gbps: number }[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const a = nodeIds[i]!;
    const b = nodeIds[i + 1]!;
    const l = links.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    out.push(l ? l.gbps : DEFAULT_LINK_GBPS);
  }
  return out;
}

/**
 * Predict the context length (in tokens) at which the rig dies from KV-cache
 * growth: the first node whose footprint (weights share + KV share + runtime
 * reserve) outgrows its physical memory. `null` means no KV death within this
 * configuration (e.g. models with no KV traffic). Independent of `stepRun`,
 * computed analytically from the same accounting rules — the run simulator
 * must agree with it (see tests).
 */
export function predictOomContext(
  devices: Device[],
  model: Model,
  quant: Quant,
): number | null {
  if (devices.length === 0) return null;
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kvPerToken = kvBytesPerToken(model);
  if (kvPerToken === 0) return null;
  const usable = devices.map((d) => usableMemoryGb(d));
  const totalUsable = usable.reduce((a, b) => a + b, 0);

  let death: number | null = null;
  for (let i = 0; i < devices.length; i++) {
    const share = (usable[i] ?? 0) / totalUsable;
    // capacity already excludes the runtime reserve; the simulator's death rule
    // is: weights*share + KV*share + reserve > memory  ⇔  KV*share > capacity - weights*share
    const headroomBytes = usable[i]! * 1e9 - wb * share;
    const ctx = headroomBytes / (kvPerToken * share);
    const clamped = Math.max(0, ctx);
    if (death == null || clamped < death) death = clamped;
  }
  return death;
}

interface Throughput {
  tokensPerSec: number;
  transferMs: number;
  stages: PipelineStage[];
  meters: NodeMeter[];
  active: RunNodeSpec[];
}

function computeThroughput(state: RunState): Throughput {
  const active = state.config.nodes.filter((n) => !state.unplugged.includes(n.id));
  if (active.length === 0) {
    return { tokensPerSec: 0, transferMs: 0, stages: [], meters: [], active };
  }
  const wb = weightsBytes(state.config.model, state.config.quant);
  if (wb == null) {
    throw new Error(
      `No verified ${state.config.quant} size for ${state.config.model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kv = kvBytesPerToken(state.config.model) * state.contextTokens;
  const totalBytes = wb + kv;
  const usable = active.map((n) => usableMemoryGb(n.device));
  const totalUsable = usable.reduce((a, b) => a + b, 0);

  const meters: NodeMeter[] = active.map((n, i) => {
    const share = (usable[i] ?? 0) / totalUsable;
    const footprintGb = (totalBytes * share) / 1e9 + RUNTIME_RESERVE_GB;
    const usableGb = usable[i] ?? 0;
    return {
      nodeId: n.id,
      footprintGb,
      memGb: n.device.memoryGb,
      usableGb,
      vramPct: footprintGb / n.device.memoryGb,
      status:
        footprintGb > n.device.memoryGb ? "overloaded" : footprintGb > usableGb ? "tight" : "ok",
    };
  });

  const hopGbps = hopGbpsForChain(
    active.map((n) => n.id),
    state.config.links,
  );
  const { stages, transferMs, totalMs } = pipelineBreakdown(
    active.map((n) => n.device),
    state.config.model,
    state.config.quant,
    state.contextTokens,
    hopGbps,
  );

  return { tokensPerSec: 1000 / totalMs, transferMs, stages, meters, active };
}

function nodeName(state: RunState, nodeId: string): string {
  return state.config.nodes.find((n) => n.id === nodeId)?.device.name ?? nodeId;
}

function deadState(state: RunState, t: Throughput, death: RunDeath): RunState {
  return {
    ...state,
    status: "dead",
    tokensPerSec: 0,
    transferMs: t.transferMs,
    stages: t.stages,
    meters: t.meters,
    death,
    events: [
      ...state.events,
      { atMs: state.simMs, kind: "death", message: `run ended — ${death.cause}` },
    ],
  };
}

export function createRun(config: RunConfig): RunState {
  const state: RunState = {
    config,
    status: "running",
    simMs: 0,
    tokens: 0,
    contextTokens: config.contextStart,
    tokensPerSec: 0,
    transferMs: 0,
    stages: [],
    meters: [],
    events: [
      {
        atMs: 0,
        kind: "start",
        message: `run started — ${config.model.name} ${config.quant.toUpperCase()} @ ${config.contextStart} ctx on ${config.nodes.length} node(s)`,
      },
    ],
    unplugged: [],
    warned: {},
  };
  const t = computeThroughput(state);
  const overloaded = t.meters.find((m) => m.status === "overloaded");
  if (overloaded) {
    return deadState(state, t, {
      cause: `model does not fit — ${nodeName(state, overloaded.nodeId)} is out of VRAM before token one`,
      detail: `${nodeName(state, overloaded.nodeId)} needs ${overloaded.footprintGb.toFixed(2)} GB at ${config.contextStart} ctx but has ${overloaded.memGb} GB.`,
      repairs: [
        "use a smaller quantization",
        "reduce the starting context",
        "add another node to split the weights",
      ],
    });
  }
  return { ...state, tokensPerSec: t.tokensPerSec, transferMs: t.transferMs, stages: t.stages, meters: t.meters };
}

export function stepRun(state: RunState, dtMs: number): RunState {
  if (state.status !== "running") return state;
  const t = computeThroughput(state);

  const overloaded = t.meters.find((m) => m.status === "overloaded");
  if (overloaded) {
    return deadState(state, t, {
      cause: `VRAM exhausted on ${nodeName(state, overloaded.nodeId)}`,
      detail: `At ${state.contextTokens} tokens of context the node needed ${overloaded.footprintGb.toFixed(2)} GB but has ${overloaded.memGb} GB — the KV cache grew with the context until it didn't fit.`,
      repairs: [
        "cap or shorten the context",
        "use a smaller quantization",
        "split the model across more nodes",
      ],
    });
  }

  let events = state.events;
  let warned = state.warned;
  const tight = t.meters.find((m) => m.status === "tight" && !state.warned[m.nodeId]);
  if (tight) {
    warned = { ...warned, [tight.nodeId]: true };
    events = [
      ...events,
      {
        atMs: state.simMs,
        kind: "warn",
        message: `warning: ${nodeName(state, tight.nodeId)} at ${(tight.vramPct * 100).toFixed(0)}% VRAM — KV cache keeps growing with context`,
      },
    ];
  }

  const tokens = state.tokens + (t.tokensPerSec * dtMs) / 1000;
  const simMs = state.simMs + dtMs;
  const contextTokens = state.config.contextStart + Math.floor(tokens);

  if (tokens >= state.config.maxTokens) {
    return {
      ...state,
      tokens,
      simMs,
      contextTokens,
      tokensPerSec: t.tokensPerSec,
      transferMs: t.transferMs,
      stages: t.stages,
      meters: t.meters,
      warned,
      status: "finished",
      events: [
        ...events,
        {
          atMs: simMs,
          kind: "finish",
          message: `finished — ${Math.floor(tokens)} tokens generated, final throughput ${t.tokensPerSec.toFixed(1)} tok/s`,
        },
      ],
    };
  }

  return {
    ...state,
    tokens,
    simMs,
    contextTokens,
    tokensPerSec: t.tokensPerSec,
    transferMs: t.transferMs,
    stages: t.stages,
    meters: t.meters,
    warned,
    events,
  };
}

export function applyUnplug(state: RunState, nodeId: string): RunState {
  if (state.status !== "running") return state;
  if (state.unplugged.includes(nodeId)) return state;
  const unplugged = [...state.unplugged, nodeId];
  let next: RunState = {
    ...state,
    unplugged,
    events: [
      ...state.events,
      {
        atMs: state.simMs,
        kind: "fault",
        message: `fault injected: node unplugged — ${nodeName(state, nodeId)}`,
      },
    ],
  };
  const t = computeThroughput(next);
  if (t.active.length === 0) {
    return deadState(next, t, {
      cause: "all nodes unplugged — nothing left to compute on",
      detail: "The cluster has no remaining hardware.",
      repairs: ["this one is on you"],
    });
  }
  const overloaded = t.meters.find((m) => m.status === "overloaded");
  if (overloaded) {
    return deadState(next, t, {
      cause: `model no longer fits after unplugging ${nodeName(state, nodeId)}`,
      detail: `The survivors must hold the full model now: ${nodeName(next, overloaded.nodeId)} needs ${overloaded.footprintGb.toFixed(2)} GB but has ${overloaded.memGb} GB.`,
      repairs: [
        "unplug less than this",
        "use a smaller quantization so the survivors fit it",
        "keep a spare node in the rig",
      ],
    });
  }
  next = {
    ...next,
    tokensPerSec: t.tokensPerSec,
    transferMs: t.transferMs,
    stages: t.stages,
    meters: t.meters,
    events: [
      ...next.events,
      {
        atMs: state.simMs,
        kind: "fault",
        message: `survivors re-sharded — throughput now ${t.tokensPerSec.toFixed(1)} tok/s`,
      },
    ],
  };
  return next;
}

export function applyThrottle(state: RunState, linkId: string, gbps: number): RunState {
  if (state.status !== "running") return state;
  const link = state.config.links.find((l) => l.id === linkId);
  if (!link || link.gbps === gbps) return state;
  const links = state.config.links.map((l) => (l.id === linkId ? { ...l, gbps } : l));
  const next: RunState = {
    ...state,
    config: { ...state.config, links },
    events: [
      ...state.events,
      {
        atMs: state.simMs,
        kind: "fault",
        message: `fault injected: link throttled to ${gbps} Gbps`,
      },
    ],
  };
  const t = computeThroughput(next);
  return {
    ...next,
    tokensPerSec: t.tokensPerSec,
    transferMs: t.transferMs,
    stages: t.stages,
    meters: t.meters,
    events: [
      ...next.events,
      {
        atMs: state.simMs,
        kind: "fault",
        message: `throughput now ${t.tokensPerSec.toFixed(1)} tok/s (transfer ${t.transferMs.toFixed(2)} ms/token)`,
      },
    ],
  };
}
