import { runtimeDatabase, jobsEnabled, isUuid } from "@/lib/jobs/store";
import type { JobRecord, JobResult } from "@/lib/jobs/types";
import type { LabEnvelope, LabReport } from "./contracts";
import { prepareLab, labHash, pinnedImage } from "./client";

export type LabJob = Omit<JobRecord, "payload" | "result"> & {
  kind: "lab"; payload: LabEnvelope; approval_expires_at: string; approved_at: string | null;
  result: (JobResult & { lab: LabReport }) | null;
};
export function labsEnabled(): boolean {
  if (!jobsEnabled() || process.env.SVANSAI_LABS_ENABLED !== "1") return false;
  try { pinnedImage("node"); pinnedImage("python"); return true; } catch { return false; }
}
export async function proposeLab(userId: string, value: unknown, key: string): Promise<LabJob> {
  if (!labsEnabled()) throw new Error("Isolated labs are not configured.");
  if (!isUuid(userId) || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new Error("Invalid request identity.");
  const payload = prepareLab(value);
  if (Buffer.byteLength(JSON.stringify(payload)) > 196608) throw new Error("Encoded snapshot exceeds its byte limit.");
  const { data, error } = await runtimeDatabase().rpc("svans_enqueue_lab", { p_user: userId, p_payload: payload, p_hash: labHash(payload), p_key: key });
  if (error) throw new Error("Lab request was not saved. Check active-job limits, setup, and the request key.");
  return (Array.isArray(data) ? data[0] : data) as LabJob;
}
export async function listLabJobs(userId: string): Promise<LabJob[]> {
  const { data, error } = await runtimeDatabase().from("svans_jobs")
    .select("id,kind,state,payload_hash,approval_expires_at,approved_at,result,attempts,max_attempts,cancel_requested,error_code,created_at,updated_at")
    .eq("user_id", userId).eq("kind", "lab").order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Lab job storage is unavailable.");
  return (data ?? []) as LabJob[];
}
export async function getLabJob(userId: string, id: string): Promise<LabJob | null> {
  if (!isUuid(userId) || !isUuid(id)) return null;
  const { data, error } = await runtimeDatabase().from("svans_jobs")
    .select("id,kind,state,payload,payload_hash,approval_expires_at,approved_at,result,attempts,max_attempts,cancel_requested,error_code,created_at,updated_at")
    .eq("user_id", userId).eq("id", id).eq("kind", "lab").maybeSingle();
  if (error) throw new Error("Lab job storage is unavailable.");
  return data as LabJob | null;
}
export async function decideLab(userId: string, id: string, expectedHash: string, decision: "approve" | "reject"): Promise<void> {
  if (!labsEnabled() || !isUuid(userId) || !isUuid(id) || !/^[a-f0-9]{64}$/.test(expectedHash) || !["approve", "reject"].includes(decision)) throw new Error("Invalid approval.");
  const { error } = await runtimeDatabase().rpc("svans_decide_lab", { p_user: userId, p_id: id, p_hash: expectedHash, p_approve: decision === "approve" });
  if (error) throw new Error("Approval was not accepted. It may be expired, already decided, changed, or over the daily run limit.");
}
export async function claimLab(worker: string): Promise<LabJob | null> {
  const { data, error } = await runtimeDatabase().rpc("svans_claim_lab", { p_worker: worker });
  if (error) throw new Error("Lab queue is unavailable.");
  return (Array.isArray(data) ? data[0] : data) || null;
}
export async function finishLab(job: LabJob, result: LabJob["result"], errorCode: string | null, unknownOutcome = false): Promise<void> {
  const { error } = await runtimeDatabase().rpc("svans_finish_lab", {
    p_id: job.id, p_lease: job.lease_token, p_result: result, p_error: errorCode, p_unknown: unknownOutcome });
  if (error) throw new Error("Lab completion could not be saved; do not replay the run.");
}
