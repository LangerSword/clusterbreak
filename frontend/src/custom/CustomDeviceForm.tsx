import { useState } from "react";
import { MODELS, fitEfficiencyFromMeasurement, type Device } from "../sim";

/** Manual device entry: any laptop/desktop part, with an optional owner measurement. */

const PROBE = MODELS.find((m) => m.id === "llama3.1_8b");

export interface CustomDevicePrefill {
  name?: string;
  memoryGb?: number;
}

function guessVendor(name: string): Device["vendor"] {
  if (/apple|\bm[1-4]\b/i.test(name)) return "Apple";
  if (/radeon|\bamd\b|\brx\s?\d/i.test(name)) return "AMD";
  if (/rtx|gtx|geforce|nvidia|a100|h100|l40|tesla/i.test(name)) return "NVIDIA";
  return "Generic";
}

export function CustomDeviceForm({
  onAdd,
  prefill,
}: {
  onAdd: (d: Device) => void;
  prefill?: CustomDevicePrefill;
}) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [memory, setMemory] = useState(prefill?.memoryGb ? String(prefill.memoryGb) : "");
  const [bandwidth, setBandwidth] = useState("");
  const [measured, setMeasured] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const mem = parseFloat(memory);
    const bw = parseFloat(bandwidth);
    if (!name.trim()) return setError("name required");
    if (!(mem > 0)) return setError("memory (GB) must be a positive number");
    if (!(bw > 0)) return setError("bandwidth (GB/s) must be a positive number");
    let device: Device = {
      id: `custom:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: name.trim(),
      vendor: guessVendor(name),
      memoryGb: mem,
      bandwidthGbps: bw,
      source: "user-entered",
      status: "custom_device",
    };
    const tps = parseFloat(measured);
    if (measured.trim()) {
      if (!(tps > 0) || !PROBE) return setError("measured tok/s must be a positive number");
      try {
        const eff = fitEfficiencyFromMeasurement(tps, bw, PROBE);
        device = {
          ...device,
          decodeEfficiency: eff,
          efficiencyBasis: `fitted from YOUR measured ${tps} tok/s (Llama-3.1-8B-Instruct Q4_K_M, 1024-token generation)`,
          status: "custom_device; efficiency_fitted_from_owner_measurement",
        };
      } catch (e) {
        return setError(String(e));
      }
    }
    onAdd(device);
    setName("");
    setMemory("");
    setBandwidth("");
    setMeasured("");
  };

  return (
    <section>
      <h3>CUSTOM DEVICE</h3>
      <div className="custom-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name — e.g. RTX 3060 12GB, M4 Pro, custom box"
        />
        <div className="row2">
          <input
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            placeholder="memory GB"
            inputMode="decimal"
          />
          <input
            value={bandwidth}
            onChange={(e) => setBandwidth(e.target.value)}
            placeholder="bandwidth GB/s"
            inputMode="decimal"
          />
        </div>
        <input
          value={measured}
          onChange={(e) => setMeasured(e.target.value)}
          placeholder="optional: your measured tok/s (Llama-3.1-8B Q4_K_M)"
          inputMode="decimal"
        />
        <button onClick={submit}>ADD DEVICE</button>
        {error && <p className="note error">{error}</p>}
        <p className="note">
          With a measured tok/s, the device is calibrated exactly like the built-in
          catalog (same probe: <code>llama-bench -m …Q4_K_M.gguf -p 1024 -n 1024</code>).
          Without one it renders as an unverified estimate.
        </p>
      </div>
    </section>
  );
}
