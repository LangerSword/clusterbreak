import type { Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";

/**
 * Calibration helpers for user-supplied hardware.
 *
 * A custom device can carry its own measured benchmark: run the standard probe
 * (Llama-3.1-8B-Instruct Q4_K_M, 1024-token generation — the same configuration
 * the built-in anchors use) and the app fits that device's decode efficiency
 * with the exact formula the data pipeline uses:
 *
 *   efficiency = measured_tok_s * bytes_per_token / peak_bandwidth_bytes
 *
 * Never a guess: the number the user measures is treated exactly like a
 * benchmark-campaign measurement.
 */

export const PROBE_CONTEXT_TOKENS = 1024;

export function bytesPerToken(model: Model, quant: Quant, contextTokens: number): number {
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  return wb + kvBytesPerToken(model) * contextTokens;
}

/**
 * Fit a device's decode efficiency from one measured tok/s figure on the
 * standard probe configuration.
 */
export function fitEfficiencyFromMeasurement(
  measuredTokS: number,
  bandwidthGbps: number,
  probeModel: Model,
  probeQuant: Quant = "q4_k_m",
  contextTokens: number = PROBE_CONTEXT_TOKENS,
): number {
  if (!(measuredTokS > 0)) throw new Error("measured tok/s must be positive");
  if (!(bandwidthGbps > 0)) throw new Error("bandwidth must be positive");
  const bpt = bytesPerToken(probeModel, probeQuant, contextTokens);
  return (measuredTokS * bpt) / (bandwidthGbps * 1e9);
}
