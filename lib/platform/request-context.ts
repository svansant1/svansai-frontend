import type { OwnerGrant } from "@/lib/auth/owner-grant";
import type { ContextScope, ContextView } from "@/lib/context/types";
import type { CyberAccessContext } from "@/lib/ai/cyber-mode";
import { resolveCyberAccess } from "@/lib/ai/cyber-mode";
import { assertOwnerGrantCurrent, cyberEnabled, ownerDatabase, OwnerAccessError, recordOwnerActivity } from "@/lib/auth/owner-session";
import { buildContextView } from "@/lib/context/compaction";
import { loadContext } from "@/lib/context/store";
import { assertContextScope } from "@/lib/projects/permissions";
export type TrustedRequestContext = {
  requestId: string; userId: string; scope: ContextScope; ownerGrant: OwnerGrant;
  cyber: CyberAccessContext; context: ContextView; signal?: AbortSignal;
  expectedContextRevision?: number;
};
export async function setCyberSelection(grant: OwnerGrant, scope: ContextScope, enabled: boolean) {
  await assertOwnerGrantCurrent(grant);
  if (scope.userId !== grant.userId) throw new OwnerAccessError("Invalid context owner.");
  await assertContextScope(scope);
  const { error } = await ownerDatabase().rpc("sv_cyber_select", { p_user: scope.userId, p_grant: grant.id,
    p_revision: grant.revision, p_project: scope.projectId, p_conversation: scope.conversationId, p_enabled: enabled });
  if (error) throw new OwnerAccessError("Cyber Lab selection could not be saved.", 503);
  await assertOwnerGrantCurrent(grant);
}
export async function assertCyberRequestCurrent(context: TrustedRequestContext) {
  if (!context.cyber.active || context.userId !== context.scope.userId || context.userId !== context.ownerGrant.userId) throw new OwnerAccessError("Cyber execution identity does not match its scope.");
  if (context.signal?.aborted) throw new OwnerAccessError("Cyber request was cancelled.", 409);
  if (!cyberEnabled()) throw new OwnerAccessError("Cyber Lab is disabled.");
  await assertOwnerGrantCurrent(context.ownerGrant);
  await assertContextScope(context.scope);
  if (context.expectedContextRevision !== undefined && (await loadContext(context.scope)).revision !== context.expectedContextRevision) {
    throw new OwnerAccessError("Investigation context changed. Review and submit again.");
  }
  const { data, error } = await ownerDatabase().from("sv_cyber_modes").select("grant_id").eq("grant_id", context.ownerGrant.id).eq("project_id", context.scope.projectId).eq("conversation_id", context.scope.conversationId).maybeSingle();
  if (error || !data) throw new OwnerAccessError("Cyber Lab is OFF or locked for this conversation.");
}
export async function buildCyberRequest(req: Request, input: { userId: string; requestId: string; projectId: string; conversationId: string }): Promise<TrustedRequestContext> {
  if (!cyberEnabled()) throw new OwnerAccessError("Cyber Lab is disabled.");
  const grant = await recordOwnerActivity(req, input.userId);
  if (!grant) throw new OwnerAccessError("Cyber Lab is locked. Use sv unlock again.");
  const scope = { userId: input.userId, projectId: input.projectId, conversationId: input.conversationId };
  const context = { requestId: input.requestId, userId: input.userId, scope, ownerGrant: grant,
    cyber: resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true }),
    context: buildContextView(await loadContext(scope)), signal: req.signal };
  await assertCyberRequestCurrent(context);
  return context;
}
