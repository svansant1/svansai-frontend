import assert from "node:assert/strict";
import test from "node:test";
import { buildCyberContinuityContext } from "../lib/ai/cyber-continuity";
import { buildContextView } from "../lib/context/compaction";
import { resolveCyberAccess } from "../lib/ai/cyber-mode";
import type { ContextEvent } from "../lib/context/types";

const active = resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true });
const scope = { userId: "owner", projectId: "project", conversationId: "chat" };
function event(id: string, entity: ContextEvent["entity"], field: ContextEvent["field"], value: string): ContextEvent {
  return { id, entity, field, value, source: { kind: "user_report", observedAt: "2026-11-14T12:00:00Z" } };
}
test("scoped continuity preserves target OS, scanner and desktop-only constraints", () => {
  const view = buildContextView({ scope, revision: 5, omittedEvents: 0, events: [
    event("1", "target", "address", "192.0.2.10"), event("2", "target", "os", "Windows"),
    event("3", "scanner", "address", "192.0.2.20"), event("4", "scanner", "environment", "Kali Linux"),
    event("5", "session", "constraints", "Desktop only; do not use RDP"),
  ] });
  const context = buildCyberContinuityContext(view, active);
  for (const detail of ["192.0.2.10", "192.0.2.20", "Windows", "Kali Linux", "do not use RDP"]) assert.ok(context.includes(detail));
  assert.match(context, /Investigation revision 5/);
});
test("pasted scan evidence stays reported, never a verified assistant observation", () => {
  const view = buildContextView({ scope, revision: 1, omittedEvents: 0, events: [
    event("1", "session", "evidence", "Nmap: 22/tcp filtered ssh. netstat -ano: ESTABLISHED outbound connection."),
  ] });
  const context = buildCyberContinuityContext(view, active);
  assert.match(context, /filtered ssh/);
  assert.match(context, /ESTABLISHED/);
  assert.match(context, /user_report/);
  assert.match(context, /Never promote an assistant example/);
  assert.doesNotMatch(context, /tool_observation/);
});
test("inactive Cyber mode cannot inject stored investigation context", () => {
  const view = { scope, revision: 1, text: "Private investigation", omittedEvents: 0 };
  assert.equal(buildCyberContinuityContext(view, { ...active, active: false }), "");
});
