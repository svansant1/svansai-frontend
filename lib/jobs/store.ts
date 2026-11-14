import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { type JobPayload, type JobRecord, type JobResult } from "./types";
import type { ExecutionEvent } from "@/lib/platform/capabilities/contracts";
import type { StoredGenerationPayload } from "./cyber-context";
import { hashJobPayload } from "./payload-hash";

export function runtimeDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Runtime storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function jobsEnabled(): boolean { return process.env.SVANSAI_JOBS_ENABLED === "1"; }
export function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export async function enqueueJob(userId: string, payload: StoredGenerationPayload, idempotencyKey: string): Promise<JobRecord> {
  if (!jobsEnabled()) throw new Error("Background jobs are disabled until storage and a worker are configured.");
  if (!isUuid(userId) || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw new Error("Invalid job identity.");
  const payloadHash = payload._cyber ? hashJobPayload(payload) : createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const { data, error } = await runtimeDatabase().rpc(payload._cyber ? "svans_enqueue_cyber_generation" : "svans_enqueue_job", { p_user: userId, p_payload: payload, p_hash: payloadHash, p_key: idempotencyKey });
  if (error) throw new Error("Job could not be queued. Check runtime setup, active-job limits, and the idempotency key.");
  return (Array.isArray(data) ? data[0] : data) as JobRecord;
}
export async function listJobs(userId: string): Promise<JobRecord[]> {
  const { data, error } = await runtimeDatabase().from("svans_jobs").select("id,kind,state,attempts,max_attempts,cancel_requested,result,error_code,created_at,updated_at").eq("user_id", userId).eq("kind", "generation").order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Background job storage is unavailable.");
  return (data ?? []) as JobRecord[];
}
export async function getJob(userId: string, id: string): Promise<JobRecord | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await runtimeDatabase().from("svans_jobs").select("id,state,attempts,max_attempts,cancel_requested,result,error_code,created_at,updated_at").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error("Background job storage is unavailable.");
  return data as JobRecord | null;
}
export async function cancelJob(userId: string, id: string): Promise<void> {
  if (!isUuid(id)) throw new Error("Invalid job ID.");
  const { error } = await runtimeDatabase().rpc("svans_cancel_job", { p_user: userId, p_id: id });
  if (error) throw new Error("Could not cancel the job.");
}
export async function claimJob(worker: string): Promise<JobRecord | null> {
  const { data, error } = await runtimeDatabase().rpc("svans_claim_job", { p_worker: worker });
  if (error) throw new Error("Could not claim a background job.");
  return (Array.isArray(data) ? data[0] : data) || null;
}
export async function heartbeatJob(job: JobRecord): Promise<boolean> {
  const { data, error } = await runtimeDatabase().rpc("svans_heartbeat_job", { p_id: job.id, p_lease: job.lease_token });
  if (error) throw new Error("Job lease could not be renewed.");
  return data === true;
}
export async function finishJob(job: JobRecord, result: JobResult | null, errorCode: string | null): Promise<void> {
  const privileged = Boolean((job.payload as StoredGenerationPayload)._cyber);
  const { error } = await runtimeDatabase().rpc(privileged ? "svans_finish_cyber_generation" : "svans_finish_job", { p_id: job.id, p_lease: job.lease_token, p_result: result, p_error: errorCode });
  if (error) throw new Error("Job completion could not be persisted.");
}
export async function appendJobEvent(job: JobRecord, event: ExecutionEvent): Promise<void> {
  const detail = JSON.stringify({ ...event, attempt: job.attempts });
  if (Buffer.byteLength(detail, "utf8") > 8192) throw new Error("Job event exceeded its journal limit.");
  const { error } = await runtimeDatabase().rpc("svans_append_job_event", { p_id: job.id, p_lease: job.lease_token, p_state: event.state, p_detail: detail });
  if (error) throw new Error("Job event could not be recorded under its active lease.");
}
export async function listJobEvents(userId: string, id: string, after = "0") {
  if (!isUuid(userId) || !isUuid(id) || !/^\d{1,15}$/.test(after)) throw new Error("Invalid event cursor.");
  if (!await getJob(userId, id)) throw new Error("Job not found.");
  const { data, error } = await runtimeDatabase().from("svans_job_events").select("id,state,detail,created_at")
    .eq("job_id", id).gt("id", after).order("id", { ascending: true }).limit(101);
  if (error) throw new Error("Job events unavailable.");
  const events = (data ?? []).slice(0, 100);
  return { events, nextCursor: events.length ? String(events[events.length - 1].id) : after, hasMore: (data?.length ?? 0) > 100 };
}
