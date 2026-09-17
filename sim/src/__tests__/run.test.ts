import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import {
  applyThrottle,
  applyUnplug,
  createRun,
  stepRun,
  type RunState,
} from "../run";

/**
 * Run-simulator tests: deterministic token loop, context growth, fault
 * injection, death detection. Numbers are checked against the same calibrated
 * physics as the anchor tests.
 */

function device(id: string) {
  const d = DEVICES.find((x) => x.id === id);
  if (!d) throw new Error(`device ${id} missing`);
  return d;
}

function model(id: string) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`model ${id} missing`);
  return m;
}

function rig(nodeIds: string[], links: [number, number, number][] = []) {
  return {
    nodes: nodeIds.map((id, i) => ({
      id: `n${i}`,
      device: device(id),
    })),
    links: links.map(([ai, bi, gbps], i) => ({ id: `l${i}`, a: `n${ai}`, b: `n${bi}`, gbps })),
  };
}

function makeRun(over: Partial<Parameters<typeof createRun>[0]> = {}): RunState {
  const base = rig(["rtx3090_24gb"]);
  return createRun({
    nodes: base.nodes,
    links: base.links,
    model: model("llama3.1_8b"),
    quant: "q4_k_m",
    contextStart: 1024,
    maxTokens: 4096,
    ...over,
  });
}

function runFor(state: RunState, simSeconds: number, tickMs = 100): RunState {
  let s = state;
  const ticks = Math.round((simSeconds * 1000) / tickMs);
  for (let i = 0; i < ticks && s.status === "running"; i++) s = stepRun(s, tickMs);
  return s;
}

describe("run simulator", () => {
  it("single 3090 + Llama-3.1-8B generates at the calibrated ~111.7 tok/s", () => {
    const s = runFor(makeRun(), 10);
    expect(s.status).toBe("running");
    expect(s.tokensPerSec).toBeGreaterThan(111.74 * 0.97);
    expect(s.tokensPerSec).toBeLessThan(111.74 * 1.03);
    expect(s.tokens).toBeGreaterThan(1000);
  });

  it("context growth slows the run down (KV traffic)", () => {
    const s0 = makeRun();
    const early = s0.tokensPerSec;
    const late = runFor(s0, 200);
    expect(late.tokensPerSec).toBeLessThan(early);
  });

  it("finishes when maxTokens is reached", () => {
    const s = runFor(makeRun({ maxTokens: 200 }), 60);
    expect(s.status).toBe("finished");
    expect(s.tokens).toBeGreaterThanOrEqual(200);
    expect(s.events.some((e) => e.kind === "finish")).toBe(true);
  });

  it("dies when the KV cache outgrows the tight node — with a repair list", () => {
    const s = runFor(
      makeRun({ model: model("qwen3_32b"), contextStart: 1024, maxTokens: 100000 }),
      1200,
    );
    expect(s.status).toBe("dead");
    expect(s.death?.cause).toMatch(/VRAM exhausted/);
    expect(s.death?.repairs.length).toBeGreaterThanOrEqual(3);
    expect(s.events.some((e) => e.kind === "warn")).toBe(true);
    // roughly where the feet stop fitting: usable 21.12, base 20.26, kv 0.262 MB/token
    expect(s.contextTokens).toBeGreaterThan(9000);
    expect(s.contextTokens).toBeLessThan(16000);
  });

  it("unplugging the second node kills a 70B run whose weights no longer fit", () => {
    const base = rig(
      ["rtx3090_24gb", "rtx3090_24gb"],
      [[0, 1, 10]],
    );
    let s = createRun({
      nodes: base.nodes,
      links: base.links,
      model: model("llama3.3_70b"),
      quant: "q4_k_m",
      contextStart: 1024,
      maxTokens: 100000,
    });
    expect(s.status).toBe("running");
    s = runFor(s, 30);
    expect(s.status).toBe("running");
    s = applyUnplug(s, "n1");
    expect(s.status).toBe("dead");
    expect(s.death?.cause).toMatch(/no longer fits/);
  });

  it("unplugging one of three nodes keeps the run alive with recomputed throughput", () => {
    const base = rig(
      ["rtx3090_24gb", "rtx3090_24gb", "rtx3090_24gb"],
      [[0, 1, 10], [1, 2, 10]],
    );
    let s = createRun({
      nodes: base.nodes,
      links: base.links,
      model: model("qwen3.5_35b_a3b"),
      quant: "q4_k_m",
      contextStart: 1024,
      maxTokens: 100000,
    });
    expect(s.status).toBe("running");
    s = runFor(s, 20);
    const before = s.tokensPerSec;
    s = applyUnplug(s, "n2");
    expect(s.status).toBe("running");
    expect(s.tokensPerSec).toBeGreaterThan(0);
    expect(s.tokensPerSec).not.toBe(before);
    expect(s.events.some((e) => e.kind === "fault")).toBe(true);
  });

  it("throttling a link drops throughput (transfer time dominates)", () => {
    const base = rig(
      ["rtx3090_24gb", "rtx3090_24gb"],
      [[0, 1, 10]],
    );
    let s = createRun({
      nodes: base.nodes,
      links: base.links,
      model: model("llama3.1_8b"),
      quant: "q4_k_m",
      contextStart: 1024,
      maxTokens: 100000,
    });
    const fast = s.tokensPerSec;
    s = applyThrottle(s, "l0", 0.01);
    expect(s.tokensPerSec).toBeLessThan(fast);
    expect(s.transferMs).toBeGreaterThan(1);
  });

  it("is deterministic: identical inputs → identical timelines", () => {
    const a = runFor(makeRun({ maxTokens: 300 }), 100);
    const b = runFor(makeRun({ maxTokens: 300 }), 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("refuses to start when the model already does not fit", () => {
    const s = makeRun({ model: model("llama3.3_70b"), contextStart: 1024 });
    expect(s.status).toBe("dead");
    expect(s.death?.cause).toMatch(/does not fit/);
  });
});
