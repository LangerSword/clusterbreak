import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import { estimateDecode } from "../decode";
import { estimatePipeline } from "../pipeline";

/**
 * Multi-node pipeline anchors (from the calibration research):
 *   A3  Llama 3 8B Q4_K_M, RTX 3090×2  → 108.07 tok/s (±18%; multi-GPU overhead must not improve over single)
 *   A4  Llama 3 70B Q4_K_M, RTX 3090×2 →  16.29 tok/s (±20%)
 */

const CTX = 1024;

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

function expectWithinPct(actual: number, target: number, pct: number) {
  const rel = Math.abs(actual - target) / target;
  expect(
    rel,
    `${actual.toFixed(2)} vs ${target} (rel ${(rel * 100).toFixed(1)}%, band ±${pct}%)`,
  ).toBeLessThanOrEqual(pct / 100);
}

describe("multi-node pipeline anchors", () => {
  it("A3: Llama 3 8B Q4_K_M on RTX 3090×2 reproduces 108.07 tok/s within ±18%", () => {
    const est = estimatePipeline(
      [device("rtx3090_24gb"), device("rtx3090_24gb")],
      model("llama3.1_8b"),
      "q4_k_m",
      CTX,
    );
    expectWithinPct(est.tokensPerSec, 108.07, 18);
  });

  it("A4: Llama 3 70B Q4_K_M on RTX 3090×2 reproduces 16.29 tok/s within ±20%", () => {
    const est = estimatePipeline(
      [device("rtx3090_24gb"), device("rtx3090_24gb")],
      model("llama3.3_70b"),
      "q4_k_m",
      CTX,
    );
    expectWithinPct(est.tokensPerSec, 16.29, 20);
  });

  it("multi-node overhead must not improve over single node (A3 note, budget-independent)", () => {
    const single = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    const pair = estimatePipeline(
      [device("rtx3090_24gb"), device("rtx3090_24gb")],
      model("llama3.1_8b"),
      "q4_k_m",
      CTX,
    );
    expect(pair.tokensPerSec).toBeLessThan(single.tokensPerSec);
  });

  it("single-device pipeline equals single-device decode exactly", () => {
    const p = estimatePipeline([device("rtx3090_24gb")], model("llama3.1_8b"), "q4_k_m", CTX);
    const dec = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    expect(p.tokensPerSec).toBeCloseTo(dec.tokensPerSec, 6);
  });

  it("adding a stage divides the weight read time between stages (30B-class on 3090+5090 beats 3090 alone)", () => {
    const one = estimatePipeline([device("rtx3090_24gb")], model("qwen3.5_35b_a3b"), "q4_k_m", CTX);
    const two = estimatePipeline(
      [device("rtx3090_24gb"), device("rtx5090_32gb")],
      model("qwen3.5_35b_a3b"),
      "q4_k_m",
      CTX,
    );
    expect(two.tokensPerSec).toBeGreaterThan(one.tokensPerSec);
  });
});
