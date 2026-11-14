"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseArtifactReference } from "@/lib/artifacts/references";
import type { StoredArtifactReference } from "@/lib/jobs/types";
import { recipeDifferences } from "@/lib/artifacts/recipe-diff";

/** References contain no bearer token, public URL or file bytes; every operation reauthenticates. */
export default function StoredFileDownload({ reference }: { reference: StoredArtifactReference }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<StoredArtifactReference[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ original: unknown; reference: StoredArtifactReference; text: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        generation.current++; setVersions([]); setNextCursor(null); setNotice(""); setError(""); setBusy(false); setEditor(null);
      }
    });
    return () => { generation.current++; data.subscription.unsubscribe(); };
  }, []);
  async function session() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Sign in to the account that created this file.");
    return data.session;
  }
  async function run(action: (headers: Record<string, string>, current: number) => Promise<void>) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const auth = await session();
      if (current !== generation.current) return;
      await action({ Authorization: "Bearer " + auth.access_token }, current);
    } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "The file operation failed."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function download(value: StoredArtifactReference) {
    await run(async (headers, current) => {
      const ref = parseArtifactReference(value);
      const response = await fetch("/api/artifacts/" + ref.id, { headers, cache: "no-store" });
      if (!response.ok) throw new Error("The file is unavailable or belongs to another account.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== ref.size) throw new Error("The download was incomplete.");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== ref.sha256) throw new Error("The file failed its integrity check.");
      if (current !== generation.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: ref.mimeType }));
      const link = document.createElement("a");
      link.href = url; link.download = ref.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }
  async function history(more = false) {
    await run(async (headers, current) => {
      const ref = parseArtifactReference(reference);
      const url = "/api/artifacts/" + ref.id + "?versions=1" + (more && nextCursor ? "&before=" + encodeURIComponent(nextCursor) : "");
      const response = await fetch(url, { headers, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Version history is unavailable.");
      const entries = (data.versions as unknown[]).map(parseArtifactReference);
      if (current !== generation.current) return;
      setVersions((previous) => more ? [...previous, ...entries] : entries);
      setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
    });
  }
  async function restore(value: StoredArtifactReference) {
    await run(async (headers, current) => {
      const ref = parseArtifactReference(value);
      const response = await fetch("/api/artifacts/" + ref.id, { method: "POST",
        headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The version was not restored.");
      const restored = parseArtifactReference(data.artifactReference);
      if (current !== generation.current) return;
      setVersions((previous) => [restored, ...previous]);
      setNotice("Restored as a new version. Earlier versions are unchanged.");
    });
  }
  async function edit() {
    await run(async (headers, current) => {
      const ref = parseArtifactReference(reference);
      const response = await fetch("/api/artifacts/" + ref.id + "?recipe=1", { headers, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The editable recipe is unavailable.");
      const selected = parseArtifactReference(data.reference);
      if (current !== generation.current) return;
      setEditor({ original: data.recipe, reference: selected, text: JSON.stringify(data.recipe, null, 2) });
    });
  }
  async function saveRevision() {
    if (!editor) return;
    const edit = editor;
    await run(async (headers, current) => {
      const replacements = recipeDifferences(edit.original, JSON.parse(edit.text));
      if (!replacements.length) { setNotice("No content changed."); return; }
      const response = await fetch("/api/artifacts/" + edit.reference.id, { method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedSha256: edit.reference.sha256, replacements }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The revision was not saved.");
      const revised = parseArtifactReference(data.artifactReference);
      if (current !== generation.current) return;
      setVersions((previous) => [revised, ...previous]); setEditor(null);
      setNotice("Saved as a new version below. The original download and prior versions are unchanged.");
    });
  }
  return <div style={{ padding: 12, marginBottom: 10, borderRadius: 12, border: "1px solid rgba(125,211,252,.3)", background: "rgba(56,189,248,.08)" }}>
    <strong>{reference.name}</strong>
    <p style={{ fontSize: ".8rem" }}>Private file · {Math.ceil(reference.size / 1024)} KB · Review before sharing</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" disabled={busy} onClick={() => void download(reference)}>Download</button>
      <button type="button" disabled={busy} onClick={() => void history()}>Version history</button>
      <button type="button" disabled={busy} onClick={() => void edit()}>Edit structured content</button>
      {versions.length > 0 && <button type="button" onClick={() => setVersions([])}>Hide versions</button>}
    </div>
    {versions.length > 0 && <ul>{versions.map((version) => <li key={version.id}>
      {version.name} · {version.sha256.slice(0, 10)}{" "}
      <button type="button" disabled={busy} onClick={() => void download(version)}>Download</button>{" "}
      <button type="button" disabled={busy} onClick={() => void restore(version)}>Restore as new version</button>
    </li>)}</ul>}
    {versions.length > 0 && nextCursor && <button type="button" disabled={busy} onClick={() => void history(true)}>Older versions</button>}
    {editor && <section>
      <p>Advanced editor: change the data fields below. Untouched fields are retained. Saving creates a new file version; it does not edit arbitrary uploaded Word/Excel layouts.</p>
      <textarea aria-label="Structured file content" value={editor.text} maxLength={200_000} rows={12}
        onChange={(event) => setEditor({ ...editor, text: event.target.value })}
        style={{ width: "100%", fontFamily: "monospace", color: "inherit", background: "rgba(0,0,0,.25)" }} />
      <button type="button" disabled={busy} onClick={() => void saveRevision()}>Save as new version</button>{" "}
      <button type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
    </section>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
