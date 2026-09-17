import { useEffect, useMemo, useState } from "react";
import {
  DEVICES,
  MODELS,
  estimateDecode,
  estimatePipeline,
  fitStatus,
  fitStatusForCapacity,
  usableMemoryGb,
  type FitStatus,
  type Quant,
} from "./sim";
import { Scene } from "./rig/Scene";
import { useRig } from "./rig/useRig";
import type { NodeEstimate } from "./rig/NodeMesh";
import { Inspector, type ClusterInfo, type SelectedInfo } from "./ui/Inspector";
import { Palette } from "./ui/Palette";
import { TopBar } from "./ui/TopBar";

const DEFAULT_MODEL = "llama3.1_8b";

export default function App() {
  const rig = useRig();
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [quant, setQuant] = useState<Quant>("q4_k_m");
  const [contextTokens, setContextTokens] = useState(1024);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkStartId, setLinkStartId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];

  // Keep the quant valid when the model changes (BF16 has no verified size for some models).
  useEffect(() => {
    if (model.quantSizesGb[quant] == null) setQuant("q4_k_m");
  }, [model, quant]);

  const devicesById = useMemo(() => new Map(DEVICES.map((d) => [d.id, d])), []);

  const estimates = useMemo(() => {
    const map = new Map<string, NodeEstimate>();
    for (const n of rig.nodes) {
      const device = devicesById.get(n.deviceId);
      if (!device) continue;
      const fit = fitStatus(device, model, quant, contextTokens);
      let tps: number | null = null;
      try {
        tps = estimateDecode(device, model, quant, contextTokens).tokensPerSec;
      } catch {
        tps = null;
      }
      map.set(n.id, { tps, fit });
    }
    return map;
  }, [rig.nodes, devicesById, model, quant, contextTokens]);

  const cluster: ClusterInfo = useMemo(() => {
    const devices = rig.nodes
      .map((n) => devicesById.get(n.deviceId))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    const totalUsableGb = devices.reduce((a, d) => a + usableMemoryGb(d), 0);
    let distributedFit: FitStatus | null = null;
    if (devices.length > 0) {
      try {
        distributedFit = fitStatusForCapacity(totalUsableGb, model, quant, contextTokens);
      } catch {
        distributedFit = null;
      }
    }
    let pipeline = null;
    if (rig.nodes.length >= 2 && rig.components.length === 1) {
      try {
        pipeline = estimatePipeline(devices, model, quant, contextTokens);
      } catch {
        pipeline = null;
      }
    }
    return { nodeCount: rig.nodes.length, totalUsableGb, distributedFit, pipeline };
  }, [rig.nodes, rig.components, devicesById, model, quant, contextTokens]);

  const selected: SelectedInfo | null = useMemo(() => {
    if (!selectedId) return null;
    const node = rig.nodes.find((n) => n.id === selectedId);
    if (!node) return null;
    const device = devicesById.get(node.deviceId);
    const estimate = estimates.get(node.id);
    if (!device || !estimate) return null;
    return { id: node.id, device, estimate };
  }, [selectedId, rig.nodes, devicesById, estimates]);

  const links = useMemo(() => {
    const nameOf = (id: string) => {
      const n = rig.nodes.find((x) => x.id === id);
      return n ? (devicesById.get(n.deviceId)?.name ?? "?") : "?";
    };
    return rig.links.map((l) => ({ id: l.id, aName: nameOf(l.a), bName: nameOf(l.b) }));
  }, [rig.links, rig.nodes, devicesById]);

  const handleSelect = (id: string | null) => {
    if (id && linkMode) {
      if (!linkStartId) {
        setLinkStartId(id);
        return;
      }
      if (linkStartId === id) {
        setLinkStartId(null);
        return;
      }
      rig.dispatch({ type: "link", a: linkStartId, b: id });
      setLinkStartId(null);
      return;
    }
    setSelectedId(id);
  };

  return (
    <div className="app">
      <TopBar
        modelId={modelId}
        quant={quant}
        contextTokens={contextTokens}
        linkMode={linkMode}
        nodeCount={rig.nodes.length}
        linkCount={rig.links.length}
        onModel={setModelId}
        onQuant={setQuant}
        onContext={setContextTokens}
        onToggleLink={() => {
          setLinkMode((v) => !v);
          setLinkStartId(null);
        }}
        onReset={() => {
          rig.dispatch({ type: "reset" });
          setSelectedId(null);
          setLinkStartId(null);
        }}
      />
      <div className="main">
        <Palette onAdd={(deviceId) => rig.dispatch({ type: "add", deviceId })} />
        <div className="canvas-wrap">
          <Scene
            nodes={rig.nodes}
            links={rig.links}
            devicesById={devicesById}
            estimates={estimates}
            selectedId={selectedId}
            linkStartId={linkStartId}
            draggingId={draggingId}
            onSelect={handleSelect}
            onMove={(id, cell) => rig.dispatch({ type: "move", id, cell })}
            onDragChange={setDraggingId}
          />
          <div className="canvas-hint">
            {linkMode
              ? linkStartId
                ? "click the second node to wire the link"
                : "click the first node of the pair"
              : "drag empty space to orbit · scroll to zoom · drag nodes to move"}
          </div>
        </div>
        <Inspector
          selected={selected}
          model={model}
          quant={quant}
          contextTokens={contextTokens}
          links={links}
          cluster={cluster}
          onRemoveNode={(id) => {
            rig.dispatch({ type: "remove", id });
            setSelectedId(null);
          }}
          onUnlink={(id) => rig.dispatch({ type: "unlink", id })}
        />
      </div>
    </div>
  );
}
