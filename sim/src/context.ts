import type { Model, Quant } from "./types";
import { kvBytesPerToken } from "./decode";
import { footprintGb, fitStatusForCapacity } from "./fit";
import { maxContextTokens } from "./data/model-context";

/**
 * Context-window choices, and which of them the current model + hardware can
 * actually take.
 *
 * The ceiling is not a taste decision: a model's own GGUF metadata states the
 * context it was trained/exported for (fetched by tools/refresh_context.py), and
 * the KV cache for a long context has to fit in memory alongside the weights. So
 * an option is offered when BOTH hold, and is disabled with the reason when
 * either does not — a 128K window on a 24 GB card is arithmetic, not a setting.
 */
// 2048 is here because presets ship it: it was missing from the old fixed list, so
// a preset's 2048 silently displayed as 512 while the engine ran at 2048.
export const CONTEXT_CANDIDATES = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];

export interface ContextOption {
  value: number;
  label: string;
  /** KV cache this window costs, in GB. */
  kvGb: number;
  /** weights + KV, the number the fit verdict uses. */
  footprintGb: number;
  disabled: boolean;
  reason: "ok" | "model-limit" | "capacity";
  hint: string;
}

export function contextOptions(model: Model, quant: Quant, capacityGb: number): ContextOption[] {
  const max = maxContextTokens(model.id);
  return CONTEXT_CANDIDATES.map((value) => {
    const kvGb = (kvBytesPerToken(model) * value) / 1e9;
    const fp = footprintGb(model, quant, value);
    const overModel = max != null && value > max;
    const fits = fitStatusForCapacity(capacityGb, model, quant, value) !== "does_not_fit";
    const label = value >= 1024 ? `${value / 1024}K` : String(value);
    if (overModel) {
      return {
        value,
        label,
        kvGb,
        footprintGb: fp,
        disabled: true,
        reason: "model-limit" as const,
        hint: `beyond this model's ${(max! / 1024).toFixed(0)}K limit`,
      };
    }
    if (!fits) {
      return {
        value,
        label,
        kvGb,
        footprintGb: fp,
        disabled: true,
        reason: "capacity" as const,
        hint: `needs ${fp.toFixed(1)} GB of memory`,
      };
    }
    return {
      value,
      label,
      kvGb,
      footprintGb: fp,
      disabled: false,
      reason: "ok" as const,
      hint: `KV ${kvGb < 1 ? kvGb.toFixed(2) : kvGb.toFixed(1)} GB`,
    };
  });
}
