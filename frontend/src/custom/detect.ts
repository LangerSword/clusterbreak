import { DEVICES, type Device } from "../sim";

/**
 * Hardware detection.
 *
 * The browser can only ever expose a rough picture (GPU renderer string, core
 * count, approximate memory) — there is no VRAM or bandwidth API. So detection
 * here is honest about its job: identify the GPU *name*, match it against the
 * catalog (which carries sourced memory/bandwidth), and let the local probe
 * (`tools/detect_hardware.py`) or the custom-device form fill any gap.
 */

export interface BrowserProbe {
  rendererName: string | null;
  cores: number | null;
  memoryGb: number | null;
}

export function probeBrowser(): BrowserProbe {
  let rendererName: string | null = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | null;
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      rendererName = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
    }
  } catch {
    rendererName = null;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    rendererName,
    cores: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
  };
}

const NOISE =
  /(angle|direct3d|vs_\d+_\d+|ps_\d+_\d+|opengl|engine|pci|\(tm\)|\(r\)|graphics|adapter|driver|microsoft basic|swiftshader|llvmpipe|openai)/gi;

export function normalizeGpuName(raw: string): string {
  return raw
    .replace(NOISE, " ")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Best catalog match for a raw GPU renderer string (null when nothing fits). */
export function matchCatalogDevice(rawName: string, catalog: Device[] = DEVICES): Device | null {
  const norm = normalizeGpuName(rawName);
  if (!norm) return null;
  let best: Device | null = null;
  let bestScore = 0;
  for (const d of catalog) {
    const tokens = normalizeGpuName(d.name)
      .split(" ")
      .filter((t) => t.length > 1 && !/^(laptop|gpu|with|gen)$/.test(t));
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => norm.includes(t)).length;
    const score = hits / tokens.length;
    if (hits >= 2 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}
