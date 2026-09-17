import type { Device } from "../types";

/**
 * Device catalog.
 *
 * Memory/bandwidth values are vendor or community specifications with per-row
 * sources (see docs/sources.md). `decodeEfficiency` is fitted from measured
 * calibration anchors where a matching anchor exists (see wave4-B research);
 * devices without it fall back to DEFAULT_DECODE_EFFICIENCY and the UI must
 * mark those estimates as such.
 */

export const DEFAULT_DECODE_EFFICIENCY = 0.6;

export const DEVICES: Device[] = [
  {
    id: "rtx3050_laptop_4gb",
    name: "RTX 3050 Laptop GPU 4GB",
    vendor: "NVIDIA",
    memoryGb: 4,
    bandwidthGbps: 192,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-3050-mobile.c3788",
    status: "observed_bandwidth; uncertain_compute",
  },
  {
    id: "rtx3060_12gb",
    name: "RTX 3060 12GB",
    vendor: "NVIDIA",
    memoryGb: 12,
    bandwidthGbps: 360,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-3060-12-gb.c3682",
    status: "observed",
  },
  {
    id: "rtx4060_8gb",
    name: "RTX 4060 8GB",
    vendor: "NVIDIA",
    memoryGb: 8,
    bandwidthGbps: 272,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107",
    status: "observed",
  },
  {
    id: "rtx5060_laptop_8gb",
    name: "RTX 5060 Laptop GPU 8GB",
    vendor: "NVIDIA",
    memoryGb: 8,
    bandwidthGbps: 384,
    source: "https://www.nvidia.com/en-eu/geforce/laptops/50-series/",
    status: "observed_memory_bandwidth_power; compute_metric_mismatch",
  },
  {
    id: "rtx5070_12gb",
    name: "RTX 5070 12GB",
    vendor: "NVIDIA",
    memoryGb: 12,
    bandwidthGbps: 672,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/compare/",
    status: "observed_memory_power; compute_interpreted",
  },
  {
    id: "rtx5080_16gb",
    name: "RTX 5080 16GB",
    vendor: "NVIDIA",
    memoryGb: 16,
    bandwidthGbps: 960,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/compare/",
    status: "observed_memory_bandwidth_power; inferred_int",
  },
  {
    id: "rtx5090_32gb",
    name: "RTX 5090 32GB",
    vendor: "NVIDIA",
    memoryGb: 32,
    bandwidthGbps: 1792,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/",
    status: "observed_memory_bandwidth_power_compute; inferred_int",
  },
  {
    id: "rtx3090_24gb",
    name: "RTX 3090 24GB",
    vendor: "NVIDIA",
    memoryGb: 24,
    bandwidthGbps: 936,
    decodeEfficiency: 0.603,
    efficiencyBasis: "fitted from anchor A1 (Llama 3 8B Q4_K_M, ctx 1024, 111.74 tok/s)",
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-3090.c3622",
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx4090_24gb",
    name: "RTX 4090 24GB",
    vendor: "NVIDIA",
    memoryGb: 24,
    bandwidthGbps: 1008,
    decodeEfficiency: 0.641,
    efficiencyBasis: "fitted from anchor A2 (Llama 3 8B Q4_K_M, ctx 1024, 127.74 tok/s)",
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-4090.c3889",
    status: "observed; efficiency_fitted",
  },
  {
    id: "a100_80gb",
    name: "A100 80GB PCIe",
    vendor: "NVIDIA",
    memoryGb: 80,
    bandwidthGbps: 1935,
    source:
      "https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf",
    status: "observed_bandwidth_variant; compute_interpreted",
  },
  {
    id: "h100_80gb_sxm",
    name: "H100 80GB SXM",
    vendor: "NVIDIA",
    memoryGb: 80,
    bandwidthGbps: 3350,
    source: "https://www.nvidia.com/en-sg/data-center/h100/",
    status: "observed_advertised_tensor; sparse_convention",
  },
  {
    id: "apple_m1_pro_16gb",
    name: "Apple M1 Pro 16GB",
    vendor: "Apple",
    memoryGb: 16,
    bandwidthGbps: 200,
    source: "https://support.apple.com/en-us/111901",
    status: "observed_memory; inferred_compute",
  },
  {
    id: "apple_m4_max_64gb",
    name: "Apple M4 Max 64GB",
    vendor: "Apple",
    memoryGb: 64,
    bandwidthGbps: 546,
    source: "https://support.apple.com/en-us/121553",
    status: "observed_variant",
  },
  {
    id: "apple_m2_ultra_192gb",
    name: "Apple M2 Ultra 192GB",
    vendor: "Apple",
    memoryGb: 192,
    bandwidthGbps: 800,
    decodeEfficiency: 0.482,
    efficiencyBasis: "fitted from anchor A6 (Llama 3 8B Q4_K_M, ctx 1024, 76.28 tok/s)",
    source: "https://support.apple.com/en-us/111828",
    status: "observed_memory_bandwidth; efficiency_fitted",
  },
  {
    id: "steam_deck_16gb",
    name: "Steam Deck 16GB",
    vendor: "AMD",
    memoryGb: 16,
    bandwidthGbps: 88,
    source: "https://www.steamdeck.com/en/tech/detailed-specs",
    status: "observed; compute_estimate",
  },
  {
    id: "cpu_only_baseline",
    name: "CPU-only baseline",
    vendor: "Generic",
    memoryGb: 32,
    bandwidthGbps: 60,
    source: "https://github.com/ggml-org/llama.cpp/wiki/Performance",
    status: "inferred_simulator_baseline",
  },
];
