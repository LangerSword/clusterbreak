import type { ReportPayload } from "./report";

/** Clusterbreak API (API Gateway HTTP API → Lambda → DynamoDB), ap-south-1. */
export const API_BASE = "https://wa7rwqxhk0.execute-api.ap-south-1.amazonaws.com";

export async function shareRun(payload: ReportPayload): Promise<string> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`share failed (${res.status}) ${detail.slice(0, 120)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("share failed: no id returned");
  return data.id;
}

export async function fetchRun(id: string): Promise<ReportPayload> {
  const res = await fetch(`${API_BASE}/runs/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error("report not found — it may have expired (reports are kept 90 days)");
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const data = (await res.json()) as { report?: ReportPayload };
  if (!data.report) throw new Error("malformed response");
  return data.report;
}

/* ------------------------------------------------------------------ *
 * Secure AWS connect (v0.3.0 API)
 *
 * Clusterbreak never sees or stores AWS keys. The user deploys a small
 * connect stack in their own account; it creates a role that trusts the
 * Clusterbreak backend role ARN + an ExternalId, scoped to
 * clusterbreak-* stacks only. The backend assumes that role via STS and
 * mints a session id. Deleting the stack revokes access instantly.
 * ------------------------------------------------------------------ */

/** Region the whole product runs in (matches the backend). */
export const AWS_REGION = "ap-south-1";
/** The backend role the connect stack trusts (public — it is a principal ARN). */
export const CONNECT_PRINCIPAL_ARN = "arn:aws:iam::703651068111:role/clusterbreak-lambda-role";
/** Public S3 copy of the connect template for the one-click console flow. */
export const CONNECT_TEMPLATE_URL =
  "https://clusterbreak-templates-703651068111.s3.ap-south-1.amazonaws.com/connect-role.yaml";

export interface AwsSession {
  sessionId: string;
  accountId: string;
  region: string;
  gpuQuotaVcpus: number | null;
  expiresInHours: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; detail?: string };
  if (!res.ok || data.ok === false) {
    const why = data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `http ${res.status}`);
    throw new Error(why);
  }
  return data;
}

export function connectAws(roleArn: string, externalId: string): Promise<AwsSession> {
  return post<AwsSession>("/aws/connect", { roleArn, externalId });
}

export interface ProvisionArgs {
  sessionId: string;
  stackName: string;
  template: string;
  keyName: string;
  sshCidr: string;
  mode: "on-demand" | "spot";
  gpuMode: "gpu" | "cpu";
  contextTokens: number;
  modelUrl?: string | null;
  autoTeardownHours: number;
}

export interface ProvisionResult {
  stackId: string;
  stackName: string;
  accountId: string;
  autoTeardownHours: number | null;
}

export function provisionRig(args: ProvisionArgs): Promise<ProvisionResult> {
  return post<ProvisionResult>("/aws/provision", args);
}

export interface StackStatus {
  status: string;
  reason: string | null;
  outputs: Record<string, string>;
  accountId: string;
}

export async function getStackStatus(sessionId: string, stackName: string): Promise<StackStatus> {
  const res = await fetch(`${API_BASE}/aws/status/${encodeURIComponent(sessionId)}/${encodeURIComponent(stackName)}`);
  const data = (await res.json().catch(() => ({}))) as StackStatus & { ok?: boolean; error?: string; detail?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `http ${res.status}`));
  }
  return data;
}

export function teardownRig(sessionId: string, stackName: string): Promise<{ stackName: string; status: string }> {
  return post<{ stackName: string; status: string }>("/aws/teardown", { sessionId, stackName });
}

export interface RigStack {
  name: string;
  status: string;
  createdAt: string | null;
  outputs: Record<string, string>;
  teardownAt: number | null;
  apiKey: string | null;
  mine: boolean;
}

/**
 * Every clusterbreak-* stack in the connected account — the account is the
 * source of truth, so a page refresh (or a different browser) still sees the
 * rigs that are running and can tear them down.
 */
export async function listStacks(sessionId: string): Promise<{ accountId: string; stacks: RigStack[] }> {
  const res = await fetch(`${API_BASE}/aws/stacks/${encodeURIComponent(sessionId)}`);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    accountId?: string;
    stacks?: RigStack[];
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `http ${res.status}`));
  }
  return { accountId: data.accountId ?? "", stacks: data.stacks ?? [] };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatReply {
  reply: string;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Chat with the model running on a provisioned rig, proxied over HTTPS. */
export function chatWithRig(
  sessionId: string,
  stackName: string,
  messages: ChatMessage[],
  maxTokens = 256,
): Promise<ChatReply> {
  return post<ChatReply>("/aws/chat", { sessionId, stackName, messages, maxTokens });
}

/** OpenAI-compatible endpoint + key for pointing any harness at the rig. */
export function harnessEnv(endpoint: string, apiKey: string | null): string {
  const base = endpoint.replace(/\/+$/, "");
  return `OPENAI_BASE_URL=${base}/v1\nOPENAI_API_KEY=${apiKey ?? "<api-key>"}\nOPENAI_MODEL=${base.includes(":8080") ? "local" : "local"}`;
}

/** A fresh per-user secret for the connect stack's trust policy. */
export function generateExternalId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "cb-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** One-click CloudFormation console link, prefilled with our template + params. */
export function connectStackUrl(externalId: string): string {
  const base = `https://${AWS_REGION}.console.aws.amazon.com/cloudformation/home?region=${AWS_REGION}`;
  const params = new URLSearchParams({
    templateURL: CONNECT_TEMPLATE_URL,
    stackName: "clusterbreak-connect",
    param_ExternalId: externalId,
    param_ClusterbreakPrincipalArn: CONNECT_PRINCIPAL_ARN,
  });
  return `${base}#/stacks/quickcreate?${params.toString()}`;
}
