import { ownerDatabase, OwnerAccessError } from "@/lib/auth/owner-session";
import { assertContextScope } from "@/lib/projects/permissions";
import type { ContextEvent, ContextScope, ContextSnapshot } from "./types";
export async function loadContext(scope: ContextScope): Promise<ContextSnapshot> {
  await assertContextScope(scope);
  const { data, error } = await ownerDatabase().rpc("sv_context_read", { p_user: scope.userId, p_project: scope.projectId, p_conversation: scope.conversationId });
  if (error || !data) throw new OwnerAccessError("Context storage is unavailable.", 503);
  return { scope, revision: Number(data.revision), events: data.events || [], omittedEvents: Number(data.omitted || 0) };
}
export async function appendContextEvents(scope: ContextScope, expectedRevision: number, events: ContextEvent[]): Promise<ContextSnapshot> {
  await assertContextScope(scope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !events.length || events.length > 20) throw new OwnerAccessError("Invalid context revision or event count.", 400);
  const { data, error } = await ownerDatabase().rpc("sv_context_append", { p_user: scope.userId, p_project: scope.projectId, p_conversation: scope.conversationId, p_revision: expectedRevision, p_events: events });
  if (error) throw new OwnerAccessError("Evidence could not be saved.", 503);
  if (data?.conflict) throw new OwnerAccessError("Context changed. Reload the evidence before saving.", 409);
  return loadContext(scope);
}
export async function deleteContext(scope: ContextScope): Promise<void> {
  await assertContextScope(scope);
  const { error } = await ownerDatabase().rpc("sv_context_delete", { p_user: scope.userId, p_project: scope.projectId, p_conversation: scope.conversationId });
  if (error) throw new OwnerAccessError("Context could not be deleted.", 503);
}
