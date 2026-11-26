import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { OwnerGrant } from "./owner-grant";

export const OWNER_COOKIE = "sv_owner_grant";
export class OwnerAccessError extends Error {
  constructor(message: string, public readonly status = 403) { super(message); this.name = "OwnerAccessError"; }
}
export function ownerDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new OwnerAccessError("Owner access storage is not configured.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function cyberEnabled(): boolean { return process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED === "1"; }
export function ownerCookieToken(req: Request): string | null {
  const entry = (req.headers.get("cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith(OWNER_COOKIE + "="));
  const token = entry?.slice(OWNER_COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function mapGrant(row: Record<string, unknown> | null): OwnerGrant | null {
  if (!row || typeof row.id !== "string") return null;
  return { id: row.id, userId: String(row.user_id), lastActivityAt: String(row.last_activity_at), idleLocksAt: String(row.idle_locks_at), revision: Number(row.revision) };
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await ownerDatabase().rpc(name, args);
  if (error) throw new OwnerAccessError("Owner access storage is unavailable. Access remains locked.", 503);
  return data;
}
/** Read-only checks never renew activity. Database time decides idle expiry. */
export async function resolveOwnerGrant(req: Request, userId: string): Promise<OwnerGrant | null> {
  const token = ownerCookieToken(req);
  if (!token) return null;
  return mapGrant(await rpc("sv_owner_resolve", { p_user: userId, p_hash: tokenHash(token), p_touch: false }));
}
export async function recordOwnerActivity(req: Request, userId: string): Promise<OwnerGrant | null> {
  const token = ownerCookieToken(req);
  if (!token) return null;
  return mapGrant(await rpc("sv_owner_resolve", { p_user: userId, p_hash: tokenHash(token), p_touch: true }));
}
export async function assertOwnerGrantCurrent(grant: OwnerGrant): Promise<void> {
  const current = mapGrant(await rpc("sv_owner_resolve", { p_user: grant.userId, p_hash: null, p_touch: false, p_id: grant.id, p_revision: grant.revision }));
  if (!current) throw new OwnerAccessError("Cyber Lab is locked. Use sv unlock again.");
}
export async function revokeOwnerGrants(userId: string): Promise<void> {
  await rpc("sv_owner_lock", { p_user: userId });
}
function verifyPassword(password: string): boolean {
  const configured = process.env.SV_OWNER_PASSWORD_HASH;
  if (configured) {
    const [format, salt, hash] = configured.split("$");
    if (format !== "scrypt" || !/^[a-f0-9]{32,128}$/i.test(salt || "") || !/^[a-f0-9]{128}$/i.test(hash || "")) {
      throw new OwnerAccessError("Owner password hash configuration is invalid.", 503);
    }
    return timingSafeEqual(scryptSync(password, Buffer.from(salt, "hex"), 64), Buffer.from(hash, "hex"));
  }
  const legacy = process.env.SV_OWNER_PASSWORD;
  if (!legacy) throw new OwnerAccessError("Owner password is not configured.", 503);
  // Temporary environment compatibility; neither candidate nor configured secret is logged.
  return timingSafeEqual(createHash("sha256").update(password).digest(), createHash("sha256").update(legacy).digest());
}
export async function unlockOwner(req: Request, userId: string, password: string): Promise<{ token: string; grant: OwnerGrant }> {
  if (!password || Buffer.byteLength(password, "utf8") > 1024) throw new OwnerAccessError("Invalid password length.", 400);
  const reservation = await rpc("sv_owner_reserve_attempt", { p_user: userId });
  if (!reservation?.allowed) throw new OwnerAccessError("Too many owner unlock attempts. Try again after 15 minutes.", 429);
  if (!verifyPassword(password)) throw new OwnerAccessError("Incorrect owner password.");
  const token = randomBytes(32).toString("hex"), old = ownerCookieToken(req);
  const grant = mapGrant(await rpc("sv_owner_issue", { p_user: userId, p_hash: tokenHash(token), p_epoch: reservation.epoch, p_old_hash: old ? tokenHash(old) : null }));
  if (!grant) throw new OwnerAccessError("Unlock was cancelled by a lock action. Try again.");
  return { token, grant };
}
function isSerializedHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    // Browser Origin values have no credentials, path, query, fragment or trailing slash.
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch { return false; }
}
export function requireSameOrigin(req: Request): void {
  const configured = process.env.SVANSAI_APP_ORIGINS?.trim();
  // A reverse proxy can leave req.url pointing at an internal hostname/port.
  // Only server configuration may add public origins, never Host/Forwarded headers.
  const allowed = configured ? configured.split(",").map(value => value.trim()) : [new URL(req.url).origin];
  if (!allowed.every(isSerializedHttpOrigin)) {
    throw new OwnerAccessError("Application origin configuration is invalid.", 503);
  }
  const origin = req.headers.get("origin");
  if (!origin || !isSerializedHttpOrigin(origin) || !allowed.includes(origin)) {
    throw new OwnerAccessError("Owner controls require a same-origin request.");
  }
}
/** Cancel promptly across processes, then recheck again at dispatch/publication boundaries. */
export function watchOwnerGrant(grant: OwnerGrant, parent?: AbortSignal, validate?: () => Promise<void>) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  let checking = false;
  const interval = setInterval(async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try { await (validate ? validate() : assertOwnerGrantCurrent(grant)); } catch { abort(); } finally { checking = false; }
  }, 5000);
  return { signal: controller.signal, dispose: () => { clearInterval(interval); parent?.removeEventListener("abort", abort); } };
}
