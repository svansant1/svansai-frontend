"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { OwnerStatus } from "@/lib/auth/owner-grant";
import { OwnerStatusGate, OwnerStatusSuperseded } from "@/lib/auth/owner-status-order";
const locked: OwnerStatus = { owner: false, unlocked: false, featureEnabled: false, idleLocksAt: null, serverTime: "" };
export function useOwnerAccess(userId?: string) {
  const [status, setStatus] = useState<OwnerStatus>(locked);
  const [error, setError] = useState("");
  const statusRef = useRef(status), gate = useRef(new OwnerStatusGate()), lastActivity = useRef(0), channel = useRef<BroadcastChannel | null>(null);
  const identity = useRef(userId), lockUnconfirmed = useRef(false);
  if (identity.current !== userId) { identity.current = userId; gate.current.reset(); }
  statusRef.current = status;
  const locallyLock = useCallback(() => {
    gate.current.invalidate();
    const next = { ...statusRef.current, unlocked: false, idleLocksAt: null };
    statusRef.current = next; setStatus(next);
  }, []);
  const request = useCallback(async (body?: Record<string, unknown>): Promise<OwnerStatus> => {
    if ((!body || body.action === "activity") && !gate.current.canRead()) throw new OwnerStatusSuperseded();
    const ticket = gate.current.begin(Boolean(body));
    try {
      const { data } = await supabase.auth.getSession();
      if (!gate.current.current(ticket) || identity.current !== userId) throw new OwnerStatusSuperseded();
      const token = data.session?.access_token;
      if (!token || !userId || data.session?.user.id !== userId) throw new Error("Sign in as the verified owner.");
      const response = await fetch("/api/system/owner-access", { method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000),
        headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      if (!gate.current.current(ticket) || identity.current !== userId) throw new OwnerStatusSuperseded();
      if (!response.ok) throw new Error(value.error || "Owner controls are unavailable.");
      if (typeof value.owner !== "boolean" || typeof value.unlocked !== "boolean" || typeof value.featureEnabled !== "boolean" ||
        !Number.isFinite(Date.parse(value.serverTime)) || (value.unlocked && (!value.owner || !Number.isFinite(Date.parse(value.idleLocksAt))))) throw new Error("Invalid owner status response.");
      if (!gate.current.accept(ticket)) throw new OwnerStatusSuperseded();
      if (!value.unlocked || body?.action === "unlock") lockUnconfirmed.current = false;
      const suppressed = lockUnconfirmed.current && value.unlocked;
      const next: OwnerStatus = suppressed ? { ...value, unlocked: false, idleLocksAt: null } : value;
      statusRef.current = next; setStatus(next);
      if (!suppressed) setError("");
      return next;
    } catch (e) {
      if (!gate.current.current(ticket) || identity.current !== userId) throw new OwnerStatusSuperseded();
      if (!(e instanceof OwnerStatusSuperseded) && gate.current.current(ticket)) locallyLock();
      throw e;
    } finally { gate.current.finish(ticket); }
  }, [userId, locallyLock]);
  const refresh = useCallback(() => {
    if (!gate.current.canRead()) return;
    void request().catch(e => { if (!(e instanceof OwnerStatusSuperseded)) setError(e.message); });
  }, [request]);
  const lock = useCallback(async () => {
    lockUnconfirmed.current = true; locallyLock();
    channel.current?.postMessage({ type: "locked" });
    try { await request({ action: "lock" }); } catch (e) {
      if (!(e instanceof OwnerStatusSuperseded)) setError("Server lock could not be confirmed. Controls remain locally locked; retry Lock.");
      throw e;
    }
  }, [locallyLock, request]);
  useEffect(() => {
    gate.current.reset(); lockUnconfirmed.current = false; lastActivity.current = 0; statusRef.current = locked; setStatus(locked); setError("");
    if (!userId) return;
    refresh();
    const broadcast = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sv-owner-controls:" + userId) : null;
    channel.current = broadcast;
    if (broadcast) broadcast.onmessage = e => { if (e.data?.type === "locked") { lockUnconfirmed.current = true; locallyLock(); } else refresh(); };
    const timer = window.setInterval(refresh, 15_000); // status only; never extends the idle deadline
    window.addEventListener("focus", refresh);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { gate.current.reset(); clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); broadcast?.close(); channel.current = null; };
  }, [userId, refresh, locallyLock]);
  useEffect(() => {
    if (!status.unlocked || !status.idleLocksAt) return;
    const delay = Math.max(0, Date.parse(status.idleLocksAt) - Date.parse(status.serverTime));
    const timer = window.setTimeout(() => { locallyLock(); refresh(); }, delay);
    return () => clearTimeout(timer);
  }, [status, locallyLock, refresh]);
  useEffect(() => {
    const activity = (event: Event) => {
      if (!event.isTrusted || !statusRef.current.unlocked || !gate.current.canRead() || document.visibilityState !== "visible" || !document.hasFocus() || Date.now() - lastActivity.current < 30_000) return;
      lastActivity.current = Date.now();
      void request({ action: "activity" }).then(() => channel.current?.postMessage({ type: "activity" })).catch(e => { if (!(e instanceof OwnerStatusSuperseded)) setError(e.message); });
    };
    for (const event of ["keydown", "pointerdown", "scroll", "touchstart"]) window.addEventListener(event, activity, { passive: true, capture: true });
    return () => { for (const event of ["keydown", "pointerdown", "scroll", "touchstart"]) window.removeEventListener(event, activity, true); };
  }, [request]);
  return { status, error, request, refresh, lock, locallyLock };
}
export type OwnerControls = ReturnType<typeof useOwnerAccess>;
