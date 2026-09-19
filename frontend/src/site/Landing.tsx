import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEVICES,
  MODELS,
  estimateDecode,
  fitStatus,
  footprintGb,
  predictOomContext,
  usableMemoryGb,
  type Device,
  type FitStatus,
} from "../sim";
import pricing from "../../../sim/data/aws-pricing.json";
import benchmarks from "../../../sim/data/benchmarks.json";

const CONTEXT_TOKENS = 4096;
const API_BASE = "https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com";

/** Footer API status — pings /health once, degrades silently, never blocks. */
function ApiStatus() {
  const [state, setState] = useState<{ kind: "checking" } | { kind: "ok"; version: string } | { kind: "down" }>({
    kind: "checking",
  });
  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 5000);
    fetch(`${API_BASE}/health`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { version?: string }) => setState({ kind: "ok", version: d.version ?? "?" }))
      .catch(() => setState({ kind: "down" }))
      .finally(() => window.clearTimeout(t));
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, []);
  return (
    <span className="api-status" aria-live="polite">
      {state.kind === "checking" && <span className="api-dot checking" />}
      {state.kind === "ok" && <span className="api-dot ok" />}
      {state.kind === "down" && <span className="api-dot down" />}
      {state.kind === "ok"
        ? `api operational · v${state.version}`
        : state.kind === "down"
          ? "api unreachable"
          : "api…"}
    </span>
  );
}

const FIT_WORD: Record<FitStatus, { label: string; cls: string }> = {
  comfortable: { label: "fits comfortably", cls: "ok" },
  tight: { label: "tight fit", cls: "warn" },
  does_not_fit: { label: "does not fit", cls: "bad" },
};

function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/** Hero instrument — runs the actual sim engine against measured data.
 *  Nothing on this page is a mock number. */
function Instrument() {
  const measured = useMemo(() => DEVICES.filter((d) => d.decodeEfficiency != null), []);
  const models = useMemo(() => MODELS.filter((m) => m.quantSizesGb.q4_k_m != null), []);
  const [deviceId, setDeviceId] = useState(
    () => measured.find((d) => d.id === "rtx3090_24gb")?.id ?? measured[0]?.id,
  );
  const [modelId, setModelId] = useState(() => models.find((m) => m.id === "llama3.1_8b")?.id ?? models[0]?.id);

  const device: Device | undefined = DEVICES.find((d) => d.id === deviceId);
  const model = MODELS.find((m) => m.id === modelId);

  const result = useMemo(() => {
    if (!device || !model) return null;
    try {
      const est = estimateDecode(device, model, "q4_k_m", CONTEXT_TOKENS);
      const fit = fitStatus(device, model, "q4_k_m", CONTEXT_TOKENS);
      const fp = footprintGb(model, "q4_k_m", CONTEXT_TOKENS);
      const wall = predictOomContext([device], model, "q4_k_m");
      return { tps: est.tokensPerSec, kind: est.efficiencyKind, fit, fp, wall };
    } catch {
      return null;
    }
  }, [device, model]);

  // settle animation: count to the value, 400ms (disabled by reduced-motion)
  const [shown, setShown] = useState<number | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (result == null) {
      setShown(null);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(result.tps);
      return;
    }
    const from = shown ?? 0;
    const to = result.tps;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 400);
      setShown(from + (to - from) * k);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <div className="instrument" role="region" aria-label="Live verdict — runs the real simulation engine">
      <div className="instrument-head">
        <span className="label">Live verdict · real engine</span>
        <span className="live-dot">in your browser</span>
      </div>
      <div className="instrument-controls">
        <div className="field">
          <label htmlFor="hero-device">Device</label>
          <select id="hero-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {measured.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hero-model">Model · Q4_K_M</label>
          <select id="hero-model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="readout" aria-live="polite">
        <div className="readout-main">
          <span className="readout-num">
            {shown == null ? "—" : shown.toFixed(1)}
          </span>
          <span className="readout-unit">tok/s decode @ {CONTEXT_TOKENS.toLocaleString()} ctx</span>
        </div>
        <div className="readout-rows">
          <div className="readout-row">
            <span className="k">fit on {device ? `${usableMemoryGb(device).toFixed(1)} GB usable` : "—"}</span>
            <span className="v">
              {result ? (
                <span className={`chip ${FIT_WORD[result.fit].cls}`}>{FIT_WORD[result.fit].label}</span>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="readout-row">
            <span className="k">model footprint</span>
            <span className="v">{result ? `${result.fp.toFixed(2)} GB` : "—"}</span>
          </div>
          <div className="readout-row">
            <span className="k">KV wall</span>
            <span className="v">
              {result == null ? "—" : result.wall == null ? "none in memory" : `~${Math.round(result.wall / 1000)}K ctx`}
            </span>
          </div>
          <div className="readout-row">
            <span className="k">efficiency source</span>
            <span className="v">{result?.kind === "fitted" ? "measured campaign (fitted)" : "unverified default"}</span>
          </div>
        </div>
      </div>
      <p className="instrument-note">
        This is the simulator's engine, live — same code the app runs. Sizes are pulled from the Hugging Face
        API; device efficiencies are fitted from published llama.cpp benchmark runs.{" "}
        <a href="/docs.html#data">How the numbers work →</a>
      </p>
    </div>
  );
}

const SHOTS = {
  board: "/shots/board.png",
  postmortem: "/shots/postmortem.png",
  verdict: "/shots/verdict.png",
};

export function Landing() {
  const scrolled = useScrolled();
  useReveal();

  const fittedCount = DEVICES.filter((d) => d.decodeEfficiency != null).length;
  const modelCount = MODELS.length;
  const benchmarkRows = Object.keys(benchmarks.decode_tok_s_8b_q4km).length;
  const pricingDate = pricing.fetchedAt.slice(0, 10);
  const g5 = (pricing.instances as Record<string, { onDemandUsdPerHour: number | null; spotUsdPerHour: number | null }>)["g5.xlarge"];
  const g6 = (pricing.instances as Record<string, { onDemandUsdPerHour: number | null; spotUsdPerHour: number | null }>)["g6.xlarge"];
  const g4dn = (pricing.instances as Record<string, { onDemandUsdPerHour: number | null; spotUsdPerHour: number | null }>)["g4dn.xlarge"];
  const g6e = (pricing.instances as Record<string, { onDemandUsdPerHour: number | null; spotUsdPerHour: number | null }>)["g6e.xlarge"];

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className={`nav${scrolled ? " scrolled" : ""}`} aria-label="Main">
        <div className="nav-inner">
          <a className="nav-brand" href="/">
            <span className="dot" aria-hidden="true" />
            clusterbreak
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#deploy">Deploy kit</a>
            <a href="/docs.html">Docs</a>
            <a href="https://github.com/LangerSword/clusterbreak" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a className="nav-cta" href="/app.html">
              Open the simulator
            </a>
          </div>
        </div>
      </nav>

      <main id="main">
        <header className="hero">
          <div className="wrap hero-inner">
            <div>
              <div className="eyebrow">GPU inference, without the guesswork</div>
              <h1>
                Build a rig. Run a model.
                <br />
                <span className="accent">Break it on purpose.</span>
              </h1>
              <p className="hero-sub">
                Clusterbreak simulates AI inference across real hardware — from a single laptop GPU to a wired
                multi-node cluster — then lets you pull a cable, throttle a link, and read exactly what died and
                why. Every number is measured or explicitly marked as unverified.
              </p>
              <div className="hero-ctas">
                <a className="btn primary" href="/app.html">
                  Open the simulator
                </a>
                <a className="btn" href="/docs.html">
                  Read the docs
                </a>
              </div>
              <div className="hero-stats">
                <div className="stat">
                  <div className="stat-num">{fittedCount}</div>
                  <div className="stat-label">devices with measured anchors</div>
                </div>
                <div className="stat">
                  <div className="stat-num">{modelCount}</div>
                  <div className="stat-label">models, sizes from the HF API</div>
                </div>
                <div className="stat">
                  <div className="stat-num">{benchmarkRows}</div>
                  <div className="stat-label">published benchmark rows fitted</div>
                </div>
                <div className="stat">
                  <div className="stat-num">$0</div>
                  <div className="stat-label">to plan — runs in your browser</div>
                </div>
              </div>
            </div>
            <Instrument />
          </div>
        </header>

        <section className="section" id="features">
          <div className="wrap">
            <div className="section-head reveal">
              <h2>Planning tools answer “will it run.” Clusterbreak shows you why it dies.</h2>
              <p>
                Fit calculators stop at a yes or no. A rig is a system — memory is split, links have speed, and
                one failed node takes the rest down with it. Clusterbreak models the system.
              </p>
            </div>
            <div className="bento">
              <div className="cell wide reveal">
                <span className="cell-tag">Break-it physics</span>
                <h3>Pull a cable mid-run. Watch the cluster react.</h3>
                <p>
                  Runs stream tokens at the speed the rig can actually sustain — pipeline stages, per-hop link
                  costs, KV cache growing with context. Unplug a node or drop a link to 0.01 GbE and the run
                  dies the way it would in a rack: the postmortem names the cause, the numbers, and the repairs.
                </p>
                <img src={SHOTS.postmortem} alt="Clusterbreak postmortem card: an unplugged RTX 3090 killed a 70B run, with the survivors' memory shortfall and suggested repairs" loading="lazy" />
              </div>
              <div className="cell half reveal">
                <span className="cell-tag">Verdict card</span>
                <h3>A verdict you can paste into a thread.</h3>
                <p>
                  Every rig gets a copyable card: throughput, fit verdict, the KV-cache wall, the weakest-node
                  prediction, and where each number came from.
                </p>
                <img src={SHOTS.verdict} alt="Verdict card showing 13.2 tok/s pipelined across two RTX 3090s, a tight fit, and a KV wall at ~13.7K context" loading="lazy" />
              </div>
              <div className="cell third reveal">
                <span className="cell-tag">Detect</span>
                <h3>Your machine, one click.</h3>
                <p>
                  The simulator reads your browser's GPU and CPU, matches it against the device catalog, and
                  drops it on the board. A local probe script covers the rest.
                </p>
              </div>
              <div className="cell third reveal">
                <span className="cell-tag">Live data</span>
                <h3>Sizes straight from Hugging Face.</h3>
                <p>
                  Search any GGUF repo in the app; sizes come from the HF API blob list, architectures from the
                  base model config. No typed-in numbers.
                </p>
              </div>
              <div className="cell third reveal">
                <span className="cell-tag">Share</span>
                <h3>Postmortems that travel.</h3>
                <p>
                  One click stores the run and returns a link. Anyone who opens it sees the same verdict card,
                  the death cause, and the data provenance.
                </p>
              </div>
              <div className="cell wide reveal">
                <span className="cell-tag">The board</span>
                <h3>An interactive rig you can rearrange.</h3>
                <p>
                  Place devices, wire them with LINK MODE, drag nodes around a 3D board. Presets seed real
                  configurations — two laptops over 1GbE, the classic 2×3090 homelab, a Mac Studio, a Steam
                  Deck — so the first useful answer takes one click.
                </p>
                <img src={SHOTS.board} alt="The Clusterbreak board: two RTX 3090 nodes wired with a 10GbE link, inspector open with the rig summary and verdict card" loading="lazy" />
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head reveal">
              <h2>Three steps to a rig you trust</h2>
              <p>No sign-up, no GPU quota, no cloud bill to find out the answer.</p>
            </div>
            <div className="steps">
              <div className="step reveal">
                <h3>Build the rig</h3>
                <p>
                  Pick devices from the catalog, or detect your own machine. Wire nodes together to model a
                  pipeline. Custom hardware accepted — with your own measured numbers.
                </p>
              </div>
              <div className="step reveal">
                <h3>Run, then break it</h3>
                <p>
                  Start a run and watch the token stream. Unplug a node, throttle a link, and see the failure
                  unfold in simulated time — with an event trail you can read.
                </p>
              </div>
              <div className="step reveal">
                <h3>Share or deploy</h3>
                <p>
                  Copy the verdict card, share the postmortem link — or generate a real CloudFormation template
                  for the exact rig and deploy it to your own AWS account.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="deploy">
          <div className="wrap">
            <div className="section-head reveal">
              <h2>The deploy kit: from simulation to real infrastructure</h2>
              <p>
                The same rig you simulated becomes a CloudFormation stack — VPC, security group, GPU nodes with
                llama.cpp served over an OpenAI-compatible endpoint. Connect your AWS account with a scoped,
                revocable role; no keys ever change hands.
              </p>
            </div>
            <div className="deploy-grid">
              <div className="reveal">
                <ul className="checklist">
                  <li>
                    <span>
                      <strong>Scoped trust, not credentials.</strong> A connect stack in your account creates a
                      role Clusterbreak assumes via STS with a per-user ExternalId. Delete the stack to revoke.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Least privilege.</strong> The deploy role can only touch <code>clusterbreak-*</code>{" "}
                      stacks; node permissions live in a separate execution role.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Auto-teardown by default.</strong> Every rig self-destructs after a set window
                      (6h default) — an EventBridge sweep deletes expired stacks. No runaway bills.
                    </span>
                  </li>
                  <li>
                    <span>
                      <strong>Real prices, timestamped.</strong> Costs come from the AWS Pricing API, refreshed by
                      a script and shown with their fetch date.
                    </span>
                  </li>
                </ul>
              </div>
              <div className="reveal">
                <table className="price-table" aria-label={`AWS GPU instance prices, ap-south-1, fetched ${pricingDate}`}>
                  <thead>
                    <tr>
                      <th scope="col">Instance</th>
                      <th scope="col">On-demand</th>
                      <th scope="col">Spot</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>g4dn.xlarge</td>
                      <td>${g4dn?.onDemandUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                      <td className="dim">${g4dn?.spotUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                    </tr>
                    <tr>
                      <td>g5.xlarge</td>
                      <td>${g5?.onDemandUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                      <td className="dim">${g5?.spotUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                    </tr>
                    <tr>
                      <td>g6.xlarge</td>
                      <td>${g6?.onDemandUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                      <td className="dim">${g6?.spotUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                    </tr>
                    <tr>
                      <td>g6e.xlarge</td>
                      <td>${g6e?.onDemandUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                      <td className="dim">${g6e?.spotUsdPerHour?.toFixed(2) ?? "—"}/hr</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--dim-2)", marginTop: "var(--s3)" }}>
                  ap-south-1 · fetched {pricingDate} from the AWS Pricing API. Spot moves constantly.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="docs-teaser reveal">
              <div>
                <h3>Documentation</h3>
                <p>
                  The simulator, the break-it physics, verdict cards, share links, the AWS deploy kit, and the
                  full data-accuracy model — every claim with its source.
                </p>
              </div>
              <a className="btn" href="/docs.html">
                Read the docs →
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="meta">
            <span>clusterbreak — build a rig. run a model. break it.</span>
          </div>
          <div className="meta">
            <ApiStatus />
            <a href="/app.html">Simulator</a>
            <a href="/docs.html">Docs</a>
            <a href="https://github.com/LangerSword/clusterbreak" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://github.com/LangerSword/clusterbreak/blob/main/LICENSE" target="_blank" rel="noreferrer">
              MIT
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
