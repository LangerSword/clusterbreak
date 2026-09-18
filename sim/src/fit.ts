import type { Device, FitStatus, Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";

/**
 * Weight-fit accounting — one convention, shared with the run simulator.
 *
 * A device never offers its full nominal memory to weights: driver and runtime
 * overhead consume a fixed reservation (0.5 GB per device). The run simulator
 * (run.ts) uses the same reserve, so a rig's FIT verdict and its RUN behaviour
 * cannot disagree — a flat percentage of memory was tried first and proved
 * wrong: it declared 2× RTX 3090 "cannot fit" a 70B Q4 while the measured
 * benchmark campaign runs exactly that configuration (anchors A3/A4).
 *
 * Consistent split: device capacity = memory − reserve; requested footprint =
 * weights + KV at the configured context. With shares taken over capacity, the
 * aggregate check (Σcapacity vs weights+KV) and the per-node run rule are
 * algebraically the same statement.
 */

export const RUNTIME_RESERVE_GB = 0.5;

/**
 * Free headroom (GB) below which a fit is "tight". Real workloads need room
 * for KV-cache growth and runtime workspace, so "comfortable" requires >= 30%
 * of capacity free (with an absolute floor for tiny devices). Calibrated to
 * keep the researched verdicts under the unified physical accounting — e.g. a
 * 138GB model on 192GB unified memory is tight, not comfortable.
 */
function tightThresholdGb(capacityGb: number): number {
  return Math.max(1.5, 0.3 * capacityGb);
}

export function usableMemoryGb(device: Device): number {
  return Math.max(0, device.memoryGb - RUNTIME_RESERVE_GB);
}

export function footprintGb(model: Model, quant: Quant, contextTokens = 0): number {
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kvGb = (kvBytesPerToken(model) * contextTokens) / 1e9;
  return wb / 1e9 + kvGb;
}

export function fitStatus(
  device: Device,
  model: Model,
  quant: Quant,
  contextTokens = 0,
): FitStatus {
  return fitStatusForCapacity(usableMemoryGb(device), model, quant, contextTokens);
}

/** The same verdict rule against an arbitrary usable capacity (e.g. a whole cluster's). */
export function fitStatusForCapacity(
  capacityGb: number,
  model: Model,
  quant: Quant,
  contextTokens = 0,
): FitStatus {
  const footprint = footprintGb(model, quant, contextTokens);
  if (footprint > capacityGb) return "does_not_fit";
  return capacityGb - footprint < tightThresholdGb(capacityGb) ? "tight" : "comfortable";
}
