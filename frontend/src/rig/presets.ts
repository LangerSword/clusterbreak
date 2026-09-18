import type { Quant } from "../sim";
import type { Cell } from "./grid";

/** One-click rigs. Every device/model id must exist in the catalog. */

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  nodes: { deviceId: string; cell: Cell }[];
  links: { a: number; b: number; gbps: number }[];
  modelId: string;
  quant: Quant;
  contextTokens: number;
  tryThis: string;
}

export const PRESETS: Preset[] = [
  {
    id: "my-laptop",
    name: "This laptop · RTX 5060 8GB",
    blurb: "the machine this was built on",
    nodes: [{ deviceId: "rtx5060_laptop_8gb", cell: [0, 0] }],
    links: [],
    modelId: "llama3.1_8b",
    quant: "q4_k_m",
    contextTokens: 4096,
    tryThis: "raise the context and watch the VRAM meter fill",
  },
  {
    id: "two-laptops",
    name: "Two laptops · 5060 + 3050",
    blurb: "8GB + 4GB over a 1GbE link",
    nodes: [
      { deviceId: "rtx5060_laptop_8gb", cell: [0, 0] },
      { deviceId: "rtx3050_laptop_4gb", cell: [2, 0] },
    ],
    links: [{ a: 0, b: 1, gbps: 1 }],
    modelId: "qwen3.5_4b",
    quant: "q4_k_m",
    contextTokens: 4096,
    tryThis: "unplug the 5060 mid-run — watch the 3050 try to cope alone",
  },
  {
    id: "dual-3090",
    name: "Classic homelab · 2× RTX 3090",
    blurb: "the measured-anchor rig, 10GbE link",
    nodes: [
      { deviceId: "rtx3090_24gb", cell: [0, 0] },
      { deviceId: "rtx3090_24gb", cell: [2, 0] },
    ],
    links: [{ a: 0, b: 1, gbps: 10 }],
    modelId: "llama3.3_70b",
    quant: "q4_k_m",
    contextTokens: 1024,
    tryThis: "unplug one 3090 — the survivor can't hold 70B",
  },
  {
    id: "mac-studio",
    name: "Mac Studio · M2 Ultra 192GB",
    blurb: "big unified memory, one node",
    nodes: [{ deviceId: "apple_m2_ultra_192gb", cell: [0, 0] }],
    links: [],
    modelId: "minimax_m2.5",
    quant: "q4_k_m",
    contextTokens: 2048,
    tryThis: "a 138 GB model on 192 GB — find the context wall",
  },
  {
    id: "steam-deck",
    name: "Steam Deck",
    blurb: "16GB unified — the smallest rig",
    nodes: [{ deviceId: "steam_deck_16gb", cell: [0, 0] }],
    links: [],
    modelId: "qwen3.5_4b",
    quant: "q4_k_m",
    contextTokens: 2048,
    tryThis: "how long does a 4B model stay comfortable?",
  },
];
