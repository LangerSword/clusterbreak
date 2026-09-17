import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import { estimateDecode, kvBytesPerToken } from "../decode";
import type { Quant } from "../types";

/**
 * Calibration-anchor tests.
 *
 * Each anchor is a real, cited measurement (see docs/sources.md and the
 * calibration research). The engine must reproduce it inside the anchor's own
 * tolerance band. Anchor list carries over from the sim-physics research:
 *   A1  Llama 3 8B Q4_K_M, RTX 3090, ctx 1024 → 111.74 tok/s (±15%)
 *   A2  same, RTX 4090                        → 127.74 tok/s (±15%)
 *   A6  same, M2 Ultra 192GB                  →  76.28 tok/s (±18%)
 * (The benchmark campaign measures a generation of 1024 tokens; context is
 * modeled at 1024 accordingly.)
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
  expect(rel, `${actual.toFixed(2)} vs ${target} (rel ${(rel * 100).toFixed(1)}%, band ±${pct}%)`).toBeLessThanOrEqual(
    pct / 100,
  );
}

describe("calibration anchors", () => {
  it("A1: Llama 3 8B Q4_K_M on RTX 3090 reproduces 111.74 tok/s within ±15%", () => {
    const est = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    expectWithinPct(est.tokensPerSec, 111.74, 15);
    expect(est.efficiencyKind).toBe("fitted");
  });

  it("A2: same model on RTX 4090 reproduces 127.74 tok/s within ±15%", () => {
    const est = estimateDecode(device("rtx4090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    expectWithinPct(est.tokensPerSec, 127.74, 15);
  });

  it("A6: same model on M2 Ultra 192GB reproduces 76.28 tok/s within ±18%", () => {
    const est = estimateDecode(device("apple_m2_ultra_192gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    expectWithinPct(est.tokensPerSec, 76.28, 18);
  });

  it("negative control: an uncalibrated efficiency (1.0) is rejected by the A1 band — the tolerance has teeth", () => {
    const uncalibrated = { ...device("rtx3090_24gb"), decodeEfficiency: 1.0 };
    const est = estimateDecode(uncalibrated, model("llama3.1_8b"), "q4_k_m", CTX);
    const rel = Math.abs(est.tokensPerSec - 111.74) / 111.74;
    expect(rel).toBeGreaterThan(0.15);
  });
});

describe("KV math (exact, from model architecture)", () => {
  it("Llama-3.1-8B: 32 layers × 8 kv heads × 128 head dim × 2 × fp16 = 131072 bytes/token", () => {
    expect(kvBytesPerToken(model("llama3.1_8b"))).toBe(131072);
  });

  it("Qwen3.5-4B: 32 × 8 × 80 × 2 × fp16 = 81920 bytes/token", () => {
    expect(kvBytesPerToken(model("qwen3.5_4b"))).toBe(81920);
  });

  it("Qwen3-32B: 64 × 8 × 128 × 2 × fp16 = 262144 bytes/token", () => {
    expect(kvBytesPerToken(model("qwen3_32b"))).toBe(262144);
  });
});

describe("physics sanity (monotonicity)", () => {
  it("more bandwidth → more tokens/s on the same model", () => {
    const slow = estimateDecode(device("rtx4060_8gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    const fast = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    expect(fast.tokensPerSec).toBeGreaterThan(slow.tokensPerSec);
  });

  it("bigger model → fewer tokens/s on the same device", () => {
    const small = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    const big = estimateDecode(device("rtx3090_24gb"), model("llama3.3_70b"), "q4_k_m", CTX);
    expect(small.tokensPerSec).toBeGreaterThan(big.tokensPerSec);
  });

  it("longer context → more KV traffic → fewer tokens/s", () => {
    const shortCtx = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", 512);
    const longCtx = estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "q4_k_m", 8192);
    expect(shortCtx.tokensPerSec).toBeGreaterThan(longCtx.tokensPerSec);
  });

  it("quantization matters: q4_k_m beats q8_0 on the same device/model", () => {
    const q4 = estimateDecode(device("rtx3060_12gb"), model("llama3.1_8b"), "q4_k_m", CTX);
    const q8 = estimateDecode(device("rtx3060_12gb"), model("llama3.1_8b"), "q8_0", CTX);
    expect(q4.tokensPerSec).toBeGreaterThan(q8.tokensPerSec);
  });

  it("refuses to estimate when no verified weight size exists", () => {
    expect(() =>
      estimateDecode(device("rtx3090_24gb"), model("llama3.1_8b"), "bf16" as Quant, CTX),
    ).toThrow(/No verified/);
  });
});
