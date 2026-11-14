"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { JobRecord, StoredArtifactReference } from "@/lib/jobs/types";
import TaskProgress from "./TaskProgress";

/** Compact opt-in panel: opening it does not create work or submit the current chat. */
export default function BackgroundTasks({ userId, cyberContext }: { userId?: string; cyberContext?: { projectId: string; conversationId: string } }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(userId);
  const [pollRevision, setPollRevision] = useState(0);
  const submission = useRef<{ prompt: string; key: string } | null>(null);
  const generation = useRef(0);
  const identity = useRef(userId);
  if (identity.current !== userId) { identity.current = userId; generation.current += 1; }
  useEffect(() => { setAccount(userId); setOpen(false); setJobs([]); setPrompt(""); setError(""); setEnabled(false); setBusy(false); submission.current = null; }, [userId]);
  async function authorization(current: number) {
    const { data } = await supabase.auth.getSession();
    if (current !== generation.current || !data.session || data.session.user.id !== identity.current) throw new Error("Sign in again to access your tasks.");
    return { Authorization: `Bearer ${data.session.access_token}` };
  }
  async function refresh() {
    const current = generation.current;
    const response = await fetch("/api/jobs", { headers: await authorization(current), cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load background tasks.");
    if (current !== generation.current) return false;
    setEnabled(data.enabled === true); setJobs(data.jobs ?? []);
    return data.enabled === true && (data.jobs ?? []).some((job: JobRecord) => ["queued", "running"].includes(job.state));
  }
  useEffect(() => {
    if (!open || !userId) return;
    let stopped = false;
    const current = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let active = false;
      try { active = await refresh(); } catch (cause) { if (!stopped && current === generation.current) setError(cause instanceof Error ? cause.message : "Could not load tasks."); }
      if (!stopped && active && current === generation.current) timer = setTimeout(poll, 10_000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, userId, pollRevision]);
  async function queue() {
    if (!prompt.trim() || busy) return;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      if (!submission.current || submission.current.prompt !== prompt) submission.current = { prompt, key: crypto.randomUUID() };
      const key = submission.current.key;
      const response = await fetch("/api/jobs", { method: "POST", headers: { ...await authorization(current), "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }], responseMode: "auto",
        ...(cyberContext ? { cyberMode: true, projectId: cyberContext.projectId, conversationId: cyberContext.conversationId } : {}) }) });
      const data = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(data.error || "Task was not queued.");
      setPrompt(""); submission.current = null; setPollRevision((value) => value + 1);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Task was not queued."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function cancel(id: string) {
    const current = generation.current;
    try {
      const response = await fetch(`/api/jobs/${id}`, { method: "DELETE", headers: await authorization(current) });
      if (current !== generation.current) return;
      if (!response.ok) throw new Error("Cancellation could not be saved.");
      await refresh();
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Cancellation failed."); }
  }
  async function download(artifact: StoredArtifactReference) {
    const current = generation.current;
    try {
      const response = await fetch(`/api/artifacts/${artifact.id}`, { headers: await authorization(current), cache: "no-store" });
      if (!response.ok) throw new Error("The file is unavailable to this account.");
      const blob = await response.blob();
      if (current !== generation.current) return;
      if (blob.size !== artifact.size || blob.size > 8 * 1024 * 1024) throw new Error("The download was incomplete.");
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      if (Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") !== artifact.sha256) throw new Error("The file failed its integrity check.");
      if (current !== generation.current) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = artifact.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Download failed."); }
  }
  if (!userId || account !== userId) return null;
  return <section style={{ margin: "8px 0", border: "1px solid rgba(125,211,252,.2)", borderRadius: 12, padding: 10 }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{cyberContext ? "Cyber reports / background tasks" : "Background tasks"} {open ? "−" : "+"}</button>
    {open && <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
      <button type="button" onClick={() => setPollRevision((value) => value + 1)}>Refresh task list</button>
      {!enabled && <p>Background work is disabled until private storage and a worker are configured. Regular chat remains available.</p>}
      {enabled && <><p>Queue a text or document request. No local commands or external actions are authorized here.</p>
        {cyberContext && <p>This uses the selected investigation revision. Locking, 30 minutes of inactivity, turning Cyber Lab off, or changing evidence stops protected work; jobs do not keep owner access unlocked.</p>}
        <textarea aria-label="Background task request" value={prompt} maxLength={30_000} onChange={(event) => setPrompt(event.target.value)} rows={3} style={{ width: "100%", color: "inherit", background: "rgba(0,0,0,.15)", padding: 10 }} />
        <button type="button" onClick={() => void queue()} disabled={busy || !prompt.trim()}>{busy ? "Queuing…" : "Queue task"}</button></>}
      {error && <p role="alert">{error}</p>}
      {jobs.map((job) => <article key={job.id} style={{ borderTop: "1px solid rgba(125,211,252,.2)", paddingTop: 8 }}>
        <p>{job.state} · {new Date(job.created_at).toLocaleString()} · attempt {job.attempts}/{job.max_attempts}</p>
        <TaskProgress jobId={job.id} userId={userId} active={["queued", "running"].includes(job.state)} />
        {["queued", "running"].includes(job.state) && <button type="button" disabled={job.cancel_requested} onClick={() => void cancel(job.id)}>{job.cancel_requested ? "Cancellation requested" : "Cancel"}</button>}
        {job.result && <><p style={{ whiteSpace: "pre-wrap" }}>{job.result.text}</p>{job.result.artifact && <button type="button" onClick={() => void download(job.result!.artifact!)}>Download {job.result.artifact.name}</button>}</>}
        {job.error_code && <p>{job.error_code}</p>}
      </article>)}
    </div>}
  </section>;
}
