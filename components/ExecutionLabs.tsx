"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LAB_LIMITS, parseLabRequest, type LabProfile, type SnapshotFile } from "@/lib/execution/contracts";
import type { LabJob } from "@/lib/execution/store";
import TaskProgress from "./TaskProgress";
import { SelectiveIndex } from "@/lib/agents/coding/indexer";
import { desktopRepositoryReader } from "@/lib/agents/coding/desktop-reader";

const initialFiles = JSON.stringify([{ path: "main.py", content: "# Selected files run in an offline temporary snapshot.\nprint('Ready for a reviewed lab run')\n" }], null, 2);
const active = (job: LabJob) => ["queued", "running"].includes(job.state);

/** Optional panel; opening or proposing a snapshot never runs its code. */
export default function ExecutionLabs({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false), [enabled, setEnabled] = useState(false);
  const [jobs, setJobs] = useState<LabJob[]>([]), [review, setReview] = useState<LabJob | null>(null);
  const [profile, setProfile] = useState<LabProfile>("python"), [mode, setMode] = useState<"script" | "tests">("script");
  const [purpose, setPurpose] = useState(""), [entrypoint, setEntrypoint] = useState("main.py"), [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(0), [account, setAccount] = useState(userId);
  const [selectedPaths, setSelectedPaths] = useState(""), [collectionNote, setCollectionNote] = useState("");
  const [desktop, setDesktop] = useState(false), [followImports, setFollowImports] = useState(false);
  const epoch = useRef(0), identity = useRef(userId), working = useRef(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  if (identity.current !== userId) { identity.current = userId; epoch.current++; }
  useEffect(() => {
    setDesktop(Boolean(window.svansDesktop));
    setAccount(userId); setOpen(false); setEnabled(false); setJobs([]); setReview(null); setError("");
    setConfirmed(false); setBusy(false); setPurpose(""); setFiles(initialFiles); setProfile("python"); setEntrypoint("main.py"); setMode("script");
    working.current = false; submission.current = null; setCollectionNote(""); setSelectedPaths(""); setFollowImports(false);
    return () => { epoch.current++; };
  }, [userId]);
  async function auth(current: number) {
    const { data } = await supabase.auth.getSession();
    if (current !== epoch.current || !data.session || data.session.user.id !== identity.current) throw new Error("Sign in again to access your lab requests.");
    return { Authorization: `Bearer ${data.session.access_token}` };
  }
  useEffect(() => {
    if (!open || !userId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const current = epoch.current;
    async function poll() {
      try {
        const response = await fetch("/api/labs", { headers: await auth(current), cache: "no-store" });
        const data = await response.json();
        if (stopped || current !== epoch.current) return;
        if (!response.ok) throw new Error(data.error || "Lab requests unavailable.");
        setEnabled(data.enabled === true); setJobs(data.jobs ?? []);
        if ((data.jobs ?? []).some(active)) timer = setTimeout(poll, 5000);
      } catch (cause) { if (!stopped && current === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load labs."); }
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [open, userId, revision]);
  async function action(task: (current: number) => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    const current = epoch.current;
    try { await task(current); }
    catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : "Lab operation failed."); }
    finally { if (current === epoch.current) { working.current = false; setBusy(false); } }
  }
  async function loadReview(id: string, current: number) {
    const response = await fetch(`/api/labs/${id}`, { headers: await auth(current), cache: "no-store" });
    const data = await response.json();
    if (current !== epoch.current) return;
    if (!response.ok) throw new Error(data.error || "Snapshot unavailable.");
    setReview(data); setConfirmed(false);
  }
  async function propose(current: number) {
    const payload = parseLabRequest({ profile, mode, purpose, entrypoint, files: JSON.parse(files) });
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > LAB_LIMITS.requestBytes) throw new Error("Encoded snapshot is too large.");
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    const response = await fetch("/api/labs", { method: "POST", headers: { ...await auth(current), "Content-Type": "application/json", "Idempotency-Key": submission.current.key }, body });
    const data = await response.json();
    if (current !== epoch.current) return;
    if (!response.ok) throw new Error(data.error || "Snapshot was not saved.");
    submission.current = null; setRevision((value) => value + 1);
    await loadReview(data.id, current);
  }
  async function decide(current: number, decision: "approve" | "reject") {
    if (!review || (decision === "approve" && !confirmed)) return;
    const response = await fetch(`/api/labs/${review.id}`, { method: "POST",
      headers: { ...await auth(current), "Content-Type": "application/json" },
      body: JSON.stringify({ decision, expectedHash: review.payload_hash }) });
    const data = await response.json();
    if (current !== epoch.current) return;
    if (!response.ok) throw new Error(data.error || "Approval was not accepted.");
    setReview(null); setConfirmed(false); setRevision((value) => value + 1);
  }
  async function cancel(current: number, id: string) {
    const response = await fetch(`/api/labs/${id}`, { method: "DELETE", headers: await auth(current) });
    if (current !== epoch.current) return;
    if (!response.ok) throw new Error("Cancellation could not be saved.");
    setReview(null); setRevision((value) => value + 1);
  }
  async function importFiles(current: number, selected: File[]) {
    if (!selected.length || selected.length > LAB_LIMITS.files || selected.some((file) => file.size > LAB_LIMITS.fileBytes)) throw new Error("Choose up to 50 text files, at most 32 KiB each.");
    if (selected.reduce((sum, file) => sum + file.size, 0) > LAB_LIMITS.totalBytes) throw new Error("Selected files exceed 128 KiB total.");
    const imported: SnapshotFile[] = [];
    for (const file of selected) {
      // Read only explicit selections, never enumerate the user's disk.
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      imported.push({ path: file.name, content });
    }
    if (current !== epoch.current) return;
    setFiles(JSON.stringify(imported, null, 2));
    const entry = imported.find((file) => profile === "python" ? file.path.endsWith(".py") : /\.(js|mjs|cjs)$/.test(file.path));
    if (entry) setEntrypoint(entry.path);
  }
  async function collectWorkspace(current: number) {
    const paths = selectedPaths.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
    if (!paths.length || paths.length > 10) throw new Error("Enter 1–10 exact relative paths from the failure or project manifest.");
    const index = new SelectiveIndex(await desktopRepositoryReader());
    await index.expand(paths, "owner-selected-entrypoints", { pin: true });
    if (followImports) for (const path of paths) {
      if (index.snapshot().entries.some((entry) => entry.path === path)) await index.expandDependencies(path, `direct-imports:${path}`);
    }
    const collected = index.snapshot();
    if (current !== epoch.current) return;
    setFiles(JSON.stringify(collected.entries.map(({ path, content }) => ({ path, content })), null, 2));
    setCollectionNote(`Read ${collected.entries.length} selected files (${collected.bytes} bytes), ${collected.missing.length} missing candidates, ${collected.skipped.length} excluded. No full repository scan and no upload yet.` +
      collected.skipped.slice(0, 6).map((item) => `\n${item.path}: ${item.reason}`).join(""));
  }
  if (!userId || account !== userId) return null;
  return <section style={{ border: "1px solid rgba(125,211,252,.2)", borderRadius: 12, padding: 10, margin: "8px 0" }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Data &amp; Code Labs {open ? "−" : "+"}</button>
    {open && <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
      <p>Reviewed code runs on selected file copies only. No network, installs, host writes, commits or deployments. Runs require a configured separate worker.</p>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>Refresh labs</button>
      {!enabled && <p>Labs are disabled until the isolated worker, pinned images and approval storage are configured and verified.</p>}
      {enabled && <>
        <label>Runtime <select value={profile} onChange={(event) => setProfile(event.target.value as LabProfile)}><option value="python">Python Data Lab (standard library)</option><option value="node">JavaScript Code Lab (Node built-ins)</option></select></label>
        <label>Mode <select value={mode} onChange={(event) => setMode(event.target.value as "script" | "tests")}><option value="script">Script</option><option value="tests">Focused tests</option></select></label>
        <label>Purpose <input value={purpose} maxLength={1000} onChange={(event) => setPurpose(event.target.value)} /></label>
        <label>Entrypoint <input value={entrypoint} maxLength={180} onChange={(event) => setEntrypoint(event.target.value)} /></label>
        <label>Import selected text files <input type="file" multiple disabled={busy} onChange={(event) => { const selected = Array.from(event.target.files ?? []); void action((current) => importFiles(current, selected)); event.target.value = ""; }} /></label>
        {desktop && <details><summary>Collect selected files from the permitted desktop folder</summary>
          <p>Enter exact relative paths, one per line. This does not scan the full repository or send files to a server.</p>
          <textarea aria-label="Exact workspace file paths" rows={3} value={selectedPaths} onChange={(event) => setSelectedPaths(event.target.value)} maxLength={2000} />
          <label><input type="checkbox" checked={followImports} onChange={(event) => setFollowImports(event.target.checked)} /> Also read one hop of direct relative JavaScript/TypeScript imports (bounded).</label>
          <button type="button" disabled={busy || !selectedPaths.trim()} onClick={() => void action(collectWorkspace)}>Read selected files locally</button>
          {collectionNote && <p style={{ whiteSpace: "pre-wrap" }}>{collectionNote}</p>}
        </details>}
        <p>50 files maximum; 32 KiB per file, 128 KiB combined. Edit relative names below if your code imports files from subfolders. Remove credentials and private data before submitting.</p>
        <textarea aria-label="Selected snapshot files as JSON" rows={8} value={files} onChange={(event) => setFiles(event.target.value)} maxLength={LAB_LIMITS.requestBytes} style={{ width: "100%", fontFamily: "monospace" }} spellCheck={false} />
        <p>Preparing a snapshot uploads the displayed code/files to your private account for review. It does not run code. Local folder access alone does not authorize this upload.</p>
        <button type="button" disabled={busy || !purpose.trim()} onClick={() => void action(propose)}>Save snapshot to my account for review — does not run code</button>
      </>}
      {error && <p role="alert">{error}</p>}
      {review && <article style={{ border: "1px solid #90cdf4", padding: 12, borderRadius: 8 }}>
        <h3>Review this exact run</h3>
        <p>{review.payload.request.purpose}</p>
        <p>{review.payload.request.profile} · {review.payload.request.mode} · {review.payload.request.entrypoint}</p>
        <p>Offline · 60 seconds · 512 MiB RAM · 1 CPU · 64 processes · 64 KiB output. Approval expires {new Date(review.approval_expires_at).toLocaleString()}.</p>
        <p style={{ overflowWrap: "anywhere" }}>Runtime image: {review.payload.policy.image}<br />Snapshot SHA-256: {review.payload_hash}</p>
        {review.payload.request.files.map((file) => <details key={file.path}><summary>{file.path}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 250, overflow: "auto" }}>{file.content}</pre></details>)}
        {review.state === "waiting_approval" && <>
          <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed these files and authorize this one isolated run.</label>
          <button type="button" disabled={busy || !confirmed || !enabled} onClick={() => void action((current) => decide(current, "approve"))}>Approve this snapshot and run</button>
          <button type="button" disabled={busy} onClick={() => void action((current) => decide(current, "reject"))}>Reject</button>
        </>}
        <button type="button" onClick={() => setReview(null)}>Close review</button>
      </article>}
      {jobs.map((job) => <article key={job.id} style={{ borderTop: "1px solid rgba(125,211,252,.2)", paddingTop: 8 }}>
        <p>{job.state} · {new Date(job.created_at).toLocaleString()}</p>
        <button type="button" disabled={busy} onClick={() => void action((current) => loadReview(job.id, current))}>View snapshot</button>
        {["waiting_approval", "queued", "running"].includes(job.state) && <button type="button" disabled={busy || job.cancel_requested} onClick={() => void action((current) => cancel(current, job.id))}>{job.cancel_requested ? "Cancellation requested" : "Cancel run"}</button>}
        <TaskProgress jobId={job.id} userId={userId} active={active(job)} />
        {job.result && <><p>{job.result.text}</p><details><summary>Execution output (untrusted text)</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 300, overflow: "auto" }}>{job.result.lab.stdout}{"\n"}{job.result.lab.stderr}</pre></details></>}
        {job.error_code && <p>{job.error_code}{job.state === "indeterminate" ? " — do not replay automatically; an operator must reconcile the run and cleanup." : ""}</p>}
      </article>)}
    </div>}
  </section>;
}
