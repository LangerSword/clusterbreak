import type { RunState } from "../sim";

/** Live event console overlaid on the board — newest first. */
export function EventConsole({ run }: { run: RunState }) {
  const recent = [...run.events].slice(-8).reverse();
  if (recent.length === 0) return null;
  return (
    <div className="event-console">
      {recent.map((e, i) => (
        <div key={`${e.atMs}-${i}`} className={`event-line kind-${e.kind}`}>
          <span className="event-time">{Math.floor(e.atMs / 1000)}s</span>
          <span className="event-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
}
