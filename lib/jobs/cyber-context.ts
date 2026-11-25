import type { JobPayload, JobRecord } from "./types";
import type { TrustedRequestContext } from "@/lib/platform/request-context";
import { assertCyberRequestCurrent } from "@/lib/platform/request-context";
import { ownerDatabase, OwnerAccessError } from "@/lib/auth/owner-session";
import { buildContextView } from "@/lib/context/compaction";
import { loadContext } from "@/lib/context/store";
import { resolveCyberAccess } from "@/lib/ai/cyber-mode";
import { isUuid } from "./store";

export type JobContextReference = { projectId: string; conversationId: string; revision: number };
export type CyberJobBinding = {
  version: 1; capability: "generation" | "cyber.exercise"; userId: string;
  grantId: string; grantRevision: number; context: JobContextReference;
};
export type StoredGenerationPayload = JobPayload & { _cyber?: CyberJobBinding };

/** Called only after server-side owner, cookie and mode verification, never from client JSON. */
export function bindCyberJob(context: TrustedRequestContext, capability: CyberJobBinding["capability"] = "generation"): CyberJobBinding {
  return { version: 1, capability, userId: context.userId, grantId: context.ownerGrant.id, grantRevision: context.ownerGrant.revision,
    context: { projectId: context.scope.projectId, conversationId: context.scope.conversationId, revision: context.context.revision } };
}
export function parseCyberBinding(value: unknown, capability: CyberJobBinding["capability"]): CyberJobBinding {
  const b = value as CyberJobBinding;
  if (!b || b.version !== 1 || b.capability !== capability || !isUuid(b.userId || "") || !isUuid(b.grantId || "") ||
    !Number.isSafeInteger(b.grantRevision) || b.grantRevision < 1 || !b.context ||
    !isUuid(b.context.projectId || "") || !isUuid(b.context.conversationId || "") ||
    !Number.isSafeInteger(b.context.revision) || b.context.revision < 0) throw new OwnerAccessError("Invalid job authorization binding.");
  if (Object.keys(b).some(key => !["version", "capability", "userId", "grantId", "grantRevision", "context"].includes(key)) ||
    Object.keys(b.context).some(key => !["projectId", "conversationId", "revision"].includes(key))) throw new OwnerAccessError("Unexpected job authorization fields.");
  return b;
}
/** Check configured owner eligibility again when queued work runs; no idle renewal. */
export async function resolveCyberJobContext(job: Pick<JobRecord, "id" | "user_id">, binding: CyberJobBinding, signal?: AbortSignal): Promise<TrustedRequestContext> {
  if (binding.userId !== job.user_id) throw new OwnerAccessError("Job owner does not match its context.");
  const { data, error } = await ownerDatabase().auth.admin.getUserById(job.user_id);
  const ownerId = process.env.OWNER_USER_ID?.trim(), ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (error || !data.user || (ownerId ? data.user.id !== ownerId : !ownerEmail || !data.user.email_confirmed_at || data.user.email?.toLowerCase() !== ownerEmail)) {
    throw new OwnerAccessError("Job is not owned by the current verified owner.");
  }
  const scope = { userId: job.user_id, projectId: binding.context.projectId, conversationId: binding.context.conversationId };
  const snapshot = await loadContext(scope);
  if (snapshot.revision !== binding.context.revision) throw new OwnerAccessError("Investigation changed. Review and queue the task again.");
  const context: TrustedRequestContext = {
    requestId: job.id, userId: job.user_id, scope,
    // Deadlines here are not authority; every check resolves the live database grant.
    ownerGrant: { id: binding.grantId, userId: job.user_id, revision: binding.grantRevision, lastActivityAt: "", idleLocksAt: "" },
    cyber: resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true }),
    context: buildContextView(snapshot), expectedContextRevision: binding.context.revision, progressReadOnly: true, signal,
  };
  await assertCyberRequestCurrent(context);
  return context;
}
