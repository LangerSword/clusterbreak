import type { Device, Model, Quant } from "./types";
import { kvBytesPerToken, weightsBytes } from "./decode";
import { DEFAULT_DECODE_EFFICIENCY } from "./data/devices";

/**
 * Pipeline-parallel estimate (v0).
 *
 * Weights (and the KV traffic each stage reads) are split across the pipeline
 * proportional to each device's usable memory; per token every stage reads its
 * own share over its own bandwidth, and one fp16 activation vector per hop
 * crosses the link between consecutive stages. Deliberately simple, and it
 * lands inside the published multi-node anchors' tolerance bands (see tests).
 */

/** Conservative default: a 1 GbE-class link between stages. */
export const DEFAULT_LINK_GBPS = 1;

export interface PipelineStage {
  deviceId: string;
  weightShareGb: number;
  stageTimeMs: number;
}

export interface PipelineBreakdown {
  stages: PipelineStage[];
  transferMs: number;
  totalMs: number;
}

/**
 * Core pipeline math with per-hop link speeds. `hopGbps[i]` is the speed of
 * the link between device i and device i+1 (missing entries fall back to
 * DEFAULT_LINK_GBPS).
 */
export function pipelineBreakdown(
  devices: Device[],
  model: Model,
  quant: Quant,
  contextTokens: number,
  hopGbps: number[],
): PipelineBreakdown {
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
  let transferMs = 0;
  for (let i = 0; i < hops; i++) {
    const gbps = hopGbps[i] ?? DEFAULT_LINK_GBPS;
    transferMs += (activationBytes / ((gbps * 1e9) / 8)) * 1000;
  }

  const totalMs = stages.reduce((a, s) => a + s.stageTimeMs, 0) + transferMs;
  return { stages, transferMs, totalMs };
}

export interface PipelineEstimate {
  tokensPerSec: number;
  stages: PipelineStage[];
  transferMs: number;
  totalMs: number;
  linkBandwidthGbps: number;
  assumptions: string;
}

export function estimatePipeline(
  devices: Device[],
  model: Model,
  quant: Quant,
  contextTokens: number,
  linkBandwidthGbps = DEFAULT_LINK_GBPS,
): PipelineEstimate {
  const hops = Math.max(devices.length - 1, 0);
  const { stages, transferMs, totalMs } = pipelineBreakdown(
    devices,
    model,
    quant,
    contextTokens,
    Array.from({ length: hops }, () => linkBandwidthGbps),
  );
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
