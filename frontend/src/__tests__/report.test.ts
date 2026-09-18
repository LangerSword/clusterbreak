import { describe, expect, it } from "vitest";
import { DEVICES, MODELS, createRun } from "../sim";
import { buildReportPayload } from "../report";

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

function playRun(deviceCount: number) {
  const m = model("llama3.3_70b");
  const nodes = Array.from({ length: deviceCount }, (_, i) => ({
    id: `n${i}`,
    device: device("rtx3090_24gb"),
  }));
  const run = createRun({
    nodes,
    links: [],
    model: m,
    quant: "q4_k_m",
    contextStart: 1024,
    maxTokens: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { m, nodes, run };
}

describe("buildReportPayload", () => {
  it("builds a v1 payload with the required shape", () => {
    const { m, nodes, run } = playRun(2);
    const payload = buildReportPayload({
      nodes: nodes.map((n) => ({ device: n.device, fitted: true })),
      links: [{ gbps: 10 }],
      model: m,
      quant: "q4_k_m",
      contextTokens: 1024,
      footprintGb: 42.9,
      run,
      verdict: "RIG 2×3090",
      preset: "dual-3090",
      unpluggedNames: [],
    });
    expect(payload.v).toBe(1);
    expect(payload.preset).toBe("dual-3090");
    expect(payload.rig.nodes).toHaveLength(2);
    expect(payload.rig.totalCapacityGb).toBeCloseTo(47.0, 1);
    expect(payload.outcome.status).toBe(run.status);
    expect(typeof payload.outcome.tokensPerSec).toBe("number");
    expect(payload.verdict).toBe("RIG 2×3090");
    expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
  });

  it("clamps to the API's bounds: ≤8 nodes, ≤16 links, verdict ≤2000, all under 8 KB", () => {
    const { m, nodes, run } = playRun(8);
    const payload = buildReportPayload({
      nodes: [...nodes, ...nodes.slice(0, 3)].map((n) => ({ device: n.device, fitted: false })),
      links: Array.from({ length: 24 }, () => ({ gbps: 1 })),
      model: m,
      quant: "q4_k_m",
      contextTokens: 1024,
      footprintGb: null,
      run,
      verdict: "x".repeat(5000),
      preset: null,
      unpluggedNames: Array.from({ length: 12 }, (_, i) => `device ${i}`),
    });
    expect(payload.rig.nodes.length).toBeLessThanOrEqual(8);
    expect(payload.rig.links.length).toBeLessThanOrEqual(16);
    expect(payload.verdict.length).toBeLessThanOrEqual(2000);
    expect(payload.outcome.unplugged.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(payload).length).toBeLessThan(8192);
    expect(payload.model.footprintGb).toBeUndefined();
    expect(payload.preset).toBeUndefined();
  });

  it("omits death cleanly for a running state", () => {
    // 2×3090 holds 70B Q4 (42.9 ≤ 47.0) → runs; 1×3090 would be dead on arrival,
    // so use the running configuration for this check.
    const { m, nodes, run } = playRun(2);
    const payload = buildReportPayload({
      nodes: nodes.map((n) => ({ device: n.device, fitted: true })),
      links: [{ gbps: 10 }],
      model: m,
      quant: "q4_k_m",
      contextTokens: 512,
      footprintGb: 42.9,
      run,
      verdict: null,
      preset: null,
      unpluggedNames: [],
    });
    expect(payload.outcome.status).toBe("running");
    expect(payload.outcome.death).toBeNull();
    expect(payload.verdict).toBe("no verdict");
  });
});
