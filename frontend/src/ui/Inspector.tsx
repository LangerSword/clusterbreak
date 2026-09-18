import { useState } from "react";
import {
  footprintGb,
  usableMemoryGb,
  type Device,
  type FitStatus,
  type Model,
  type PipelineEstimate,
  type Quant,
} from "../sim";
import type { NodeEstimate } from "../rig/NodeMesh";

export interface SelectedInfo {
  id: string;
  device: Device;
  estimate: NodeEstimate;
}

export interface ClusterInfo {
  nodeCount: number;
  totalUsableGb: number;
  distributedFit: FitStatus | null;
  pipeline: PipelineEstimate | null;
}

interface Props {
  selected: SelectedInfo | null;
  model: Model;
  quant: Quant;
  contextTokens: number;
  links: { id: string; aName: string; bName: string; gbps: number }[];
  cluster: ClusterInfo;
  runActive: boolean;
  unpluggedIds: string[];
  verdict: string | null;
  onRemoveNode: (id: string) => void;
  onUnlink: (id: string) => void;
  onLinkGbps: (id: string, gbps: number) => void;
  onUnplug: (id: string) => void;
}

const FIT_LABEL: Record<FitStatus, string> = {
  comfortable: "fits comfortably",
  tight: "tight fit",
  does_not_fit: "does not fit",
};

export function Inspector({
  selected,
  model,
  quant,
  contextTokens,
  links,
  cluster,
  runActive,
  unpluggedIds,
  verdict,
  onRemoveNode,
  onUnlink,
  onLinkGbps,
  onUnplug,
}: Props) {
  const [copied, setCopied] = useState(false);
  const copyVerdict = () => {
    if (!verdict) return;
    navigator.clipboard
      ?.writeText(verdict)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <aside className="inspector">
      {selected ? (
        <section>
          <h2>{selected.device.name}</h2>
          <div className="kv">
            <span>memory</span>
            <b>{selected.device.memoryGb} GB</b>
          </div>
          <div className="kv">
            <span>bandwidth</span>
            <b>{selected.device.bandwidthGbps} GB/s</b>
          </div>
          <div className="kv">
            <span>usable (−0.5 GB reserve)</span>
            <b>{usableMemoryGb(selected.device).toFixed(1)} GB</b>
          </div>
          <div className="kv">
            <span>efficiency</span>
            <b>
              {selected.device.decodeEfficiency
                ? `${selected.device.decodeEfficiency.toFixed(3)} (fitted)`
                : "0.600 (default — no published measurement)"}
            </b>
          </div>
          {selected.device.efficiencyBasis && <p className="note">{selected.device.efficiencyBasis}</p>}
          <div className={`verdict ${selected.estimate.fit}`}>
            {FIT_LABEL[selected.estimate.fit]}
          </div>
          <div className="metric">
            <span className="metric-num">
              {selected.estimate.tps == null ? "—" : selected.estimate.tps.toFixed(1)}
            </span>
            <span className="metric-unit">
              tok/s decode · {model.name} · {quant.toUpperCase()} · {contextTokens} ctx
            </span>
          </div>
          <div className="node-actions">
            <button onClick={() => onRemoveNode(selected.id)}>REMOVE NODE</button>
            {runActive && (
              <button
                className="danger"
                disabled={unpluggedIds.includes(selected.id)}
                onClick={() => onUnplug(selected.id)}
              >
                {unpluggedIds.includes(selected.id) ? "UNPLUGGED" : "UNPLUG (INJECT FAILURE)"}
              </button>
            )}
          </div>
          <p className="note">
            <a href={selected.device.source} target="_blank" rel="noreferrer">
              device source ↗
            </a>
          </p>
        </section>
      ) : (
        <section>
          <h2>NO NODE SELECTED</h2>
          <p className="note">
            Click a node to inspect it · drag to move it · LINK MODE + two clicks wires a pipeline.
          </p>
        </section>
      )}

      <section>
        <h2>RIG SUMMARY</h2>
        <div className="kv">
          <span>nodes</span>
          <b>{cluster.nodeCount}</b>
        </div>
        <div className="kv">
          <span>total usable</span>
          <b>{cluster.totalUsableGb.toFixed(1)} GB</b>
        </div>
        <div className="kv">
          <span>model footprint</span>
          <b>{footprintGb(model, quant, contextTokens).toFixed(2)} GB</b>
        </div>
        {cluster.distributedFit && cluster.nodeCount > 1 && (
          <div className={`verdict ${cluster.distributedFit}`}>
            distributed: {FIT_LABEL[cluster.distributedFit]}
          </div>
        )}
        {cluster.pipeline ? (
          <>
            <div className="metric">
              <span className="metric-num">{cluster.pipeline.tokensPerSec.toFixed(1)}</span>
              <span className="metric-unit">
                tok/s pipelined across {cluster.pipeline.stages.length} nodes ·{" "}
                {cluster.pipeline.linkBandwidthGbps} GbE assumed
              </span>
            </div>
            <p className="note">{cluster.pipeline.assumptions}</p>
          </>
        ) : (
          cluster.nodeCount >= 2 && (
            <p className="note">Wire the nodes together (LINK MODE) to get a pipeline estimate.</p>
          )
        )}
      </section>

      <section>
        <h2>LINKS</h2>
        {links.length === 0 && <p className="note">None yet.</p>}
        {links.map((l) => (
          <div key={l.id} className="link-row">
            <span>
              {l.aName} ↔ {l.bName}
            </span>
            <span className="link-controls">
              <select
                value={l.gbps}
                onChange={(e) => onLinkGbps(l.id, Number(e.target.value))}
                title="link speed — lowering it during a run injects the throttle fault live"
              >
                {[0.01, 1, 10, 25, 100].map((g) => (
                  <option key={g} value={g}>
                    {g} GbE
                  </option>
                ))}
              </select>
              <button onClick={() => onUnlink(l.id)}>×</button>
            </span>
          </div>
        ))}
      </section>

      {verdict && (
        <section>
          <h2>VERDICT CARD</h2>
          <pre className="verdict-card">{verdict}</pre>
          <button className="copy-verdict" onClick={copyVerdict}>
            {copied ? "COPIED ✓" : "COPY VERDICT"}
          </button>
        </section>
      )}
    </aside>
  );
}
