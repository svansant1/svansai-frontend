"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CyberJob, CyberPolicy, CyberRunRequest } from "@/lib/cyber/contracts";
type Review = { id: string; state: string; hash: string; request: CyberRunRequest; policy: CyberPolicy; expiresAt: string };
export default function CyberRuns({ userId, projectId, conversationId, revision }: { userId: string; projectId: string; conversationId: string; revision: number }) {
  const [runs, setRuns] = useState<CyberJob[]>([]), [configured, setConfigured] = useState(false);
  const [review, setReview] = useState<Review | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const api = useCallback(async (url: string, method = "GET", body?: unknown, key?: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session || data.session.user.id !== userId) throw new Error("Sign in again.");
    const response = await fetch(url, { method, cache: "no-store", headers: { Authorization: "Bearer " + data.session.access_token,
      ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Cyber run request failed.");
    return result;
  }, [userId]);
  const refresh = useCallback(async () => {
    const result = await api("/api/cyber/runs?projectId=" + encodeURIComponent(projectId) + "&conversationId=" + encodeURIComponent(conversationId));
    if (alive.current) { setConfigured(result.configured); setRuns(result.runs); }
  }, [api, projectId, conversationId]);
  useEffect(() => {
    void refresh().catch(e => { if (alive.current) setError(e.message); });
    const interval = window.setInterval(() => { void refresh().catch(e => { if (alive.current) setError(e.message); }); }, 10000);
    return () => clearInterval(interval); // Polling is status-only, never owner activity.
  }, [refresh]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); await refresh(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Action failed."); }
    finally { if (alive.current) setBusy(false); }
  };
  return <details style={{ marginTop: 10 }}>
    <summary>Isolated Cyber training runs</summary>
    <p>Fixed HTTP-header comparison against a disposable fixture only. No real-device adapter, external targets, arbitrary commands, or host files.</p>
    {!configured && <p>Execution unavailable until storage, reviewed images, and the dedicated worker are configured and accepted. Configuration alone is not runtime verification.</p>}
    <button type="button" disabled={!configured || busy} onClick={() => void action(async () => {
      const request = { targetId: "training-http-fixture-v1", exerciseId: "http-headers-v1", projectId, conversationId, contextRevision: revision };
      const proposed = await api("/api/cyber/runs", "POST", request, crypto.randomUUID());
      const next = await api("/api/cyber/runs/" + proposed.id);
      if (alive.current) setReview(next);
    })}>Prepare fixture proposal (does not run)</button>
    {review && <section aria-label="Exact Cyber run approval">
      <p>Review the exact exercise, images, limits and investigation revision. Approval expires at {new Date(review.expiresAt).toLocaleString()}.</p>
      <pre style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify({ request: review.request, policy: review.policy, hash: review.hash }, null, 2)}</pre>
      <button type="button" disabled={busy || review.state !== "waiting_approval"} onClick={() => void action(async () => {
        await api("/api/cyber/runs/" + review.id, "POST", { hash: review.hash }); if (alive.current) setReview(null);
      })}>Approve this exact fixture run</button>
      <button type="button" disabled={busy} onClick={() => void action(async () => { await api("/api/cyber/runs/" + review.id, "DELETE"); if (alive.current) setReview(null); })}>Reject / cancel</button>
    </section>}
    {runs.map(run => <article key={run.id} style={{ borderTop: "1px solid #526174", padding: 8 }}>
      <p>{run.state} · {run.id}</p>
      {run.state === "waiting_approval" && <button type="button" disabled={busy} onClick={() => void action(async () => { const next = await api("/api/cyber/runs/" + run.id); if (alive.current) setReview(next); })}>Review</button>}
      {["queued", "running", "waiting_approval"].includes(run.state) && <button type="button" disabled={busy} onClick={() => void action(async () => { await api("/api/cyber/runs/" + run.id, "DELETE"); })}>Cancel</button>}
      {run.error_code && <p>{run.error_code}</p>}
      {run.result && <pre style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(run.result.cyber, null, 2)}</pre>}
    </article>)}
    {error && <p role="alert">{error}</p>}
  </details>;
}
