"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OwnerControls } from "./useOwnerAccess";
import type { ContextSnapshot, ContextEvent } from "@/lib/context/types";
import type { Project } from "@/lib/projects/types";
import BackgroundTasks from "./BackgroundTasks";
import CyberRuns from "./CyberRuns";

export default function CyberLabPanel({ controls, userId, conversationId, projectId, onProject, active, onActive, showUnlock, onCloseUnlock, refreshKey }: {
  controls: OwnerControls; userId?: string; conversationId?: string | null; projectId: string;
  onProject: (id: string) => void; active: boolean; onActive: (active: boolean) => void;
  showUnlock: boolean; onCloseUnlock: () => void; refreshKey: number;
}) {
  const [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]), [name, setName] = useState("");
  const [snapshot, setSnapshot] = useState<ContextSnapshot | null>(null);
  const [entity, setEntity] = useState<ContextEvent["entity"]>("target"), [field, setField] = useState<ContextEvent["field"]>("identity"), [value, setValue] = useState("");
  const [corrects, setCorrects] = useState("");
  const [hypothesisStatus, setHypothesisStatus] = useState<"unconfirmed" | "supported" | "rejected">("unconfirmed");
  const [confidence, setConfidence] = useState(""), [basis, setBasis] = useState("");
  const api = useCallback(async (url: string, body?: unknown, method?: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token || data.session.user.id !== userId) throw new Error("Sign in first.");
    const response = await fetch(url, { method: method || (body ? "POST" : "GET"), cache: "no-store",
      headers: { Authorization: "Bearer " + data.session.access_token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  }, [userId]);
  const contextUrl = "/api/projects/" + encodeURIComponent(projectId) + "/context?conversationId=" + encodeURIComponent(conversationId || "");
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    if (userId && controls.status.owner) {
      void api("/api/projects").then(result => { if (!cancelled) setProjects(result.projects); }).catch(e => { if (!cancelled) setError(e.message); });
      if (projectId && conversationId) void api(contextUrl).then(result => { if (!cancelled) setSnapshot(result); }).catch(e => { if (!cancelled) setError(e.message); });
    }
    return () => { cancelled = true; };
  }, [userId, controls.status.owner, projectId, conversationId, contextUrl, api, refreshKey]);
  useEffect(() => { if (!showUnlock) setPassword(""); }, [showUnlock]);
  useEffect(() => { setPassword(""); setValue(""); setBasis(""); setConfidence(""); setCorrects(""); setProjects([]); setError(""); }, [userId]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); } finally { setBusy(false); }
  };
  if (!userId || (!controls.status.owner && !showUnlock)) return null;
  return <details open={showUnlock || active} style={{ border: "1px solid #526174", borderRadius: 12, padding: 10, marginBottom: 12, color: "#dceaf5" }}>
    <summary>Cyber Lab — {!controls.status.unlocked ? "LOCKED" : active ? "ON" : "OFF"}</summary>
    <p>Advanced authorized training. Locks after 30 idle minutes; active use has no fixed cutoff. No device control is granted by unlocking.</p>
    <p>Use questions, logs, code, configuration files or optional screenshots. Replies track suggested steps and reported results, explain revisits, and name where to run the next action.</p>
    <button type="button" onClick={() => { onActive(false); void controls.lock().catch(() => {}); }}>Lock now</button>
    {(showUnlock || !controls.status.unlocked) && <form onSubmit={event => {
      event.preventDefault();
      const secret = password; setPassword("");
      void action(async () => { await controls.request({ action: "unlock", password: secret }); onCloseUnlock(); });
    }}>
      <label>Owner password <input aria-label="Owner password" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button disabled={busy || !password} type="submit">Unlock</button>
      <button type="button" onClick={() => { setPassword(""); onCloseUnlock(); }}>Close</button>
    </form>}
    {!controls.status.featureEnabled && <p>Cyber Lab is disabled in server configuration. Source changes alone do not activate it.</p>}
    <label>Investigation project <select value={projectId} onChange={e => { onActive(false); onProject(e.target.value); setCorrects(""); }}>
      <option value="">Select project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <input aria-label="New investigation project" value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="New project name" />
    <button type="button" disabled={busy || !name.trim()} onClick={() => void action(async () => {
      const result = await api("/api/projects", { name }); setProjects(current => [result.project, ...current]); onProject(result.project.id); setName("");
    })}>Create project</button>
    {!conversationId && <p>Send the first ordinary message to create a saved conversation, then enable Cyber Lab here.</p>}
    <button type="button" disabled={busy || !controls.status.unlocked || !controls.status.featureEnabled || !projectId || !conversationId}
      onClick={() => void action(async () => { const status = await controls.request({ action: "mode", enabled: !active, projectId, conversationId }); onActive(status.unlocked && !active); })}>{active ? "Turn OFF" : "Turn ON"}</button>
    {snapshot && <details>
      <summary>Saved evidence · revision {snapshot.revision}</summary>
      <p>user_report means information you supplied; tool_observation means connected-tool output; inference means an assistant suggestion or assessment, not verified execution. Never paste passwords or tokens.</p>
      <select aria-label="Evidence entity" value={entity} onChange={e => { setEntity(e.target.value as ContextEvent["entity"]); setCorrects(""); }}>
        {["target", "scanner", "session"].map(v => <option key={v}>{v}</option>)}
      </select>
      <select aria-label="Evidence field" value={field} onChange={e => { setField(e.target.value as ContextEvent["field"]); setCorrects(""); }}>
        {["identity", "address", "os", "environment", "constraints", "authorization", "finding", "hypothesis", "decision", "attempt", "evidence", "next_action"].map(v => <option key={v}>{v}</option>)}
      </select>
      <select aria-label="Correct an existing fact" value={corrects} onChange={e => setCorrects(e.target.value)}>
        <option value="">Add a new fact</option>{snapshot.events.filter(e => e.entity === entity && e.field === field).map(e => <option key={e.id} value={e.id}>Correct: {e.value.slice(0, 90)}</option>)}
      </select>
      <textarea aria-label="Evidence value" value={value} maxLength={12_000} onChange={e => setValue(e.target.value)} />
      {field === "hypothesis" && <div>
        <select aria-label="Reported hypothesis status" value={hypothesisStatus} onChange={e => setHypothesisStatus(e.target.value as typeof hypothesisStatus)}>
          {["unconfirmed", "supported", "rejected"].map(v => <option key={v}>{v}</option>)}
        </select>
        <input aria-label="Reported confidence from zero to one" type="number" min={0} max={1} step={0.05} value={confidence} onChange={e => setConfidence(e.target.value)} placeholder="Confidence (optional)" />
        <input aria-label="Evidence basis for assessment" value={basis} maxLength={1000} onChange={e => setBasis(e.target.value)} placeholder="Supporting / contradicting evidence" />
        <p>These are your reported assessments, not verified measurements.</p>
      </div>}
      <button type="button" disabled={busy || !value.trim()} onClick={() => void action(async () => {
        setSnapshot(await api(contextUrl, { revision: snapshot.revision, events: [{ id: crypto.randomUUID(), entity, field, value, ...(corrects ? { supersedes: corrects } : {}),
          ...(field === "hypothesis" ? { assessment: { status: hypothesisStatus, confidence: confidence === "" ? null : Number(confidence), basis } } : {}) }] }));
        setValue(""); setCorrects("");
      })}>Save evidence</button>
      <button type="button" onClick={() => void action(async () => { setSnapshot(await api(contextUrl)); })}>Reload evidence</button>
      <button type="button" onClick={() => void action(async () => {
        const exported = await api(contextUrl + "&export=1");
        const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = "investigation-evidence.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Export evidence</button>
      <button type="button" onClick={() => {
        if (window.confirm("Delete this investigation's saved evidence? Generated report versions will remain.")) void action(async () => { await api(contextUrl, undefined, "DELETE"); onActive(false); setSnapshot(await api(contextUrl)); });
      }}>Delete evidence</button>
      <ul style={{ maxHeight: 200, overflow: "auto" }}>{snapshot.events.map(e => <li key={e.id}>{e.entity} / {e.field} [{e.source.kind}]: {e.value.slice(0, 300)}
        {e.assessment && <span> — {e.assessment.status}; reported confidence {e.assessment.confidence ?? "not scored"}; basis: {e.assessment.basis}</span>}</li>)}</ul>
      {snapshot.omittedEvents > 0 && <p>{snapshot.omittedEvents} older events omitted from this bounded view.</p>}
    </details>}
    {active && projectId && conversationId && <BackgroundTasks key={projectId + conversationId} userId={userId} cyberContext={{ projectId, conversationId }} />}
    {active && snapshot && projectId && conversationId && <CyberRuns key={userId + projectId + conversationId} userId={userId} projectId={projectId} conversationId={conversationId} revision={snapshot.revision} />}
    {(error || controls.error) && <p role="alert">{error || controls.error}</p>}
  </details>;
}
