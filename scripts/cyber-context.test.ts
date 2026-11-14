// Authored only. Not executed during the source integration pass.
import test from "node:test";
import assert from "node:assert/strict";
import { parseUserEvent, redactStructuredContent } from "../lib/context/provenance";
import { buildContextView } from "../lib/context/compaction";
import { encodeStoredMessage, decodeStoredMessage } from "../lib/artifacts/message-storage";
import type { ContextEvent } from "../lib/context/types";
const id = (n: number) => "00000000-0000-4000-a000-" + String(n).padStart(12, "0");
const scope = { userId: id(1), projectId: id(2), conversationId: id(3) };
function fact(n: number, entity: ContextEvent["entity"], field: ContextEvent["field"], value: string): ContextEvent {
  return { id: id(n), entity, field, value, source: { kind: "user_report", observedAt: "2026-11-10T12:00:00Z" } };
}
test("client cannot promote pasted output to authenticated tool observation", () => {
  const event = parseUserEvent({ ...fact(4, "session", "evidence", "Authorization: Bearer example-secret"), source: { kind: "tool_observation" } });
  assert.equal(event.source.kind, "user_report"); assert.ok(!event.value.includes("example-secret"));
});
test("correction keeps scanner separate and survives a long bounded context", () => {
  const original = fact(4, "target", "address", "192.0.2.10"), corrected = { ...fact(5, "target", "address", "192.0.2.11"), supersedes: original.id };
  const events = [original, fact(6, "scanner", "address", "192.0.2.20"), fact(7, "target", "os", "Windows"),
    fact(8, "scanner", "environment", "Kali"), fact(9, "session", "constraints", "Desktop only; do not use RDP"),
    ...Array.from({ length: 300 }, (_, n) => fact(n + 10, "session", "evidence", "Log " + n + " ".repeat(100))), corrected];
  const view = buildContextView({ scope, revision: 306, omittedEvents: 0, events }, 1800);
  assert.ok(view.text.includes("192.0.2.11")); assert.ok(!view.text.includes("192.0.2.10")); assert.ok(view.text.includes("192.0.2.20"));
  assert.ok(view.text.includes("Windows")); assert.ok(view.text.includes("Kali")); assert.ok(view.text.includes("do not use RDP"));
  assert.ok(view.omittedEvents > 0);
});
test("unknown target OS is not silently invented", () => {
  const view = buildContextView({ scope, revision: 1, omittedEvents: 0, events: [fact(4, "scanner", "environment", "Kali")] });
  assert.ok(!view.text.includes("Windows")); assert.ok(!view.text.includes('"entity":"target"'));
});
test("hypothesis confidence needs a basis and remains a user report", () => {
  const input = { ...fact(4, "session", "hypothesis", "Seed transaction conflict"), assessment: { status: "supported", confidence: 0.75, basis: "Serial passes; parallel fails." } };
  const event = parseUserEvent(input); assert.equal(event.assessment?.confidence, 0.75); assert.equal(event.source.kind, "user_report");
  assert.throws(() => parseUserEvent({ ...input, assessment: { ...input.assessment, confidence: 1.1 } }));
});
test("stable message IDs survive storage without breaking legacy text", () => {
  const message = { id: id(12), role: "user" as const, content: "Target address correction" };
  assert.deepEqual(decodeStoredMessage({ role: "user", content: encodeStoredMessage(message) }), message);
  assert.equal(decodeStoredMessage({ role: "user", content: "Legacy plain text" }).content, "Legacy plain text");
});
test("report redaction does not corrupt the native document JSON", () => {
  const value = JSON.parse(redactStructuredContent(JSON.stringify({ title: "Review", token: "public label", password: "example-secret", text: "Authorization: Bearer example-token" })));
  assert.equal(value.password, "[REDACTED]"); assert.ok(!value.text.includes("example-token"));
});
