import { DEVICES } from "../sim";

const VENDOR_ORDER = ["NVIDIA", "Apple", "AMD", "Generic"] as const;

export function Palette({ onAdd }: { onAdd: (deviceId: string) => void }) {
  return (
    <aside className="palette">
      <h2>DEVICES</h2>
      <p className="hint">Click to place on the board · drag nodes to move · scroll to zoom</p>
      {VENDOR_ORDER.map((vendor) => {
        const devices = DEVICES.filter((d) => d.vendor === vendor);
        if (devices.length === 0) return null;
        return (
          <section key={vendor}>
            <h3>{vendor.toUpperCase()}</h3>
            {devices.map((d) => (
              <button key={d.id} className="device-card" onClick={() => onAdd(d.id)} title={d.source}>
                <span className="dc-name">{d.name}</span>
                <span className="dc-spec">
                  {d.memoryGb}GB · {d.bandwidthGbps} GB/s
                  {d.decodeEfficiency ? " · calibrated" : ""}
                </span>
              </button>
            ))}
          </section>
        );
      })}
      <p className="note">
        “calibrated” = decode efficiency fitted from published measured benchmarks (see repo docs).
      </p>
    </aside>
  );
}
