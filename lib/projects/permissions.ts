import { ownerDatabase, OwnerAccessError } from "@/lib/auth/owner-session";
import { UUID } from "@/lib/context/provenance";
import type { ContextScope } from "@/lib/context/types";
export async function assertContextScope(scope: ContextScope): Promise<void> {
  if (![scope.userId, scope.projectId, scope.conversationId].every(v => UUID.test(v))) throw new OwnerAccessError("Invalid context identity.", 400);
  const db = ownerDatabase();
  const [project, conversation] = await Promise.all([
    db.from("sv_projects").select("id").eq("id", scope.projectId).eq("user_id", scope.userId).maybeSingle(),
    db.from("conversations").select("id").eq("id", scope.conversationId).eq("user_id", scope.userId).maybeSingle(),
  ]);
  if (project.error || conversation.error) throw new OwnerAccessError("Context storage is unavailable.", 503);
  if (!project.data || !conversation.data) throw new OwnerAccessError("This project or conversation is not accessible.", 404);
  const head = await db.from("sv_context_heads").select("project_id").eq("conversation_id", scope.conversationId).eq("user_id", scope.userId).maybeSingle();
  if (head.error) throw new OwnerAccessError("Context storage is unavailable.", 503);
  if (head.data && head.data.project_id !== scope.projectId) throw new OwnerAccessError("This conversation belongs to a different investigation. Start a new conversation for the other project.", 409);
}
