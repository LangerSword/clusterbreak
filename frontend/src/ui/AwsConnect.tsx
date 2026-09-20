import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectAws,
  connectStackUrl,
  generateExternalId,
  listStacks,
  provisionRig,
  teardownRig,
  type AwsSession,
  type RigStack,
} from "../api";
import { ChatDrawer } from "./ChatDrawer";

/**
 * Connect your own AWS account — the production flow.
 *
 * Clusterbreak never sees or stores AWS keys. The user deploys a small
 * connect stack (one click) in their account; it creates a role that trusts
 * the Clusterbreak backend role ARN plus a per-user ExternalId, scoped to
 * clusterbreak-* stacks only. The backend assumes it via STS. Deleting the
 * stack revokes access instantly. Everything below is real API calls — no
 * mocked account.
 */

const SS = {
  ext: "cb.aws.externalId",
  session: "cb.aws.session",
  stack: "cb.aws.stackName",
};

const TERMINAL = /^(CREATE|UPDATE|DELETE)_(COMPLETE|FAILED|ROLLBACK_COMPLETE)$/;

const fmtTeardown = (ts: number | null) => {
  if (!ts) return "no auto-teardown";
  const mins = Math.round((ts * 1000 - Date.now()) / 60000);
  if (mins <= 0) return "teardown due";
  if (mins < 90) return `auto-teardown in ${mins}m`;
  return `auto-teardown in ${Math.round(mins / 60)}h`;
};

export interface AwsConnectProps {
  /** The generated CloudFormation template for the current rig (null = no deployable rig). */
  template: string | null;
  /** Human summary of what will be provisioned, e.g. "2 × g5.xlarge". */
  planSummary: string;
  /** Verified HF model URL to pull on the instance, when known. */
  modelUrl: string | null;
  contextTokens: number;
  /** Default stack name suggestion, e.g. "clusterbreak-dual-3090". */
  defaultStackName: string;
  gpuMode: "gpu" | "cpu";
}

export function AwsConnect({
  template,
  planSummary,
  modelUrl,
  contextTokens,
  defaultStackName,
  gpuMode,
}: AwsConnectProps) {
  const [open, setOpen] = useState(false);
  const [extId, setExtId] = useState(() => localStorage.getItem(SS.ext) ?? "");
  const [session, setSession] = useState<AwsSession | null>(() => {
    try {
      const raw = localStorage.getItem(SS.session);
      return raw ? (JSON.parse(raw) as AwsSession) : null;
    } catch {
      return null;
    }
  });
  const [roleArn, setRoleArn] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "provision" | "teardown" | "refresh">(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [keyName, setKeyName] = useState("");
  const [sshCidr, setSshCidr] = useState("");
  const [teardownHours, setTeardownHours] = useState(6);
  const [mode, setMode] = useState<"on-demand" | "spot">("on-demand");
  const [stackName, setStackName] = useState(() => localStorage.getItem(SS.stack) ?? defaultStackName);
  const [stacks, setStacks] = useState<RigStack[]>([]);
  const [chatStack, setChatStack] = useState<RigStack | null>(null);

  const pollRef = useRef<number | null>(null);

  // keep the external id stable across reloads — it must match the deployed stack
  useEffect(() => {
    if (!extId) {
      const id = generateExternalId();
      setExtId(id);
      localStorage.setItem(SS.ext, id);
    }
  }, [extId]);

  useEffect(() => {
    if (session) localStorage.setItem(SS.session, JSON.stringify(session));
    else localStorage.removeItem(SS.session);
  }, [session]);

  useEffect(() => {
    localStorage.setItem(SS.stack, stackName);
  }, [stackName]);

  /** Re-read every clusterbreak-* stack from the account (source of truth). */
  const refresh = useCallback(async (sid: string, quiet = false) => {
    if (!quiet) setBusy("refresh");
    try {
      const { stacks: list } = await listStacks(sid);
      setStacks(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/session_not_found/.test(msg)) {
        setSession(null);
        setStacks([]);
        setError("session expired — reconnect to keep managing rigs");
      } else if (!quiet) {
        setError(msg);
      }
    } finally {
      if (!quiet) setBusy(null);
    }
  }, []);

  // on load / on reconnect: re-discover rigs from AWS so a refresh loses nothing
  useEffect(() => {
    if (session) void refresh(session.sessionId, true);
  }, [session, refresh]);

  // poll while any stack is mid-transition
  useEffect(() => {
    const inFlight = stacks.some((st) => !TERMINAL.test(st.status));
    if (!session || !inFlight) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(() => void refresh(session.sessionId, true), 8000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [session, stacks, refresh]);

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    });
  };

  const doConnect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const s = await connectAws(roleArn.trim(), extId);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doProvision = async () => {
    if (!session || !template) return;
    setBusy("provision");
    setError(null);
    try {
      const r = await provisionRig({
        sessionId: session.sessionId,
        stackName,
        template,
        keyName: keyName.trim(),
        sshCidr: sshCidr.trim(),
        mode,
        gpuMode,
        contextTokens,
        modelUrl,
        autoTeardownHours: teardownHours,
      });
      void r;
      await refresh(session.sessionId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doTeardown = async (name: string) => {
    if (!session) return;
    setBusy("teardown");
    setError(null);
    try {
      await teardownRig(session.sessionId, name);
      await refresh(session.sessionId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const liveRigs = useMemo(() => stacks.filter((st) => !/^DELETE_COMPLETE/.test(st.status)), [stacks]);

  return (
    <section className="aws">
      <button className="aws-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="aws-title">AWS ACCOUNT</span>
        <span className={`api-dot ${session ? "up" : ""}`} aria-hidden="true" />
        <span className="aws-state">
          {session ? `${session.accountId} · ${liveRigs.length} rig${liveRigs.length === 1 ? "" : "s"}` : "not connected"}
        </span>
        <span className="aws-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="aws-body">
          <p className="note">
            Deploy rigs into <b>your own account</b>. Clusterbreak never sees or stores your keys — it
            assumes a scoped role you install with one click and can delete any time.
          </p>

          {!session ? (
            <>
              <div className="aws-step">
                <span className="aws-step-n">1</span> deploy the connect stack <i>(one time, ~30 s)</i>
              </div>
              <div className="aws-field">
                <span className="aws-label">external id (already filled into the stack)</span>
                <div className="aws-inline">
                  <code className="aws-code">{extId || "…"}</code>
                  <button onClick={() => copy("ext", extId)}>{copied === "ext" ? "✓" : "COPY"}</button>
                </div>
              </div>
              <div className="aws-actions">
                <a className="aws-launch" href={connectStackUrl(extId)} target="_blank" rel="noreferrer">
                  LAUNCH STACK IN AWS CONSOLE ↗
                </a>
                <a className="aws-alt" href="/connect-role.yaml" download>
                  download .yaml
                </a>
              </div>
              <p className="note">
                In the console: Create stack → it fills the ExternalId → create. Then copy the{" "}
                <code>DeployRoleArn</code> output below.
              </p>

              <div className="aws-step">
                <span className="aws-step-n">2</span> paste the role ARN + connect
              </div>
              <input
                className="aws-input"
                placeholder="arn:aws:iam::123456789012:role/ClusterbreakDeployRole"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                spellCheck={false}
              />
              <button
                className="copy-verdict aws-cta"
                onClick={doConnect}
                disabled={busy === "connect" || !/^arn:aws:iam::\d{12}:role\/ClusterbreakDeployRole$/.test(roleArn.trim())}
              >
                {busy === "connect" ? "ASSUMING ROLE…" : "CONNECT TO MY AWS ACCOUNT"}
              </button>
            </>
          ) : (
            <>
              <div className="aws-account">
                <div className="kv">
                  <span>account</span>
                  <b>{session.accountId}</b>
                </div>
                <div className="kv">
                  <span>region</span>
                  <b>{session.region}</b>
                </div>
                <div className="kv">
                  <span>gpu quota (L-DB2E81BA)</span>
                  <b>{session.gpuQuotaVcpus == null ? "—" : `${session.gpuQuotaVcpus} vCPU`}</b>
                </div>
                <div className="kv">
                  <span>session expires</span>
                  <b>{session.expiresInHours} h</b>
                </div>
              </div>
              {session.gpuQuotaVcpus === 0 && (
                <p className="note error">
                  GPU quota is 0 — request an increase (Service Quotas → EC2 → “All G and VT Spot Instance
                  Requests”) before provisioning a GPU rig.
                </p>
              )}

              <div className="aws-step">
                <span className="aws-step-n">4</span> provision this rig
              </div>
              {!template ? (
                <p className="note">
                  No EC2-deployable nodes on the board yet — place NVIDIA GPUs to build a template.
                </p>
              ) : (
                <>
                  <div className="kv">
                    <span>to create</span>
                    <b>{planSummary}</b>
                  </div>
                  <div className="aws-grid">
                    <label className="aws-field">
                      <span className="aws-label">key pair name</span>
                      <input
                        className="aws-input"
                        placeholder="my-ec2-key"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        spellCheck={false}
                      />
                    </label>
                    <label className="aws-field">
                      <span className="aws-label">ssh cidr</span>
                      <input
                        className="aws-input"
                        placeholder="1.2.3.4/32"
                        value={sshCidr}
                        onChange={(e) => setSshCidr(e.target.value)}
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <div className="aws-grid">
                    <label className="aws-field">
                      <span className="aws-label">pricing</span>
                      <select value={mode} onChange={(e) => setMode(e.target.value as "on-demand" | "spot")}>
                        <option value="on-demand">on-demand</option>
                        <option value="spot">spot</option>
                      </select>
                    </label>
                    <label className="aws-field">
                      <span className="aws-label">auto-teardown</span>
                      <select value={teardownHours} onChange={(e) => setTeardownHours(Number(e.target.value))}>
                        <option value={1}>1 hour</option>
                        <option value={6}>6 hours</option>
                        <option value={24}>24 hours</option>
                        <option value={0}>never (not advised)</option>
                      </select>
                    </label>
                  </div>
                  <label className="aws-field">
                    <span className="aws-label">stack name</span>
                    <input
                      className="aws-input"
                      value={stackName}
                      onChange={(e) => setStackName(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                      spellCheck={false}
                    />
                  </label>
                  <button
                    className="copy-verdict aws-cta"
                    onClick={doProvision}
                    disabled={
                      busy === "provision" ||
                      !keyName.trim() ||
                      !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(sshCidr.trim()) ||
                      !/^clusterbreak-[a-z0-9-]{3,40}$/.test(stackName)
                    }
                  >
                    {busy === "provision" ? "CREATING STACK…" : "PROVISION IN MY ACCOUNT →"}
                  </button>
                  <p className="note">
                    Every rig gets its own llama.cpp bearer key (generated server-side, never stored in this
                    page) and an auto-teardown the backend enforces even if you close the tab.
                  </p>
                </>
              )}

              <div className="aws-step">
                <span className="aws-step-n">3</span> your rigs{" "}
                <button className="aws-alt" onClick={() => void refresh(session.sessionId)} disabled={busy === "refresh"}>
                  {busy === "refresh" ? "refreshing…" : "refresh"}
                </button>
              </div>
              {liveRigs.length === 0 && (
                <p className="note">
                  Nothing running in this account. Provision one below — it shows up here, and survives a page
                  refresh, because this list comes from AWS rather than from this tab.
                </p>
              )}
              {liveRigs.map((st) => {
                const endpoint = st.outputs.Node1Endpoint ?? st.outputs.LlamaCppUrl ?? "";
                const ready = st.status === "CREATE_COMPLETE";
                return (
                  <div className="rig" key={st.name}>
                    <div className="rig-head">
                      <span className={`api-dot ${ready ? "up" : /FAILED|ROLLBACK/.test(st.status) ? "down" : "checking"}`} />
                      <b className="rig-name">{st.name}</b>
                      <span className="rig-status">{st.status}</span>
                    </div>
                    <div className="rig-meta">
                      {endpoint || "endpoint appears once the stack completes"} · {fmtTeardown(st.teardownAt)}
                    </div>
                    <div className="rig-actions">
                      <button
                        className="copy-verdict"
                        disabled={!ready}
                        onClick={() => setChatStack(st)}
                        title={ready ? "chat with the model on this rig" : "wait for CREATE_COMPLETE"}
                      >
                        CHAT →
                      </button>
                      <button className="aws-alt" onClick={() => void doTeardown(st.name)} disabled={busy === "teardown"}>
                        tear down
                      </button>
                    </div>
                  </div>
                );
              })}

              <button className="aws-alt aws-disconnect" onClick={() => setSession(null)}>
                disconnect (keeps the stack role in your account)
              </button>
            </>
          )}

          {error && <p className="note error">{error}</p>}
        </div>
      )}

      {chatStack && session && (
        <ChatDrawer sessionId={session.sessionId} stack={chatStack} onClose={() => setChatStack(null)} />
      )}
    </section>
  );
}
