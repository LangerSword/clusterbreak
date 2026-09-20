import { describe, expect, it } from "vitest";
import { DEVICES, MODELS, contextOptions, maxContextTokens, usableMemoryGb } from "../index";

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

describe("context options", () => {
  it("has a verified context limit for every model in the catalog", () => {
    for (const m of MODELS) {
      const max = maxContextTokens(m.id);
      expect(max, `${m.id} has no verified context length`).toBeTypeOf("number");
      expect(max!).toBeGreaterThan(0);
    }
  });

  it("offers 128K where the model and the memory both allow it", () => {
    const big = device("apple_m2_ultra_192gb");
    const opts = contextOptions(model("gemma3_27b"), "q4_k_m", usableMemoryGb(big));
    const o = opts.find((x) => x.value === 131072);
    expect(o, "128K should be an option").toBeTruthy();
    expect(o!.disabled).toBe(false);
    expect(o!.reason).toBe("ok");
  });

  it("refuses a window beyond the model's own limit, and says why", () => {
    // Qwen3-32B's GGUF metadata says 32,768 — 64K and 128K are not on offer for it
    const opts = contextOptions(model("qwen3_32b"), "q4_k_m", 192);
    for (const v of [65536, 131072]) {
      const o = opts.find((x) => x.value === v)!;
      expect(o.disabled).toBe(true);
      expect(o.reason).toBe("model-limit");
      expect(o.hint).toContain("32K");
    }
  });

  it("refuses a window the hardware cannot hold, and says what it would need", () => {
    const small = device("rtx3050_laptop_4gb");
    const opts = contextOptions(model("gemma3_27b"), "q4_k_m", usableMemoryGb(small));
    const o = opts.find((x) => x.value === 131072)!;
    expect(o.disabled).toBe(true);
    expect(o.reason).toBe("capacity");
    expect(o.hint).toMatch(/needs [\d.]+ GB/);
  });

  it("KV cost grows with the window, and 128K costs more than 8K", () => {
    const opts = contextOptions(model("gemma3_27b"), "q4_k_m", 192);
    const k8 = opts.find((x) => x.value === 8192)!;
    const k128 = opts.find((x) => x.value === 131072)!;
    expect(k128.kvGb).toBeGreaterThan(k8.kvGb);
    expect(k128.footprintGb).toBeGreaterThan(k8.footprintGb);
    expect(k8.kvGb).toBeGreaterThan(0);
  });

  it("every candidate option carries a label and a hint", () => {
    for (const o of contextOptions(model("qwen3.5_4b"), "q4_k_m", 192)) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
    }
  });
});
