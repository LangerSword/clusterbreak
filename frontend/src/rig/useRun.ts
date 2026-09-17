import { useCallback, useEffect, useState } from "react";
import { applyThrottle, applyUnplug, createRun, stepRun, type RunConfig, type RunState } from "../sim";

/**
 * React glue for the run simulator. The engine is deterministic; this hook
 * just ticks it forward on a wall-clock interval (scaled by `speed`) and
 * exposes the fault-injection actions.
 */

const TICK_MS = 100;

export function useRun() {
  const [run, setRun] = useState<RunState | null>(null);
  const [speed, setSpeed] = useState(10);

  const start = useCallback((config: RunConfig) => {
    setRun(createRun(config));
  }, []);

  const stop = useCallback(() => {
    setRun(null);
  }, []);

  const unplug = useCallback((nodeId: string) => {
    setRun((s) => (s ? applyUnplug(s, nodeId) : s));
  }, []);

  const throttle = useCallback((linkId: string, gbps: number) => {
    setRun((s) => (s ? applyThrottle(s, linkId, gbps) : s));
  }, []);

  const status = run?.status;
  useEffect(() => {
    if (!run || status !== "running") return;
    const t = window.setInterval(() => {
      setRun((s) => (s && s.status === "running" ? stepRun(s, TICK_MS * speed) : s));
    }, TICK_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, speed]);

  return { run, start, stop, unplug, throttle, speed, setSpeed };
}
