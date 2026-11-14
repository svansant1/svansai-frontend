import { createHash } from "node:crypto";
import { appendContextEvents, loadContext } from "./store";
import { redactEvidence, UUID } from "./provenance";
import type { ContextScope, ContextSnapshot } from "./types";
import { OwnerAccessError } from "@/lib/auth/owner-session";
/** Retain the user's report without extracting an IP or claiming a command actually ran. */
export async function captureUserTurn(scope: ContextScope, message: { id?: string; content: string }): Promise<ContextSnapshot> {
  const hash = createHash("sha256").update(scope.conversationId + "\n" + message.content).digest("hex");
  const id = message.id && UUID.test(message.id) ? message.id : hash.slice(0, 8) + "-" + hash.slice(8, 12) + "-4" + hash.slice(13, 16) + "-a" + hash.slice(17, 20) + "-" + hash.slice(20, 32);
  const value = redactEvidence(message.content).slice(0, 11_900) + (message.content.length > 11_900 ? "\n[Evidence excerpt truncated; original remains in the conversation.]" : "");
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await loadContext(scope);
    const existing = state.events.find(event => event.id === id);
    if (existing) {
      if (existing.entity !== "session" || existing.field !== "evidence" || existing.value !== value) throw new OwnerAccessError("Message ID was reused for different evidence. Submit with a new message ID.", 409);
      return state;
    }
    try {
      return await appendContextEvents(scope, state.revision, [{ id, entity: "session", field: "evidence", value,
        source: { kind: "user_report", messageId: id, observedAt: new Date().toISOString() } }]);
    } catch (error) {
      if (!(error instanceof OwnerAccessError) || error.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new OwnerAccessError("Investigation changed concurrently. Retry this message.", 409);
}
