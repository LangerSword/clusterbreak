import type { Device, Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";
import { DEFAULT_DECODE_EFFICIENCY } from "./data/devices";

/**
 * Naive pipeline-parallel estimate (v0).
 *
 * Weights (and the KV traffic each stage reads) are split across the pipeline
 * proportional to each device's usable memory; per token every stage reads its
 * own share over its own bandwidth, and one activation vector per hop crosses
 * the link between consecutive stages. This deliberately simple model already
 * lands inside the published multi-node anchors' tolerance bands (see tests);
 * the network/interconnect refinement lands in a later iteration.
 */

export interface PipelineStage {
  deviceId: string;
  weightShareGb: number;
  stageTimeMs: number;
}

export interface PipelineEstimate {
  tokensPerSec: number;
  stages: PipelineStage[];
  transferMs: number;
  totalMs: number;
  linkBandwidthGbps: number;
  assumptions: string;
}

/** Conservative v0 assumption: a 1 GbE-class link between stages. */
export const DEFAULT_LINK_BANDWIDTH_GBPS = 1;

export function estimatePipeline(
  devices: Device[],
  model: Model,
  quant: Quant,
  contextTokens: number,
  linkBandwidthGbps = DEFAULT_LINK_BANDWIDTH_GBPS,
): PipelineEstimate {
  if (devices.length === 0) throw new Error("pipeline needs at least one device");
  const wb = weightsBytes(model, quant);
  if (wb == null) {
    throw new Error(
      `No verified ${quant} size for ${model.id} — refusing to estimate an unmeasured weight size.`,
    );
  }
  const kvTotal = kvBytesPerToken(model) * contextTokens;
  const usable = devices.map((d) => d.memoryGb * 0.88);
  const totalUsable = usable.reduce((a, b) => a + b, 0);

  const stages: PipelineStage[] = devices.map((d, i) => {
    const share = (usable[i] ?? 0) / totalUsable;
    const bytes = (wb + kvTotal) * share;
    const effBw = d.bandwidthGbps * (d.decodeEfficiency ?? DEFAULT_DECODE_EFFICIENCY) * 1e9;
    return {
      deviceId: d.id,
      weightShareGb: (wb * share) / 1e9,
      stageTimeMs: (bytes / effBw) * 1000,
    };
  });

  const activationBytes = model.hiddenSize * 2; // fp16 hidden state per token per hop
  const hops = devices.length - 1;
  const linkBytesPerSec = (linkBandwidthGbps * 1e9) / 8;
  const transferMs = ((activationBytes * hops) / linkBytesPerSec) * 1000;

  const totalMs = stages.reduce((a, s) => a + s.stageTimeMs, 0) + transferMs;
  return {
    tokensPerSec: 1000 / totalMs,
    stages,
    transferMs,
    totalMs,
    linkBandwidthGbps,
    assumptions:
      "Equal split by usable memory; per-stage KV reads included; fp16 activation per hop at the assumed link speed; batch 1.",
  };
}
