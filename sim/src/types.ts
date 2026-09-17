/** Core types for the Clusterbreak simulation engine. */

export type Quant = "q4_k_m" | "q8_0" | "bf16";

export interface Device {
  id: string;
  name: string;
  vendor: "NVIDIA" | "Apple" | "AMD" | "Generic";
  memoryGb: number;
  /** Peak memory bandwidth in decimal GB/s. */
  bandwidthGbps: number;
  /**
   * Fitted decode efficiency of the peak bandwidth (0..1).
   * Present only when fitted from a measured calibration anchor.
   */
  decodeEfficiency?: number;
  /** What the fitted efficiency was computed from (anchor id + config). */
  efficiencyBasis?: string;
  /** Source URL for the memory/bandwidth numbers. */
  source: string;
  /** Provenance status string carried over from the data collection. */
  status: string;
}

export interface Model {
  id: string;
  name: string;
  totalParamsB: number;
  activeParamsB: number;
  layers: number;
  attentionHeads: number;
  /** Hidden size (model dimension) — activation vector width. */
  hiddenSize: number;
  kvHeads: number;
  headDim: number;
  /** Published GGUF file sizes in decimal GB; null = no verified size. */
  quantSizesGb: Record<Quant, number | null>;
  source: string;
  status: string;
}

export interface DecodeEstimate {
  tokensPerSec: number;
  bytesPerToken: number;
  effectiveBandwidthGbps: number;
  efficiency: number;
  efficiencyKind: "fitted" | "estimate";
  contextTokens: number;
}

export type FitStatus = "comfortable" | "tight" | "does_not_fit";
