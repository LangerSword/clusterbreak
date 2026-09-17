import type { RunState } from "../sim";

/**
 * Postmortem card: what died and why, with the event trail and the repairs.
 * Also used as the completion summary when a run finishes normally.
 */
export function Postmortem({ run, onReset }: { run: RunState; onReset: () => void }) {
  if (run.status === "running") return null;
  const dead = run.status === "dead";
  const trail = run.events.slice(-7).reverse();
  return (
    <div className="postmortem-backdrop">
      <div className={`postmortem ${dead ? "dead" : "finished"}`}>
        <div className="pm-kicker">{dead ? "WHAT DIED AND WHY" : "RUN COMPLETE"}</div>
        <h2 className="pm-title">
          {dead ? run.death?.cause : `${Math.floor(run.tokens)} tokens generated`}
        </h2>
        {dead ? (
          <p className="pm-detail">{run.death?.detail}</p>
        ) : (
          <p className="pm-detail">
            Final throughput {run.tokensPerSec.toFixed(1)} tok/s · {run.contextTokens.toLocaleString()} ctx ·
            simulation time {(run.simMs / 1000).toFixed(0)}s.
          </p>
        )}

        {dead && run.death && (
          <div className="pm-repairs">
            <div className="pm-sub">HOW YOU'D FIX IT</div>
            <ul>
              {run.death.repairs.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="pm-trail">
          <div className="pm-sub">EVENT TRAIL</div>
          {trail.map((e, i) => (
            <div key={`${e.atMs}-${i}`} className={`event-line kind-${e.kind}`}>
              <span className="event-time">{Math.floor(e.atMs / 1000)}s</span>
              <span className="event-msg">{e.message}</span>
            </div>
          ))}
        </div>

        <button className="pm-reset" onClick={onReset}>
          RESET RUN
        </button>
      </div>
    </div>
  );
}
