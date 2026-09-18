import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import { createRun, predictOomContext, stepRun } from "../run";

/**
 * The KV-death predictor must agree with the run simulator it front-runs:
 * walk a run forward until it dies and compare the context to the analytic
 * prediction.
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

describe("predictOomContext", () => {
  it("RTX 3090 + Qwen3-32B Q4_K_M: ~14.3K ctx (matches the run simulator's death)", () => {
    const devices = [device("rtx3090_24gb")];
    const m = model("qwen3_32b");
    const predicted = predictOomContext(devices, m, "q4_k_m");
    expect(predicted).not.toBeNull();
    expect(predicted! / 14267).toBeGreaterThan(0.98);
    expect(predicted! / 14267).toBeLessThan(1.02);

    // walk the simulator to its own death and compare (within 2%)
    let s = createRun({
      nodes: [{ id: "n0", device: device("rtx3090_24gb") }],
      links: [],
      model: m,
      quant: "q4_k_m",
      contextStart: 1024,
      maxTokens: 1e9,
    });
    for (let i = 0; i < 200000 && s.status === "running"; i++) s = stepRun(s, 500);
    expect(s.status).toBe("dead");
    expect(s.contextTokens / predicted!).toBeGreaterThan(0.98);
    expect(s.contextTokens / predicted!).toBeLessThan(1.02);
  });

  it("two 3090s sharing 70B: each node's share sets the wall (~13.7K ctx)", () => {
    const devices = [device("rtx3090_24gb"), device("rtx3090_24gb")];
    const predicted = predictOomContext(devices, model("llama3.3_70b"), "q4_k_m");
    expect(predicted).not.toBeNull();
    expect(predicted! / 13672).toBeGreaterThan(0.98);
    expect(predicted! / 13672).toBeLessThan(1.02);
  });

  it("orders predictions sensibly: bigger device class → later death", () => {
    const m = model("llama3.1_8b");
    const small = predictOomContext([device("rtx3050_laptop_4gb")], m, "q4_k_m");
    const big = predictOomContext([device("apple_m2_ultra_192gb")], m, "q4_k_m");
    expect(small).not.toBeNull();
    expect(big).not.toBeNull();
    expect(big!).toBeGreaterThan(small! * 10);
  });

  it("refuses (throws) when the model size is unverified", () => {
    expect(() => predictOomContext([device("rtx3090_24gb")], model("llama3.1_8b"), "bf16")).toThrow(
      /No verified/,
    );
  });
});
