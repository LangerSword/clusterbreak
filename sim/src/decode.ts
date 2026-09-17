import type { DecodeEstimate, Device, Model, Quant } from "./types";
import { DEFAULT_DECODE_EFFICIENCY } from "./data/devices";

/**
 * Decode-phase physics (v0, single device, batch 1).
 *
 * Decode is memory-bandwidth bound: every generated token requires reading the
 * model weights plus the KV cache for the whole context. The measured efficiency
 * of the peak bandwidth (`decodeEfficiency`) is fitted per device from published
 * calibration anchors where available (see devices.ts), otherwise the default
 * efficiency is used and flagged as an estimate.
 */

/** KV cache element size: fp16 = 2 bytes. */
export const KV_BYTES_PER_ELEMENT = 2;

/** Bytes of KV cache read per generated token at a given context length. */
export function kvBytesPerToken(model: Model): number {
  return 2 * model.layers * model.kvHeads * model.headDim * KV_BYTES_PER_ELEMENT;
}

/** Published weight size in bytes, or null when no verified size exists. */
export function weightsBytes(model: Model, quant: Quant): number | null {
  const gb = model.quantSizesGb[quant];
  return gb == null ? null : gb * 1e9;
}

export function estimateDecode(
  device: Device,
  model: Model,
  quant: Quant,
  contextTokens: number,
): DecodeEstimate {
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kvRead = kvBytesPerToken(model) * contextTokens;
  const bytesPerToken = wb + kvRead;
  const efficiency = device.decodeEfficiency ?? DEFAULT_DECODE_EFFICIENCY;
  const effectiveBandwidthGbps = device.bandwidthGbps * efficiency;
  return {
    tokensPerSec: (effectiveBandwidthGbps * 1e9) / bytesPerToken,
    bytesPerToken,
    effectiveBandwidthGbps,
    efficiency,
    efficiencyKind: device.decodeEfficiency != null ? "fitted" : "estimate",
    contextTokens,
  };
}
