import type { RunState } from "../sim";

const STATUS_LABEL: Record<RunState["status"], string> = {
  running: "RUNNING",
  dead: "RUN ENDED",
  finished: "COMPLETE",
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function fmtCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.floor(n));
}

interface Props {
  run: RunState;
  speed: number;
  onSpeed: (n: number) => void;
  onStop: () => void;
}

export function RunBar({ run, speed, onSpeed, onStop }: Props) {
  return (
    <div className={`runbar ${run.status}`}>
      <span className="run-status">{STATUS_LABEL[run.status]}</span>
      <span className="run-stat">
        <b>{fmtCount(run.tokens)}</b> tokens
      </span>
      <span className="run-stat">
        <b>{run.tokensPerSec.toFixed(1)}</b> tok/s
      </span>
      <span className="run-stat">
        <b>{run.contextTokens.toLocaleString()}</b> ctx
      </span>
      <span className="run-stat">
        <b>{fmtTime(run.simMs)}</b> sim time
      </span>
      <span className="run-stat run-transfer">
        <b>{run.transferMs.toFixed(2)}</b> ms/token transfer
      </span>
      <label className="run-speed">
        SPEED
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
          {[1, 10, 50].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </label>
      <button className="run-stop" onClick={onStop}>
        {run.status === "running" ? "STOP" : "CLEAR"}
      </button>
    </div>
  );
}
