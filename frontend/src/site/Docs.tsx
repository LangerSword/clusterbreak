import { useEffect, useState } from "react";

const SECTIONS: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: "Start",
    items: [
      { id: "overview", label: "Overview" },
      { id: "simulator", label: "The simulator" },
      { id: "breaking", label: "Breaking things" },
    ],
  },
  {
    group: "Outputs",
    items: [
      { id: "verdict", label: "Verdict card" },
      { id: "share", label: "Share reports" },
    ],
  },
  {
    group: "Real AWS",
    items: [
      { id: "deploy", label: "Deploy kit" },
      { id: "connect", label: "Connect your account" },
      { id: "provision", label: "Provision & teardown" },
    ],
  },
  {
    group: "Trust",
    items: [
      { id: "data", label: "Data accuracy" },
      { id: "api", label: "API reference" },
      { id: "limits", label: "Limitations" },
    ],
  },
];

function useActiveSection() {
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const ids = SECTIONS.flatMap((g) => g.items.map((i) => i.id));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

export function Docs() {
  const active = useActiveSection();

  return (
    <>
      <a className="skip-link" href="#docs-main">
        Skip to content
      </a>
      <nav className="nav scrolled" aria-label="Main">
        <div className="nav-inner">
          <a className="nav-brand" href="/">
            <span className="nav-mark" aria-hidden="true">
              ⌁
            </span>
            clusterbreak
          </a>
          <div className="nav-links">
            <a href="/#features">Features</a>
            <a href="/#deploy">Deploy kit</a>
            <a href="/docs.html">Docs</a>
            <a href="https://github.com/LangerSword/clusterbreak" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <div className="nav-cta">
            <a className="btn primary sm" href="/app.html">
              Open the simulator
            </a>
          </div>
        </div>
      </nav>

      <div className="docs-shell">
        <nav className="docs-nav" aria-label="Documentation">
          {SECTIONS.map((g) => (
            <div key={g.group}>
              <div className="group">{g.group}</div>
              {g.items.map((i) => (
                <a key={i.id} href={`#${i.id}`} className={active === i.id ? "active" : undefined}>
                  {i.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <main className="docs-main" id="docs-main">
          <h1>Clusterbreak documentation</h1>

          <section id="overview">
            <h2>Overview</h2>
            <p>
              Clusterbreak is a GPU-inference simulator that runs entirely in your browser, plus a deploy kit that
              turns a simulated rig into real AWS infrastructure. It exists for one class of question: <strong>not
              “will it run” but “how does it fail”</strong> — which node runs out of memory first, what a slow
              link does to throughput, and what survives when a node disappears mid-run.
            </p>
            <p>
              Three surfaces:
            </p>
            <ul>
              <li>
                <strong><a href="/app.html">The simulator</a></strong> — a 3D board where you place devices, wire
                them, run models, and break things.
              </li>
              <li>
                <strong><a href="/docs.html">These docs</a></strong> — how everything works and what each number
                means.
              </li>
              <li>
                <strong>The API</strong> — stores shared reports and drives real AWS provisioning (
                <a href="#api">API reference</a>).
              </li>
            </ul>
          </section>

          <section id="simulator">
            <h2>The simulator</h2>
            <p>
              The board starts empty. Add devices from the catalog (23 device types across NVIDIA, Apple, AMD,
              and generic unified-memory hardware), or press <strong>DETECT THIS MACHINE</strong> to read your
              actual GPU from the browser and match it against the catalog. For deeper probes, run{" "}
              <code>python3 tools/detect_hardware.py</code> locally and paste its JSON into the import box.
            </p>
            <h3>Custom hardware</h3>
            <p>
              Anything not in the catalog can be entered manually — name, memory, bandwidth. If you've run a
              real benchmark on it (<code>llama-bench -m model.gguf -p 1024 -n 1024</code>), enter the measured
              tok/s and the device is calibrated with the same formula the dataset uses. Your measurement beats
              our estimate, always.
            </p>
            <h3>Models</h3>
            <p>
              The model picker ships with a catalog of GGUF models, and the <strong>MODEL LIBRARY</strong> panel
              searches Hugging Face live. Adding a model pulls its exact file sizes from the HF API blob list and
              resolves its architecture from the base-model config. If the architecture can't be resolved, the
              model is added with a warning and the simulator refuses to print tok/s for it — an unverifiable
              number is worse than no number.
            </p>
            <h3>Wiring</h3>
            <p>
              <strong>LINK MODE</strong> + two node clicks creates a link; the inspector lets you set its speed
              (0.01–100 GbE). Linked nodes become pipeline stages: throughput is modeled per stage, with per-hop
              transfer cost at the link's actual speed.
            </p>
          </section>

          <section id="breaking">
            <h2>Breaking things</h2>
            <p>
              Press <strong>RUN</strong> and tokens start streaming at the rate the rig can sustain. Context
              grows with every token, and so does the KV cache — when a node's memory can't hold its share, the
              run dies with a named cause.
            </p>
            <h3>Fault injection</h3>
            <ul>
              <li>
                <strong>Unplug a node</strong> (select it → UNPLUG) — the pipeline recomputes on survivors. If
                they can't hold the model, the run dies and the postmortem says by how much.
              </li>
              <li>
                <strong>Throttle a link</strong> — change its speed mid-run and watch latency move the
                throughput number in real time.
              </li>
            </ul>
            <h3>Postmortem</h3>
            <p>
              Every death produces a card: the cause, the exact shortfall, a suggested repair list, and the
              last events of the run on a simulated-time trail. The same card appears when a run completes
              normally.
            </p>
          </section>

          <section id="verdict">
            <h2>Verdict card</h2>
            <p>A copyable summary of the current rig, computed live:</p>
            <div className="table-wrap"><table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>RIG</td>
                  <td>Devices on the board, and whether they're wired into one pipeline.</td>
                </tr>
                <tr>
                  <td>MODEL</td>
                  <td>Model, quant, context — and the footprint in GB (weights + KV at that context).</td>
                </tr>
                <tr>
                  <td>SPEED</td>
                  <td>Pipelined tok/s if wired, otherwise per-node tok/s (a <code>~</code> marks unverified estimates).</td>
                </tr>
                <tr>
                  <td>FIT</td>
                  <td>comfortable / tight / does-not-fit, against capacity = memory − 0.5 GB runtime reserve per node.</td>
                </tr>
                <tr>
                  <td>WALL</td>
                  <td>The context length where KV growth would exhaust memory (the “KV wall”), or none in memory.</td>
                </tr>
                <tr>
                  <td>BREAK</td>
                  <td>What happens if you unplug the weakest node right now — computed, not guessed.</td>
                </tr>
                <tr>
                  <td>DATA</td>
                  <td>Provenance: HF API for sizes, measured campaigns for efficiencies.</td>
                </tr>
              </tbody>
            </table></div>
          </section>

          <section id="share">
            <h2>Share reports</h2>
            <p>
              On a finished run, <strong>SHARE REPORT</strong> stores a compact summary (bounded, validated, no
              personal data) and returns a link like <code>/app.html?report=abc123def4</code>. Anyone opening it
              gets a read-only page with the postmortem, the verdict card, and the data note. Reports expire
              after 90 days; ids are random, so links are the capability.
            </p>
            <p>
              Old-format links (<code>/?report=…</code>) are forwarded automatically — nothing shared ever
              breaks.
            </p>
          </section>

          <section id="deploy">
            <h2>Deploy kit</h2>
            <p>
              With NVIDIA GPUs on the board, the inspector's <strong>DEPLOY KIT → AWS</strong> panel maps each
              node to the nearest EC2 GPU class (RTX 3090 → g5.xlarge, 5090-class → g6e.xlarge, and so on —
              with the mismatch stated out loud, because cloud silicon is not your card) and shows live
              on-demand and spot prices from the vendored AWS Pricing snapshot.
            </p>
            <p>
              <strong>DOWNLOAD CLOUDFORMATION TEMPLATE</strong> gives you the real stack: a VPC, public subnet,
              internet gateway, a security group restricted to your CIDR, one EC2 node per device (spot-capable
              via launch templates), and a userdata bootstrap that installs the GPU driver, pulls the model from
              Hugging Face, and serves it with llama.cpp over an OpenAI-compatible endpoint. The template is
              linted with cfn-lint in CI — zero errors.
            </p>
            <pre><code>{`aws cloudformation deploy \\
  --template-file clusterbreak-rig.yaml \\
  --stack-name clusterbreak-rig \\
  --parameter-overrides KeyName=<your-key> SshCidr=$(curl -s ifconfig.me)/32`}</code></pre>
          </section>

          <section id="connect">
            <h2>Connect your account</h2>
            <p>
              The simulator's <strong>AWS ACCOUNT</strong> panel (inspector, below the deploy kit) drives the
              whole thing. Connect once, then provision any rig you've simulated. Here is exactly what happens:
            </p>
            <ol>
              <li>
                <strong>Generate an ExternalId.</strong> The panel makes a fresh <code>cb-…</code> secret for you
                and keeps it in your browser session. It is the only thing that makes your role assumable — and
                only by Clusterbreak's backend.
              </li>
              <li>
                <strong>Deploy the connect stack.</strong>{" "}
                <code>LAUNCH STACK IN AWS CONSOLE ↗</code> opens CloudFormation quick-create with the template
                URL and both parameters already filled in. You review it and click create. It builds:
                <ul>
                  <li>
                    <strong>ClusterbreakDeployRole</strong> — assumable only by the Clusterbreak backend role
                    (<code>arn:aws:iam::703651068111:role/clusterbreak-lambda-role</code>), only with your{" "}
                    <code>ExternalId</code>, and limited to CloudFormation actions on{" "}
                    <code>clusterbreak-*</code> stacks.
                  </li>
                  <li>
                    <strong>ClusterbreakStackRole</strong> — the execution role CloudFormation uses to create the
                    rig's VPC and instances. It never needs to be assumed by Clusterbreak itself.
                  </li>
                </ul>
                Prefer to read it first? <code>download .yaml</code> gives you the same ~120 lines to audit, or
                deploy it yourself with <code>aws cloudformation deploy</code>.
              </li>
              <li>
                <strong>Paste the role ARN.</strong> Copy the <code>DeployRoleArn</code> output back into the
                panel and hit connect. Clusterbreak calls STS <code>AssumeRole</code> with your ExternalId — if
                either is wrong, the call fails and nothing is stored. On success you get a session showing your
                account id, the region, and your GPU vCPU quota.
              </li>
            </ol>
            <div className="callout ok">
              <b>What Clusterbreak never has</b>
              Your access keys, your secret keys, or any long-lived credential. It stores the role ARN and
              ExternalId you pasted, and assumes the role on demand for the actions you trigger. To revoke
              everything: delete the connect stack in your account. There is no other switch, and no hidden one.
            </div>
          </section>

          <section id="provision">
            <h2>Provision &amp; teardown</h2>
            <p>
              With a session open, the panel's <strong>provision</strong> step takes the same CloudFormation
              template the download button produces and creates it in <em>your</em> account through the assumed
              role. You choose the key pair, your SSH CIDR, on-demand or spot, and the auto-teardown window.
              Stack creation takes a few minutes; the node bootstraps itself (driver install may take one reboot
              — a systemd unit waits for the GPU and starts llama.cpp on boot), then the panel shows the live
              stack status and the outputs, including an OpenAI-compatible endpoint you can open directly.
            </p>
            <div className="callout warn">
              <b>Quota is yours to fix</b>
              G-instance quota starts at 0 vCPUs on new accounts. If the panel reports{" "}
              <code>gpu quota: 0 vCPU</code>, request an increase in Service Quotas → EC2 → “All G and VT
              Instance Requests” (a few hours, usually approved). CPU-only rigs need no quota.
            </div>
            <p>
              <strong>Auto-teardown is on by default (6 hours).</strong> An EventBridge sweep runs every 15
              minutes and deletes expired stacks through the same assumed role — server-side, so it works even
              if you close the tab. You can also tear down manually from the panel's{" "}
              <code>tear down now</code>, or with <code>aws cloudformation delete-stack</code>. This default
              exists because we left a g5.xlarge running overnight during development and paid for it; the
              product should not let that happen to you.
            </p>
            <div className="callout">
              <b>Using the demo account instead</b>
              If you are evaluating Clusterbreak and don't want to connect your own account yet, the manual path
              still works end-to-end: <code>DOWNLOAD CLOUDFORMATION TEMPLATE</code>, then{" "}
              <code>aws cloudformation deploy</code> in whichever account you like. The template is the product;
              the connect flow is just the convenience layer on top of it.
            </div>
          </section>

          <section id="data">
            <h2>Data accuracy</h2>
            <p>
              Every number in the simulator traces to a source. The full dataset is regenerable with one
              command: <code>python3 tools/refresh_data.py</code> (sizes) and{" "}
              <code>python3 tools/refresh_pricing.py</code> (AWS prices).
            </p>
            <div className="table-wrap"><table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Source</th>
                  <th scope="col">Guarantee</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Model sizes</td>
                  <td>Hugging Face API (<code>?blobs=true</code>)</td>
                  <td>Exact blob sums; re-fetched by the claim grader</td>
                </tr>
                <tr>
                  <td>Device efficiency</td>
                  <td>Published llama.cpp benchmark campaigns</td>
                  <td>Fitted per device from measured rows (15 anchors)</td>
                </tr>
                <tr>
                  <td>Unverified devices</td>
                  <td>—</td>
                  <td>Marked <code>~</code> in the UI; never shown as measured</td>
                </tr>
                <tr>
                  <td>AWS prices</td>
                  <td>AWS Pricing API + spot history</td>
                  <td>Vendored with fetch timestamp; spot noted as moving</td>
                </tr>
                <tr>
                  <td>Cloud vs consumer</td>
                  <td>—</td>
                  <td>Stated in the deploy kit: EC2 silicon differs, tok/s will differ</td>
                </tr>
              </tbody>
            </table></div>
            <p>
              A deterministic grader (<code>tools/grade_claims.py</code>) recomputes every fitted number from raw
              sources, re-fetches the live APIs, runs the test suites, and proves itself with negative controls
              — injected corruptions must be caught. Current score: 13/13.
            </p>
          </section>

          <section id="api">
            <h2>API reference</h2>
            <p>
              Base URL: <code>https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com</code>
            </p>
            <div className="table-wrap"><table className="docs-table">
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>GET /health</td>
                  <td>Liveness + version.</td>
                </tr>
                <tr>
                  <td>POST /runs</td>
                  <td>Store a run report (≤8 KB, validated); returns a random id.</td>
                </tr>
                <tr>
                  <td>GET /runs/&#123;id&#125;</td>
                  <td>Fetch a stored report.</td>
                </tr>
                <tr>
                  <td>POST /aws/connect</td>
                  <td>Verify a connect stack by assuming its role; returns a 24h session id + your GPU quota.</td>
                </tr>
                <tr>
                  <td>POST /aws/provision</td>
                  <td>Create a rig stack in your account (template + parameters + auto-teardown window).</td>
                </tr>
                <tr>
                  <td>GET /aws/status/&#123;session&#125;/&#123;stack&#125;</td>
                  <td>Stack status, outputs, and failure reasons.</td>
                </tr>
                <tr>
                  <td>POST /aws/teardown</td>
                  <td>Delete a rig stack.</td>
                </tr>
              </tbody>
            </table></div>
          </section>

          <section id="limits">
            <h2>Limitations</h2>
            <ul>
              <li>
                <strong>The simulation is a model.</strong> It uses measured anchors and fitted efficiencies, not
                a cycle-accurate emulator. The <a href="https://github.com/LangerSword/clusterbreak/blob/main/docs/limitations.md" target="_blank" rel="noreferrer">limitations doc</a> lists every simplification.
              </li>
              <li>
                <strong>Cloud GPU tok/s is unverified.</strong> The first real g5 deployment is verified for
                plumbing; a measured cloud-GPU benchmark row is still on the list.
              </li>
              <li>
                <strong>Auto-teardown windows are honored by a scheduled sweep</strong> (15-minute granularity),
                not a hard kill switch — plan for up to 15 minutes of extra runtime.
              </li>
              <li>
                <strong>Single-node serving in the deploy kit.</strong> The template boots one llama.cpp server
                per node; distributed serving across nodes (llama.cpp RPC / vLLM) is roadmap.
              </li>
            </ul>
          </section>
        </main>
      </div>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="meta">
            <span>clusterbreak — build a rig. run a model. break it.</span>
          </div>
          <div className="meta">
            <a href="/app.html">Simulator</a>
            <a href="/">Home</a>
            <a href="https://github.com/LangerSword/clusterbreak" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
