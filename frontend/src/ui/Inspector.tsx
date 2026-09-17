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
  links: { id: string; aName: string; bName: string }[];
  cluster: ClusterInfo;
  onRemoveNode: (id: string) => void;
  onUnlink: (id: string) => void;
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
  onRemoveNode,
  onUnlink,
}: Props) {
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
            <span>usable (88%)</span>
            <b>{usableMemoryGb(selected.device).toFixed(1)} GB</b>
          </div>
          <div className="kv">
            <span>efficiency</span>
            <b>
              {selected.device.decodeEfficiency
                ? `${selected.device.decodeEfficiency.toFixed(3)} (fitted)`
                : "0.600 (default)"}
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
          <button onClick={() => onRemoveNode(selected.id)}>REMOVE NODE</button>
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
            <button onClick={() => onUnlink(l.id)}>×</button>
          </div>
        ))}
      </section>
    </aside>
  );
}
