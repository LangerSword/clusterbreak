import type { Model, Quant } from "../sim";

const CONTEXTS = [512, 1024, 4096, 8192, 16384, 32768];

const QUANTS: { value: Quant; label: string }[] = [
  { value: "q4_k_m", label: "Q4_K_M" },
  { value: "q8_0", label: "Q8_0" },
  { value: "bf16", label: "BF16" },
];

interface Props {
  modelId: string;
  models: Model[];
  quant: Quant;
  contextTokens: number;
  linkMode: boolean;
  nodeCount: number;
  linkCount: number;
  runActive: boolean;
  onModel: (id: string) => void;
  onQuant: (q: Quant) => void;
  onContext: (n: number) => void;
  onToggleLink: () => void;
  onRun: () => void;
  onReset: () => void;
}

export function TopBar(p: Props) {
  const model = p.models.find((m) => m.id === p.modelId);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">CLUSTERBREAK</span>
        <span className="brand-tag">build a rig · run a model · break it</span>
      </div>
      <div className="controls">
        <label>
          MODEL
          <select value={p.modelId} onChange={(e) => p.onModel(e.target.value)}>
            {p.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.totalParamsB ? ` · ${m.totalParamsB}B` : ""}
                {m.activeParamsB !== m.totalParamsB ? ` (${m.activeParamsB}B active)` : ""}
                {m.architectureVerified === false ? " ⚠ arch unverified" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          QUANT
          <select value={p.quant} onChange={(e) => p.onQuant(e.target.value as Quant)}>
            {QUANTS.map((q) => (
              <option key={q.value} value={q.value} disabled={model?.quantSizesGb[q.value] == null}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          CONTEXT
          <select value={p.contextTokens} onChange={(e) => p.onContext(Number(e.target.value))}>
            {CONTEXTS.map((c) => (
              <option key={c} value={c}>
                {c >= 1024 ? `${c / 1024}K` : String(c)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={p.runActive || p.nodeCount === 0}
          onClick={p.onRun}
          title="start a simulated run with the current rig"
        >
          RUN ▶
        </button>
        <button className={p.linkMode ? "active" : ""} onClick={p.onToggleLink}>
          LINK MODE
        </button>
        <button onClick={p.onReset}>RESET</button>
        <span className="counts">
          {p.nodeCount} nodes · {p.linkCount} links
        </span>
      </div>
    </header>
  );
}
