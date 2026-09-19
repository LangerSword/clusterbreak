import { useEffect, useMemo, useState } from "react";
import {
  DEVICES,
  MODELS,
  applyUnplug,
  createRun,
  estimateDecode,
  fitStatus,
  fitStatusForCapacity,
  footprintGb,
  hopGbpsForChain,
  pipelineBreakdown,
  predictOomContext,
  usableMemoryGb,
  type Device,
  type FitStatus,
  type PipelineEstimate,
  type Quant,
} from "./sim";
import { Scene } from "./rig/Scene";
import { useRig } from "./rig/useRig";
import { useRun } from "./rig/useRun";
import { PRESETS, type Preset } from "./rig/presets";
import type { NodeEstimate } from "./rig/NodeMesh";
import { useCustomDevices, useCustomModels } from "./custom/useCustom";
import { EventConsole } from "./ui/EventConsole";
import { Inspector, type ClusterInfo, type SelectedInfo } from "./ui/Inspector";
import { Palette } from "./ui/Palette";
import { Postmortem, type ShareState } from "./ui/Postmortem";
import { RunBar } from "./ui/RunBar";
import { SharedReport } from "./ui/SharedReport";
import { TopBar } from "./ui/TopBar";
import { shareRun } from "./api";
import { buildReportPayload } from "./report";
import {
  buildTemplate,
  estimateCost,
  planDeploy,
  PRICING_FETCHED_AT,
  PRICING_REGION,
} from "./deploy/cfn";

const DEFAULT_MODEL = "llama3.1_8b";

const FIT_WORDS: Record<FitStatus, string> = {
  comfortable: "fits comfortably",
  tight: "tight fit",
  does_not_fit: "does not fit",
};

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
  const [lastPreset, setLastPreset] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [sharedReportId] = useState(() => new URLSearchParams(window.location.search).get("report"));

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

  const deploy = useMemo(() => {
    const devices = rig.nodes
      .map((n) => devicesById.get(n.deviceId))
      .filter((d): d is Device => Boolean(d));
    if (devices.length === 0) return null;
    const plan = planDeploy(devices);
    return { plan, cost: estimateCost(plan) };
  }, [rig.nodes, devicesById]);

  const verdict = useMemo((): string | null => {
    try {
      const nodes = rig.nodes
        .map((n) => ({ n, device: devicesById.get(n.deviceId) }))
        .filter((x): x is { n: (typeof rig.nodes)[number]; device: Device } => Boolean(x.device));
      if (nodes.length === 0) return null;
      const devices = nodes.map((x) => x.device);
      const lines: string[] = [];
      const linked = rig.links.length > 0 && rig.components.length === 1;
      const minGbps = rig.links.length ? Math.min(...rig.links.map((l) => l.gbps)) : null;
      lines.push(
        `RIG     ${devices.map((d) => d.name).join(" + ")}${linked ? ` — linked (${minGbps} GbE)` : ""}`,
      );
      let fp: number | null = null;
      try {
        fp = footprintGb(model, quant, contextTokens);
      } catch {
        fp = null;
      }
      lines.push(
        `MODEL   ${model.name} ${quant.toUpperCase()} @ ${contextTokens.toLocaleString("en-US")} ctx` +
          (fp != null ? ` — ${fp.toFixed(1)} GB footprint` : " — size unverified"),
      );
      if (cluster.pipeline && linked) {
        lines.push(
          `SPEED   ${cluster.pipeline.tokensPerSec.toFixed(1)} tok/s pipelined across ${devices.length} nodes`,
        );
      } else {
        const parts = nodes.map((x) => {
          const e = estimates.get(x.n.id);
          const tag = e?.kind === "fitted" ? "" : "~";
          return `${x.device.name.slice(0, 18)} ${e?.tps == null ? "—" : `${tag}${e.tps.toFixed(1)}`}`;
        });
        lines.push(`SPEED   ${parts.join(" · ")} tok/s`);
      }
      const totalUsable = devices.reduce((a, d) => a + usableMemoryGb(d), 0);
      let fitWord = "";
      try {
        fitWord = FIT_WORDS[fitStatusForCapacity(totalUsable, model, quant, contextTokens)];
      } catch {
        fitWord = "unverified size";
      }
      lines.push(`FIT     ${fitWord} (${totalUsable.toFixed(1)} GB usable)`);
      let ctxDeath: number | null = null;
      try {
        ctxDeath = predictOomContext(devices, model, quant);
      } catch {
        ctxDeath = null;
      }
      lines.push(
        ctxDeath == null
          ? "WALL    no KV-cache death within memory"
          : `WALL    KV cache outgrows VRAM at ~${(Math.round(ctxDeath / 100) / 10).toFixed(1)}K ctx`,
      );
      if (nodes.length >= 2) {
        const weakest = [...nodes].sort(
          (a, b) => usableMemoryGb(a.device) - usableMemoryGb(b.device),
        )[0]!;
        try {
          const cfg = {
            nodes: nodes.map((x) => ({ id: x.n.id, device: x.device })),
            links: rig.links.map((l) => ({ id: l.id, a: l.a, b: l.b, gbps: l.gbps })),
            model,
            quant,
            contextStart: contextTokens,
            maxTokens: 1,
          };
          let s = createRun(cfg);
          if (s.status === "dead") {
            lines.push("BREAK   rig already does not fit — nothing runs to break");
          } else {
            s = applyUnplug(s, weakest.n.id);
            lines.push(
              s.status === "dead"
                ? `BREAK   unplug ${weakest.device.name} (weakest) → run dies: ${s.death?.cause ?? "out of memory"}`
                : `BREAK   unplug ${weakest.device.name} (weakest) → survivors hold on at ${s.tokensPerSec.toFixed(1)} tok/s`,
            );
          }
        } catch {
          lines.push("BREAK   unplug test unavailable for this model");
        }
      }
      lines.push("DATA    sizes: Hugging Face API · efficiencies: measured campaigns (unverified marked ~)");
      if (lastPreset) lines.push(`OPEN    ${window.location.origin}/app.html?preset=${lastPreset}`);
      return lines.join("\n");
    } catch {
      return null;
    }
  }, [
    rig.nodes,
    rig.links,
    rig.components,
    devicesById,
    model,
    quant,
    contextTokens,
    estimates,
    cluster.pipeline,
    lastPreset,
  ]);

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
    setShare({ status: "idle" });
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
    setShare({ status: "idle" });
  };

  const shareRunReport = async () => {
    if (!run.run) return;
    setShare({ status: "working" });
    try {
      let fp: number | null = null;
      try {
        fp = footprintGb(model, quant, contextTokens);
      } catch {
        fp = null;
      }
      const payload = buildReportPayload({
        nodes: rig.nodes
          .map((n) => ({
            device: devicesById.get(n.deviceId),
            fitted: estimates.get(n.id)?.kind === "fitted",
          }))
          .filter((x): x is { device: Device; fitted: boolean } => Boolean(x.device)),
        links: rig.links.map((l) => ({ gbps: l.gbps })),
        model,
        quant,
        contextTokens,
        footprintGb: fp,
        run: run.run,
        verdict,
        preset: lastPreset,
        unpluggedNames: run.run.unplugged.map((id) => {
          const n = rig.nodes.find((x) => x.id === id);
          return n ? (devicesById.get(n.deviceId)?.name ?? id) : id;
        }),
      });
      const id = await shareRun(payload);
      setShare({ status: "done", url: `${window.location.origin}/app.html?report=${id}` });
    } catch (e) {
      setShare({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const downloadTemplate = () => {
    if (!deploy || deploy.plan.entries.length === 0) return;
    const yaml = buildTemplate({
      plan: deploy.plan,
      model,
      quant,
      contextTokens,
      rigLabel: lastPreset ?? "custom-rig",
    });
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clusterbreak-${lastPreset ?? "rig"}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadPreset = (p: Preset) => {
    run.stop();
    rig.dispatch({ type: "load", nodes: p.nodes, links: p.links });
    setModelId(p.modelId);
    const target = models.find((m) => m.id === p.modelId);
    setQuant(target?.quantSizesGb[p.quant] != null ? p.quant : "q4_k_m");
    setContextTokens(p.contextTokens);
    setSelectedId(null);
    setLinkStartId(null);
    setLastPreset(p.id);
  };

  // Deep link: /?preset=<id> fills the board on open (shareable rigs).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    const p = PRESETS.find((x) => x.id === id);
    if (p) loadPreset(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sharedReportId) return <SharedReport id={sharedReportId} />;

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
          onPreset={loadPreset}
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
          {run.run && <Postmortem run={run.run} onReset={run.stop} share={share} onShare={shareRunReport} />}
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
          verdict={verdict}
          deploy={deploy}
          pricingFetchedAt={PRICING_FETCHED_AT}
          pricingRegion={PRICING_REGION}
          onDownloadTemplate={downloadTemplate}
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
