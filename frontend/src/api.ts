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
