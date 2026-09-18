import { useState } from "react";
import type { Device, Model } from "../sim";
import { CustomDeviceForm } from "../custom/CustomDeviceForm";
import { ModelLibrary } from "../custom/ModelLibrary";
import { matchCatalogDevice, probeBrowser } from "../custom/detect";

const VENDOR_ORDER = ["NVIDIA", "Apple", "AMD", "Generic"] as const;

interface Props {
  devices: Device[];
  customDevices: Device[];
  onAddDevice: (deviceId: string) => void;
  onRemoveCustomDevice: (id: string) => void;
  onAddCustomDevice: (d: Device) => void;
  onAddCustomModel: (m: Model) => void;
  existingModelIds: string[];
}

/** Left panel: hardware palette, live hardware detection, custom rig entry, model library. */
export function Palette({
  devices,
  customDevices,
  onAddDevice,
  onRemoveCustomDevice,
  onAddCustomDevice,
  onAddCustomModel,
  existingModelIds,
}: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ name?: string; memoryGb?: number; key: number }>({
    key: 0,
  });
  const [importText, setImportText] = useState("");

  const detect = () => {
    const probe = probeBrowser();
    if (!probe.rendererName) {
      setNotice(
        "this browser can't see the GPU (software rendering or blocked WebGL) — run `python3 tools/detect_hardware.py` locally and import the JSON below",
      );
      return;
    }
    const match = matchCatalogDevice(probe.rendererName, devices);
    if (match) {
      onAddDevice(match.id);
      setNotice(
        `detected “${probe.rendererName}” → matched catalog device “${match.name}” and placed it · ${probe.cores ?? "?"} CPU cores`,
      );
    } else {
      setPrefill({ name: probe.rendererName, key: prefill.key + 1 });
      setNotice(
        `detected “${probe.rendererName}” — no catalog match; the custom form below is prefilled (enter memory + bandwidth to add it)`,
      );
    }
  };

  const importRig = () => {
    try {
      const data = JSON.parse(importText) as {
        gpus?: { name: string; memoryGb?: number }[];
        cpu?: { name?: string };
        ramGb?: number;
        host?: string;
      };
      const gpus = data.gpus ?? [];
      if (!gpus.length) {
        setNotice("no GPUs found in that JSON (expected the output of tools/detect_hardware.py)");
        return;
      }
      const added: string[] = [];
      const unmatched: string[] = [];
      for (const g of gpus) {
        const match = matchCatalogDevice(g.name, devices);
        if (match) {
          onAddDevice(match.id);
          added.push(match.name);
        } else {
          unmatched.push(g.name);
          setPrefill({ name: g.name, memoryGb: g.memoryGb, key: prefill.key + 1 });
        }
      }
      setNotice(
        `imported rig from ${data.host ?? "local probe"} (${data.cpu?.name ?? "unknown CPU"} · ${data.ramGb ?? "?"} GB RAM) — placed: ${added.join(", ") || "none"}${unmatched.length ? `; unmatched (form prefilled): ${unmatched.join(", ")}` : ""}`,
      );
    } catch (e) {
      setNotice(`import failed: ${String(e)}`);
    }
  };

  return (
    <aside className="palette">
      <h2>DEVICES</h2>
      <p className="hint">Click to place on the board · drag nodes to move · scroll to zoom</p>

      <button className="detect-btn" onClick={detect}>
        DETECT THIS MACHINE
      </button>
      <details className="importer">
        <summary>import rig JSON (local probe)</summary>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="paste the output of: python3 tools/detect_hardware.py"
          rows={4}
        />
        <button onClick={importRig}>IMPORT</button>
      </details>
      {notice && <p className="note">{notice}</p>}

      {customDevices.length > 0 && (
        <section>
          <h3>YOUR DEVICES</h3>
          {customDevices.map((d) => (
            <div key={d.id} className="custom-row">
              <button
                className="device-card"
                onClick={() => onAddDevice(d.id)}
                title={d.efficiencyBasis ?? "custom device"}
              >
                <span className="dc-name">{d.name}</span>
                <span className="dc-spec">
                  {d.memoryGb}GB · {d.bandwidthGbps} GB/s
                  {d.decodeEfficiency ? " · measured" : " · unverified"}
                </span>
              </button>
              <button className="x" onClick={() => onRemoveCustomDevice(d.id)} title="remove">
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      {VENDOR_ORDER.map((vendor) => {
        const list = devices.filter(
          (d) => d.vendor === vendor && !customDevices.some((c) => c.id === d.id),
        );
        if (list.length === 0) return null;
        return (
          <section key={vendor}>
            <h3>{vendor.toUpperCase()}</h3>
            {list.map((d) => (
              <button key={d.id} className="device-card" onClick={() => onAddDevice(d.id)} title={d.source}>
                <span className="dc-name">{d.name}</span>
                <span className="dc-spec">
                  {d.memoryGb}GB · {d.bandwidthGbps} GB/s
                  {d.decodeEfficiency ? " · measured" : ""}
                </span>
              </button>
            ))}
          </section>
        );
      })}
      <p className="note">
        “measured” = decode efficiency fitted from a published benchmark campaign (sources in
        docs/data-report.md). Unmarked devices show unverified estimates.
      </p>

      <CustomDeviceForm key={prefill.key} prefill={prefill} onAdd={onAddCustomDevice} />
      <ModelLibrary existingIds={existingModelIds} onAdd={onAddCustomModel} />
    </aside>
  );
}
