import { useEffect, useMemo, useState } from "react";
import {
  DEVICES,
  MODELS,
  estimateDecode,
  fitStatus,
  fitStatusForCapacity,
  hopGbpsForChain,
  pipelineBreakdown,
  usableMemoryGb,
  type Device,
  type FitStatus,
  type PipelineEstimate,
  type Quant,
} from "./sim";
import { Scene } from "./rig/Scene";
import { useRig } from "./rig/useRig";
import { useRun } from "./rig/useRun";
import type { NodeEstimate } from "./rig/NodeMesh";
import { useCustomDevices, useCustomModels } from "./custom/useCustom";
import { EventConsole } from "./ui/EventConsole";
import { Inspector, type ClusterInfo, type SelectedInfo } from "./ui/Inspector";
import { Palette } from "./ui/Palette";
import { Postmortem } from "./ui/Postmortem";
import { RunBar } from "./ui/RunBar";
import { TopBar } from "./ui/TopBar";

const DEFAULT_MODEL = "llama3.1_8b";

export default function App() {
  const rig = useRig();
  const run = useRun();
  const { customDevices, addCustomDevice, removeCustomDevice } = useCustomDevices();
  const { customModels, addCustomModel } = useCustomModels();
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [quant, setQuant] = useState<Quant>("q4_k_m");
  const [contextTokens, setContextTokens] = useState(1024);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkStartId, setLinkStartId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const models = useMemo(() => [...MODELS, ...customModels], [customModels]);
  const model = models.find((m) => m.id === modelId) ?? models[0];

  // If the selected model disappears (custom model removed), fall back to the catalog.
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) setModelId(models[0].id);
  }, [models, modelId]);

  // Keep the quant valid when the model changes (BF16 has no verified size for some models).
  useEffect(() => {
    if (model.quantSizesGb[quant] == null) setQuant("q4_k_m");
  }, [model, quant]);

  const allDevices = useMemo(() => [...DEVICES, ...customDevices], [customDevices]);
  const devicesById = useMemo(() => new Map(allDevices.map((d) => [d.id, d])), [allDevices]);

  const estimates = useMemo(() => {
    const map = new Map<string, NodeEstimate>();
    for (const n of rig.nodes) {
      const device = devicesById.get(n.deviceId);
      if (!device) continue;
      const fit = fitStatus(device, model, quant, contextTokens);
      let tps: number | null = null;
      let kind: NodeEstimate["kind"] = "estimate";
      if (model.architectureVerified !== false) {
        try {
          const est = estimateDecode(device, model, quant, contextTokens);
          tps = est.tokensPerSec;
          kind = est.efficiencyKind;
        } catch {
          tps = null;
        }
      }
      map.set(n.id, { tps, fit, kind });
    }
    return map;
  }, [rig.nodes, devicesById, model, quant, contextTokens]);

  const cluster: ClusterInfo = useMemo(() => {
    const devices = rig.nodes
      .map((n) => devicesById.get(n.deviceId))
      .filter((d): d is Device => Boolean(d));
    const totalUsableGb = devices.reduce((a, d) => a + usableMemoryGb(d), 0);
    let distributedFit: FitStatus | null = null;
    if (devices.length > 0) {
      try {
        distributedFit = fitStatusForCapacity(totalUsableGb, model, quant, contextTokens);
      } catch {
        distributedFit = null;
      }
    }
    let pipeline: PipelineEstimate | null = null;
    if (
      rig.nodes.length >= 2 &&
      rig.components.length === 1 &&
      model.architectureVerified !== false
    ) {
      try {
        const hopGbps = hopGbpsForChain(
          rig.nodes.map((n) => n.id),
          rig.links,
        );
        const { stages, transferMs, totalMs } = pipelineBreakdown(
          devices,
          model,
          quant,
          contextTokens,
          hopGbps,
        );
        pipeline = {
          tokensPerSec: 1000 / totalMs,
          stages,
          transferMs,
          totalMs,
          linkBandwidthGbps: Math.min(...hopGbps),
          assumptions:
            "Equal split by usable memory; per-stage KV reads; fp16 activation per hop at each link's speed; batch 1.",
        };
      } catch {
        pipeline = null;
      }
    }
    return { nodeCount: rig.nodes.length, totalUsableGb, distributedFit, pipeline };
  }, [rig.nodes, rig.components, rig.links, devicesById, model, quant, contextTokens]);

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
    return rig.links.map((l) => ({
      id: l.id,
      aName: nameOf(l.a),
      bName: nameOf(l.b),
      gbps: l.gbps,
    }));
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

  const startRun = () => {
    const nodes: { id: string; device: Device }[] = [];
    for (const n of rig.nodes) {
      const device = devicesById.get(n.deviceId);
      if (device) nodes.push({ id: n.id, device });
    }
    if (nodes.length === 0) return;
    run.start({
      nodes,
      links: rig.links.map((l) => ({ id: l.id, a: l.a, b: l.b, gbps: l.gbps })),
      model,
      quant,
      contextStart: contextTokens,
      maxTokens: 4096,
    });
  };

  const handleLinkGbps = (id: string, gbps: number) => {
    rig.dispatch({ type: "setLinkGbps", id, gbps });
    if (run.run?.status === "running") run.throttle(id, gbps);
  };

  const resetAll = () => {
    run.stop();
    rig.dispatch({ type: "reset" });
    setSelectedId(null);
    setLinkStartId(null);
  };

  return (
    <div className="app">
      <TopBar
        modelId={modelId}
        models={models}
        quant={quant}
        contextTokens={contextTokens}
        linkMode={linkMode}
        nodeCount={rig.nodes.length}
        linkCount={rig.links.length}
        runActive={run.run !== null}
        onModel={setModelId}
        onQuant={setQuant}
        onContext={setContextTokens}
        onToggleLink={() => {
          setLinkMode((v) => !v);
          setLinkStartId(null);
        }}
        onRun={startRun}
        onReset={resetAll}
      />
      {run.run && (
        <RunBar run={run.run} speed={run.speed} onSpeed={run.setSpeed} onStop={run.stop} />
      )}
      <div className="main">
        <Palette
          devices={allDevices}
          customDevices={customDevices}
          existingModelIds={models.map((m) => m.id)}
          onAddDevice={(deviceId) => rig.dispatch({ type: "add", deviceId })}
          onRemoveCustomDevice={removeCustomDevice}
          onAddCustomDevice={(d) => addCustomDevice(d)}
          onAddCustomModel={(m) => addCustomModel(m)}
        />
        <div className="canvas-wrap">
          <Scene
            nodes={rig.nodes}
            links={rig.links}
            devicesById={devicesById}
            estimates={estimates}
            selectedId={selectedId}
            linkStartId={linkStartId}
            draggingId={draggingId}
            run={run.run}
            onSelect={handleSelect}
            onMove={(id, cell) => rig.dispatch({ type: "move", id, cell })}
            onDragChange={setDraggingId}
          />
          {run.run && <EventConsole run={run.run} />}
          {run.run && <Postmortem run={run.run} onReset={run.stop} />}
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
          runActive={run.run?.status === "running"}
          unpluggedIds={run.run?.unplugged ?? []}
          onRemoveNode={(id) => {
            rig.dispatch({ type: "remove", id });
            setSelectedId(null);
          }}
          onUnlink={(id) => rig.dispatch({ type: "unlink", id })}
          onLinkGbps={handleLinkGbps}
          onUnplug={run.unplug}
        />
      </div>
    </div>
  );
}
