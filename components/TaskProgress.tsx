"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
type Event = { id: number; state: string; detail: string; created_at: string };
function describe(detail: string) {
  try {
    const value = JSON.parse(detail);
    if (typeof value.detail === "string") return (typeof value.attempt === "number" ? "Attempt " + value.attempt + ": " : "") + value.detail;
  } catch { /* Queue/lease lifecycle events can be plain text. */ }
  return detail;
}
/** Displays persisted facts. It does not invent progress percentages or reveal model reasoning. */
export default function TaskProgress({ jobId, userId, active }: { jobId: string; userId: string; active: boolean }) {
  const [open, setOpen] = useState(false), [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState(""), [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!open) return;
    let stopped = false, cursor = "0", fetched = 0;
    let timer: ReturnType<typeof setTimeout>;
    setEvents([]); setError(""); setHasMore(false);
    async function fetchPage() {
      try {
        const { data } = await supabase.auth.getSession();
        if (stopped) return;
        if (!data.session || data.session.user.id !== userId) throw new Error("Sign in again to view task events.");
        const response = await fetch("/api/jobs/" + jobId + "/events?after=" + cursor, { headers: { Authorization: "Bearer " + data.session.access_token }, cache: "no-store" });
        const result = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(result.error || "Task events are unavailable.");
        cursor = result.nextCursor; fetched += result.events.length;
        setEvents((previous) => [...previous, ...result.events]);
        setHasMore(result.hasMore);
        if (result.hasMore && fetched < (page + 1) * 100) timer = setTimeout(() => void fetchPage(), 100);
        else if (!result.hasMore && active && fetched < 1000) timer = setTimeout(() => void fetchPage(), 10_000);
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "Event loading failed."); }
    }
    void fetchPage();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, jobId, userId, active, page]);
  return <div>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} task events</button>
    {open && <>
      <ol>{events.map((event) => <li key={event.id}><small>{new Date(event.created_at).toLocaleTimeString()} · {event.state}</small><div>{describe(event.detail)}</div></li>)}</ol>
      {hasMore && <button type="button" onClick={() => setPage((value) => value + 1)}>Load more events</button>}
      {events.length >= 1000 && <p>Automatic event loading paused at 1,000 entries. All events remain in the saved journal.</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setPage((value) => value + 1)}>Retry</button></p>}
    </>}
  </div>;
}
