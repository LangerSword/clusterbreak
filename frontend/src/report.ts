import type { Device, Model, Quant, RunState } from "./sim";

/**
 * Report payload — the compact, re-renderable summary of a finished run.
 * Bounded by design: the API rejects bodies over 8 KB, so this builder clamps
 * every field (nodes ≤ 8, links ≤ 16, verdict ≤ 2000 chars, string fields
 * truncated). Numbers are rounded to keep the payload small and tidy.
 */
export interface ReportPayload {
  v: 1;
  preset?: string;
  rig: {
    nodes: { device: string; memoryGb: number; bandwidthGbps: number; fitted: boolean }[];
    links: { gbps: number }[];
    totalCapacityGb: number;
  };
  model: { name: string; quant: Quant; contextTokens: number; footprintGb?: number };
  outcome: {
    status: string;
    tokensPerSec: number;
    death: { cause: string; detail: string } | null;
    unplugged: string[];
    totalTokens: number;
  };
  verdict: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildReportPayload(args: {
  nodes: { device: Device; fitted: boolean }[];
  links: { gbps: number }[];
  model: Model;
  quant: Quant;
  contextTokens: number;
  footprintGb: number | null;
  run: RunState;
  verdict: string | null;
  preset: string | null;
  unpluggedNames: string[];
}): ReportPayload {
  const totalCapacityGb = args.nodes.reduce(
    (a, n) => a + Math.max(0, n.device.memoryGb - 0.5),
    0,
  );
  return {
    v: 1,
    ...(args.preset ? { preset: args.preset } : {}),
    rig: {
      nodes: args.nodes.slice(0, 8).map((n) => ({
        device: n.device.name.slice(0, 80),
        memoryGb: r2(n.device.memoryGb),
        bandwidthGbps: r1(n.device.bandwidthGbps),
        fitted: n.fitted,
      })),
      links: args.links.slice(0, 16).map((l) => ({ gbps: l.gbps })),
      totalCapacityGb: r1(totalCapacityGb),
    },
    model: {
      name: args.model.name.slice(0, 120),
      quant: args.quant,
      contextTokens: Math.round(args.contextTokens),
      ...(args.footprintGb != null ? { footprintGb: r1(args.footprintGb) } : {}),
    },
    outcome: {
      status: args.run.status,
      tokensPerSec: r1(args.run.tokensPerSec),
      death: args.run.death
        ? { cause: args.run.death.cause.slice(0, 200), detail: args.run.death.detail.slice(0, 400) }
        : null,
      unplugged: args.unpluggedNames.slice(0, 8).map((s) => s.slice(0, 80)),
      totalTokens: Math.floor(args.run.tokens),
    },
    verdict: (args.verdict ?? "no verdict").slice(0, 2000),
  };
}
