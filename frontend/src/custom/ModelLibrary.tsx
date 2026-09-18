import { useState } from "react";
import type { Model } from "../sim";

/**
 * Live Hugging Face model library — search GGUF repos, pull one in with its
 * exact blob sizes (HF API) and its architecture from the base model's
 * config.json (unsloth mirror fallback for gated bases). If the architecture
 * cannot be resolved, the model is added with `architectureVerified: false` so
 * the app refuses to print token-rate numbers for it.
 */

interface HfHit {
  id: string;
  downloads?: number;
  likes?: number;
}

interface Props {
  existingIds: string[];
  onAdd: (m: Model) => void;
}

interface Arch {
  layers: number;
  kvHeads: number;
  headDim: number;
  hidden: number;
  heads: number;
}

async function fetchArch(base: string): Promise<Arch | null> {
  const candidates = [base, `unsloth/${base.split("/")[1] ?? base}`];
  for (const c of candidates) {
    try {
      const r = await fetch(`https://huggingface.co/${c}/resolve/main/config.json`);
      if (!r.ok) continue;
      const cfg = (await r.json()) as Record<string, unknown>;
      const layers = Number(cfg.num_hidden_layers);
      const heads = Number(cfg.num_attention_heads);
      const kvHeads = Number(cfg.num_key_value_heads ?? cfg.num_attention_heads);
      const hidden = Number(cfg.hidden_size);
      const headDim = Number(
        cfg.head_dim ?? (hidden && heads ? hidden / heads : Number.NaN),
      );
      if (layers && heads && kvHeads && hidden && headDim) {
        return { layers, kvHeads, headDim, hidden, heads };
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function ModelLibrary({ existingIds, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HfHit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setHits([]);
    setMsg("searching the HF API…");
    try {
      const r = await fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(query.trim())}&filter=gguf&sort=downloads&direction=-1&limit=20`,
      );
      if (!r.ok) throw new Error(`HF API ${r.status}`);
      const data = (await r.json()) as HfHit[];
      setHits(data);
      setMsg(data.length ? null : "no GGUF repos matched");
    } catch (e) {
      setMsg(`search failed: ${String(e)}`);
    }
  };

  const add = async (repoId: string) => {
    setBusy(repoId);
    setMsg(null);
    try {
      const r = await fetch(`https://huggingface.co/api/models/${repoId}?blobs=true`);
      if (!r.ok) throw new Error(`HF API ${r.status}`);
      const d = (await r.json()) as {
        siblings?: { rfilename: string; size?: number }[];
        tags?: string[];
        cardData?: { base_model?: string | string[] };
      };
      const files = (d.siblings ?? []).filter((f) => f.rfilename.toLowerCase().endsWith(".gguf"));
      const sizeOf = (pat: RegExp): number | null => {
        const m = files.filter((f) => pat.test(f.rfilename));
        if (!m.length) return null;
        const bytes = m.reduce((a, f) => a + (f.size ?? 0), 0);
        return bytes > 0 ? Math.round(bytes / 1e7) / 100 : null;
      };
      const sizes = { q4_k_m: sizeOf(/q4_k_m/i), q8_0: sizeOf(/q8_0/i), bf16: sizeOf(/(bf16|f16)/i) };
      if (sizes.q4_k_m == null && sizes.q8_0 == null && sizes.bf16 == null) {
        throw new Error("this repo exposes no GGUF sizes");
      }

      const tagBase = (d.tags ?? []).find(
        (t) => t.startsWith("base_model:") && !t.includes("quantized"),
      );
      const cardBase = Array.isArray(d.cardData?.base_model)
        ? d.cardData?.base_model?.[0]
        : d.cardData?.base_model;
      const base = tagBase ? tagBase.slice("base_model:".length) : (cardBase ?? null);
      const arch = base ? await fetchArch(base) : null;

      const params = (() => {
        const m = repoId.match(/(\d+(?:\.\d+)?)\s*[bB](?:[-_.]|$)/);
        return m ? parseFloat(m[1]) : 0;
      })();

      const model: Model = {
        id: repoId,
        name: repoId.split("/")[1] ?? repoId,
        totalParamsB: params,
        activeParamsB: params,
        layers: arch?.layers ?? 0,
        attentionHeads: arch?.heads ?? 0,
        hiddenSize: arch?.hidden ?? 0,
        kvHeads: arch?.kvHeads ?? 0,
        headDim: arch?.headDim ?? 0,
        quantSizesGb: sizes,
        source: `https://huggingface.co/${repoId}`,
        status: arch
          ? `HF library; sizes live from the API; architecture verified from base model ${base}`
          : "HF library; sizes live from the API; architecture UNVERIFIED",
        architectureVerified: arch != null,
      };
      onAdd(model);
      setMsg(
        arch
          ? `added ${model.name} — architecture verified (base: ${base})`
          : `added ${model.name} — architecture unverified, token rates unavailable`,
      );
    } catch (e) {
      setMsg(`add failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h3>MODEL LIBRARY · HUGGING FACE</h3>
      <div className="lib-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="search GGUF repos…"
        />
        <button onClick={search}>SEARCH</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      {hits.slice(0, 10).map((h) => {
        const known = existingIds.includes(h.id);
        return (
          <div key={h.id} className="lib-hit">
            <span className="lib-id" title={h.id}>
              {h.id}
            </span>
            <span className="lib-meta">↓{(h.downloads ?? 0).toLocaleString()}</span>
            <button onClick={() => add(h.id)} disabled={busy === h.id || known}>
              {known ? "IN LIBRARY" : busy === h.id ? "…" : "ADD"}
            </button>
          </div>
        );
      })}
      {hits.length > 10 && <p className="note">…{hits.length - 10} more — refine the search</p>}
    </section>
  );
}
