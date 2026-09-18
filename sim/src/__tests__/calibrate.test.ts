import { describe, expect, it } from "vitest";
import { DEVICES } from "../data/devices";
import { MODELS } from "../data/models";
import { fitEfficiencyFromMeasurement } from "../calibrate";

const llama = MODELS.find((m) => m.id === "llama3.1_8b")!;

function device(id: string) {
  const d = DEVICES.find((x) => x.id === id);
  if (!d) throw new Error(`device ${id} missing`);
  return d;
}

describe("user measurement fitting", () => {
  it("reproduces the RTX 3090 anchor efficiency from its measured 111.74 tok/s", () => {
    // The built-in pipeline fitted 0.603 from this exact measurement — the
    // user-facing fitter must produce the same number.
    const eff = fitEfficiencyFromMeasurement(111.74, 936, llama);
    expect(eff).toBeCloseTo(0.603, 3);
    expect(eff).toBeCloseTo(device("rtx3090_24gb").decodeEfficiency!, 2);
  });

  it("applies to a device the catalog has never seen (custom rig entry)", () => {
    const eff = fitEfficiencyFromMeasurement(90, 800, llama);
    // 90 tok/s on an 800 GB/s part is well above the 3090's 0.60-class fit
    expect(eff).toBeGreaterThan(0.4);
    expect(eff).toBeLessThan(0.9);
  });

  it("rejects nonsense measurements instead of calibrating on them", () => {
    expect(() => fitEfficiencyFromMeasurement(0, 936, llama)).toThrow();
    expect(() => fitEfficiencyFromMeasurement(111.74, 0, llama)).toThrow();
  });
});
