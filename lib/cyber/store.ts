import { runtimeDatabase, isUuid } from "@/lib/jobs/store";
import { bindCyberJob, resolveCyberJobContext } from "@/lib/jobs/cyber-context";
import { assertCyberRequestCurrent, type TrustedRequestContext } from "@/lib/platform/request-context";
import { cyberHash, prepareCyber, validateApprovedCyber } from "./approvals";
import { cyberRuntimeConfigured } from "./catalog";
import type { CyberJob, CyberRunReport } from "./contracts";
import { redactEvidence } from "@/lib/context/provenance";

export async function proposeCyber(context: TrustedRequestContext, value: unknown, key: string): Promise<CyberJob> {
  if (!cyberRuntimeConfigured()) throw new Error("Cyber execution is disabled or immutable images are not configured.");
  await assertCyberRequestCurrent(context);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new Error("Invalid request key.");
  const payload = prepareCyber(value, bindCyberJob(context, "cyber.exercise"));
  const { data, error } = await runtimeDatabase().rpc("svans_enqueue_cyber", { p_user: context.userId, p_payload: payload, p_hash: cyberHash(payload), p_key: key });
  if (error) throw new Error("Run was not proposed. Check authorization, storage, shared limits, and request key.");
  return (Array.isArray(data) ? data[0] : data) as CyberJob;
}
export async function listCyber(userId: string, scope?: { projectId: string; conversationId: string }): Promise<CyberJob[]> {
  let query = runtimeDatabase().from("svans_jobs").select("id,kind,state,payload_hash,approval_expires_at,approved_at,result,error_code,created_at,updated_at,cancel_requested")
    .eq("user_id", userId).eq("kind", "cyber");
  if (scope) query = query.contains("payload", { request: { projectId: scope.projectId, conversationId: scope.conversationId } });
  const { data, error } = await query.order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error("Cyber run storage is unavailable.");
  return (data || []) as CyberJob[];
}
export async function getCyber(userId: string, id: string): Promise<CyberJob | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await runtimeDatabase().from("svans_jobs").select("*").eq("user_id", userId).eq("kind", "cyber").eq("id", id).maybeSingle();
  if (error) throw new Error("Run unavailable.");
  return data as CyberJob | null;
}
export async function approveCyber(job: CyberJob, expectedHash: string, context: TrustedRequestContext) {
  if (!cyberRuntimeConfigured() || job.user_id !== context.userId || job.payload.binding.grantId !== context.ownerGrant.id) throw new Error("This run requires its original active owner grant.");
  validateApprovedCyber(job.payload, expectedHash);
  if (job.payload_hash !== expectedHash) throw new Error("Approval hash does not match.");
  await resolveCyberJobContext(job, job.payload.binding);
  await assertCyberRequestCurrent(context);
  const { error } = await runtimeDatabase().rpc("svans_approve_cyber", { p_user: context.userId, p_id: job.id, p_hash: expectedHash });
  if (error) throw new Error("Approval expired, authorization changed, or shared run budget exhausted.");
}
export async function claimCyber(worker: string): Promise<CyberJob | null> {
  const { data, error } = await runtimeDatabase().rpc("svans_claim_cyber", { p_worker: worker });
  if (error) throw new Error("Cyber queue unavailable.");
  return (Array.isArray(data) ? data[0] : data) || null;
}
export async function finishCyber(job: CyberJob, report: CyberRunReport | null, errorCode: string | null, unknown = false) {
  const sanitized = report ? { ...report, stdout: redactEvidence(report.stdout), stderr: redactEvidence(report.stderr) } : null;
  const result = sanitized ? { text: "Isolated fixture " + report!.status + ". No real device was scanned.", executionEvents: [], cyber: sanitized } : null;
  const { error } = await runtimeDatabase().rpc("svans_finish_cyber", { p_id: job.id, p_lease: job.lease_token,
    p_result: result, p_error: errorCode, p_unknown: unknown });
  if (error) throw new Error("Run outcome could not be saved. Do not automatically replay.");
}
