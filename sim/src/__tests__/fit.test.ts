import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import { fitStatus, footprintGb, usableMemoryGb } from "../fit";

/**
 * Fit sanity checks — mirrors the observed fit table from the calibration
 * research (requested footprint vs capacity, where capacity = memory − a
 * 0.5 GB/device runtime reserve and footprint = weights + KV at context).
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

describe("fit status against researched fit checks", () => {
  it("RTX 3050 4GB + Qwen3.5-4B Q4_K_M → tight (only ~0.5GB headroom after reserve)", () => {
    expect(fitStatus(device("rtx3050_laptop_4gb"), model("qwen3.5_4b"), "q4_k_m")).toBe("tight");
  });

  it("RTX 5060 8GB + Qwen3.5-4B Q4_K_M → comfortable", () => {
    expect(fitStatus(device("rtx5060_laptop_8gb"), model("qwen3.5_4b"), "q4_k_m")).toBe("comfortable");
  });

  it("RTX 3060 12GB + Llama-3.1-8B Q4_K_M → comfortable", () => {
    expect(fitStatus(device("rtx3060_12gb"), model("llama3.1_8b"), "q4_k_m")).toBe("comfortable");
  });

  it("RTX 3090 24GB + Qwen3-32B Q4_K_M → tight (borderline in research)", () => {
    expect(fitStatus(device("rtx3090_24gb"), model("qwen3_32b"), "q4_k_m")).toBe("tight");
  });

  it("RTX 5090 32GB + Llama-3.3-70B Q4_K_M → does_not_fit (weights alone exceed usable VRAM)", () => {
    expect(fitStatus(device("rtx5090_32gb"), model("llama3.3_70b"), "q4_k_m")).toBe("does_not_fit");
  });

  it("M2 Ultra 192GB + MiniMax-M2.5 Q4_K_M → tight but fits (169GB usable)", () => {
    expect(fitStatus(device("apple_m2_ultra_192gb"), model("minimax_m2.5"), "q4_k_m")).toBe("tight");
  });
});

describe("fit accounting numerics", () => {
  it("usable memory = physical − 0.5 GB runtime reserve", () => {
    expect(usableMemoryGb(device("rtx3090_24gb"))).toBeCloseTo(23.5, 6);
    expect(usableMemoryGb(device("rtx3050_laptop_4gb"))).toBeCloseTo(3.5, 6);
  });

  it("footprint = weights + KV, growing with context", () => {
    const base = footprintGb(model("llama3.1_8b"), "q4_k_m", 0);
    const long = footprintGb(model("llama3.1_8b"), "q4_k_m", 8192);
    expect(base).toBeCloseTo(4.92, 6);
    expect(long).toBeGreaterThan(base);
  });
});
