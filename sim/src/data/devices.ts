import type { Device } from "../types";
import efficienciesJson from "../../data/efficiencies.json";

/**
 * Device catalog.
 *
 * Memory/bandwidth values are vendor or community specifications with per-row
 * sources (see docs/data-report.md). Decode efficiencies are NOT hand-entered:
 * they are fitted from measured llama.cpp benchmark campaigns by
 * `tools/refresh_data.py` and read from `sim/data/efficiencies.json`. Devices
 * without a fitted efficiency get DEFAULT_DECODE_EFFICIENCY and the UI must
 * mark their numbers as unverified.
 */

export const DEFAULT_DECODE_EFFICIENCY = 0.6;

interface FittedRow {
  efficiency: number;
  measuredTokS: number;
  bandwidthGbps: number;
  bandwidthSource: string;
  basis: string;
}

const FITTED = efficienciesJson.devices as Record<string, FittedRow>;

type DeviceSeed = Omit<Device, "decodeEfficiency" | "efficiencyBasis">;

const TPU = "https://www.techpowerup.com/gpu-specs/";

const SEEDS: DeviceSeed[] = [
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
    status: "observed; no_measured_anchor_yet",
  },
  {
    id: "rtx3070_8gb",
    name: "RTX 3070 8GB",
    vendor: "NVIDIA",
    memoryGb: 8,
    bandwidthGbps: 448,
    source: `${TPU}geforce-rtx-3070 (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx3080_10gb",
    name: "RTX 3080 10GB",
    vendor: "NVIDIA",
    memoryGb: 10,
    bandwidthGbps: 760,
    source: `${TPU}geforce-rtx-3080 (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx3080_ti_12gb",
    name: "RTX 3080 Ti 12GB",
    vendor: "NVIDIA",
    memoryGb: 12,
    bandwidthGbps: 912,
    source: `${TPU}geforce-rtx-3080-ti (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx4060_8gb",
    name: "RTX 4060 8GB",
    vendor: "NVIDIA",
    memoryGb: 8,
    bandwidthGbps: 272,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107",
    status: "observed; no_measured_anchor_yet",
  },
  {
    id: "rtx4070ti_12gb",
    name: "RTX 4070 Ti 12GB",
    vendor: "NVIDIA",
    memoryGb: 12,
    bandwidthGbps: 504,
    source: `${TPU}geforce-rtx-4070-ti (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx4080_16gb",
    name: "RTX 4080 16GB",
    vendor: "NVIDIA",
    memoryGb: 16,
    bandwidthGbps: 717,
    source: `${TPU}geforce-rtx-4080 (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx5060_laptop_8gb",
    name: "RTX 5060 Laptop GPU 8GB",
    vendor: "NVIDIA",
    memoryGb: 8,
    bandwidthGbps: 384,
    source: "https://www.nvidia.com/en-eu/geforce/laptops/50-series/",
    status: "observed_memory_bandwidth_power; no_measured_anchor_yet",
  },
  {
    id: "rtx5070_12gb",
    name: "RTX 5070 12GB",
    vendor: "NVIDIA",
    memoryGb: 12,
    bandwidthGbps: 672,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/compare/",
    status: "observed_memory_power; no_measured_anchor_yet",
  },
  {
    id: "rtx5080_16gb",
    name: "RTX 5080 16GB",
    vendor: "NVIDIA",
    memoryGb: 16,
    bandwidthGbps: 960,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/compare/",
    status: "observed_memory_bandwidth_power; no_measured_anchor_yet",
  },
  {
    id: "rtx5090_32gb",
    name: "RTX 5090 32GB",
    vendor: "NVIDIA",
    memoryGb: 32,
    bandwidthGbps: 1792,
    source: "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/",
    status: "observed_memory_bandwidth_power; no_measured_anchor_yet",
  },
  {
    id: "rtx3090_24gb",
    name: "RTX 3090 24GB",
    vendor: "NVIDIA",
    memoryGb: 24,
    bandwidthGbps: 936,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-3090.c3622",
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx4090_24gb",
    name: "RTX 4090 24GB",
    vendor: "NVIDIA",
    memoryGb: 24,
    bandwidthGbps: 1008,
    source: "https://www.techpowerup.com/gpu-specs/geforce-rtx-4090.c3889",
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx4000_ada_20gb",
    name: "RTX 4000 Ada 20GB",
    vendor: "NVIDIA",
    memoryGb: 20,
    bandwidthGbps: 360,
    source: `${TPU}rtx-4000-ada-generation (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "rtx5000_ada_32gb",
    name: "RTX 5000 Ada 32GB",
    vendor: "NVIDIA",
    memoryGb: 32,
    bandwidthGbps: 576,
    source: `${TPU}rtx-5000-ada-generation (memory bandwidth)`,
    status: "observed; efficiency_fitted",
  },
  {
    id: "a100_pcie_80gb",
    name: "A100 80GB PCIe",
    vendor: "NVIDIA",
    memoryGb: 80,
    bandwidthGbps: 1935,
    source:
      "https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/a100/pdf/nvidia-a100-datasheet-us-nvidia-1758950-r4-web.pdf",
    status: "observed_bandwidth_variant; efficiency_fitted",
  },
  {
    id: "h100_pcie_80gb",
    name: "H100 80GB PCIe",
    vendor: "NVIDIA",
    memoryGb: 80,
    bandwidthGbps: 2039,
    source: "https://www.nvidia.com/en-sg/data-center/h100/ (PCIe variant)",
    status: "observed_bandwidth; efficiency_fitted",
  },
  {
    id: "apple_m1_pro_16gb",
    name: "Apple M1 Pro 16GB",
    vendor: "Apple",
    memoryGb: 16,
    bandwidthGbps: 200,
    source: "https://support.apple.com/en-us/111901",
    status: "observed_memory; no_measured_anchor_yet",
  },
  {
    id: "apple_m1_max_64gb",
    name: "Apple M1 Max 64GB",
    vendor: "Apple",
    memoryGb: 64,
    bandwidthGbps: 400,
    source: "https://support.apple.com/ (MacBook Pro 14/16 tech specs, 32-core GPU)",
    status: "observed_memory_bandwidth; efficiency_fitted",
  },
  {
    id: "apple_m4_max_64gb",
    name: "Apple M4 Max 64GB",
    vendor: "Apple",
    memoryGb: 64,
    bandwidthGbps: 546,
    source: "https://support.apple.com/en-us/121553",
    status: "observed_variant; no_measured_anchor_yet",
  },
  {
    id: "apple_m2_ultra_192gb",
    name: "Apple M2 Ultra 192GB",
    vendor: "Apple",
    memoryGb: 192,
    bandwidthGbps: 800,
    source: "https://support.apple.com/en-us/111828",
    status: "observed_memory_bandwidth; efficiency_fitted",
  },
  {
    id: "apple_m3_max_64gb",
    name: "Apple M3 Max 64GB",
    vendor: "Apple",
    memoryGb: 64,
    bandwidthGbps: 400,
    source: "https://support.apple.com/ (MacBook Pro tech specs, 40-core GPU)",
    status: "observed_memory_bandwidth; efficiency_fitted",
  },
  {
    id: "apple_m1_7core_8gb",
    name: "Apple M1 (7-core GPU) 8GB",
    vendor: "Apple",
    memoryGb: 8,
    bandwidthGbps: 68.25,
    source: "https://support.apple.com/ (M1 MacBook Air tech specs)",
    status: "observed_memory_bandwidth; efficiency_fitted",
  },
  {
    id: "steam_deck_16gb",
    name: "Steam Deck 16GB",
    vendor: "AMD",
    memoryGb: 16,
    bandwidthGbps: 88,
    source: "https://www.steamdeck.com/en/tech/detailed-specs",
    status: "observed; no_measured_anchor_yet",
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

export const DEVICES: Device[] = SEEDS.map((seed) => {
  const fit = FITTED[seed.id];
  return fit
    ? { ...seed, decodeEfficiency: fit.efficiency, efficiencyBasis: fit.basis }
    : seed;
});
