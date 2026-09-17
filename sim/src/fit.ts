import type { Device, FitStatus, Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";

/**
 * Weight-fit accounting.
 *
 * A device never offers its full nominal memory to weights: display, driver and
 * runtime overhead consume a reservation. The fraction below (12%) follows the
 * conservative rule used in the calibration research; "tight" cases are flagged
 * rather than silently passed, and KV cache at the configured context is
 * included when a context length is provided.
 */

export const USABLE_MEMORY_FRACTION = 0.88;
export const RUNTIME_RESERVE_GB = 0.5;

/**
 * Free headroom (GB) below which a fit is "tight". Scales with device class:
 * real workloads need room for KV-cache growth and runtime workspace, so a
 * "comfortable" verdict requires >= 20% of usable memory free (with an absolute
 * floor for tiny devices). Calibrated against the researched fit verdicts —
 * e.g. a 138GB model on 169GB usable unified memory (192GB machine) is tight,
 * not comfortable.
 */
function tightThresholdGb(device: Device): number {
  return Math.max(1.5, 0.2 * usableMemoryGb(device));
}

export function usableMemoryGb(device: Device): number {
  return device.memoryGb * USABLE_MEMORY_FRACTION;
}

export function footprintGb(model: Model, quant: Quant, contextTokens = 0): number {
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kvGb = (kvBytesPerToken(model) * contextTokens) / 1e9;
  return wb / 1e9 + RUNTIME_RESERVE_GB + kvGb;
}

export function fitStatus(
  device: Device,
  model: Model,
  quant: Quant,
  contextTokens = 0,
): FitStatus {
  const usable = usableMemoryGb(device);
  const footprint = footprintGb(model, quant, contextTokens);
  if (footprint > usable) return "does_not_fit";
  return usable - footprint < tightThresholdGb(device) ? "tight" : "comfortable";
}
