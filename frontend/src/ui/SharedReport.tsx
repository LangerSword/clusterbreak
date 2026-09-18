import { useEffect, useState } from "react";
import { fetchRun } from "../api";
import type { ReportPayload } from "../report";

type State =
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "ready"; report: ReportPayload };

/** Read-only view of a shared run report (/?report=<id>). */
export function SharedReport({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    fetchRun(id)
      .then((report) => alive && setState({ kind: "ready", report }))
      .catch((e: unknown) =>
        alive && setState({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
    };
  }, [id]);

  const base = window.location.origin;
  if (state.kind === "loading") {
    return (
      <div className="shared">
        <div className="shared-card">
          <p className="note">loading report…</p>
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="shared">
        <div className="shared-card">
          <div className="pm-kicker">REPORT UNAVAILABLE</div>
          <h2 className="pm-title">{state.msg}</h2>
          <a className="shared-cta" href={base}>
            build your own rig →
          </a>
        </div>
      </div>
    );
  }

  const r = state.report;
  const dead = r.outcome.status === "dead";
  return (
    <div className="shared">
      <div className={`shared-card ${dead ? "dead" : "finished"}`}>
        <div className="shared-brand">CLUSTERBREAK REPORT</div>
        <div className="pm-kicker">{dead ? "WHAT DIED AND WHY" : `RUN ${r.outcome.status.toUpperCase()}`}</div>
        <h2 className="pm-title">
          {dead && r.outcome.death ? r.outcome.death.cause : `${r.outcome.totalTokens} tokens generated`}
        </h2>
        {dead && r.outcome.death && <p className="pm-detail">{r.outcome.death.detail}</p>}

        <div className="kv">
          <span>rig</span>
          <b>
            {r.rig.nodes.map((n) => n.device).join(" + ")}
            {r.rig.links.length > 0 &&
              ` · linked (${r.rig.links.map((l) => l.gbps).join("/")} GbE)`}
          </b>
        </div>
        <div className="kv">
          <span>model</span>
          <b>
            {r.model.name} · {r.model.quant.toUpperCase()} @ {r.model.contextTokens.toLocaleString()} ctx
          </b>
        </div>
        <div className="kv">
          <span>throughput</span>
          <b>
            {r.outcome.tokensPerSec.toFixed(1)} tok/s
            {r.outcome.unplugged.length > 0 && ` after unplugging ${r.outcome.unplugged.join(", ")}`}
          </b>
        </div>

        <pre className="verdict-card">{r.verdict}</pre>

        <p className="note">
          Simulated client-side · model sizes pulled live from the Hugging Face API · device
          efficiencies fitted from measured llama.cpp benchmark campaigns.
        </p>
        <a className="shared-cta" href={base}>
          build your own rig →
        </a>
      </div>
    </div>
  );
}
