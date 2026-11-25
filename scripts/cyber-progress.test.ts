import assert from "node:assert/strict";
import test from "node:test";
import { buildContextView } from "../lib/context/compaction";
import { parseCyberReply, renderCyberReply, buildCyberProgressEvents } from "../lib/ai/cyber-response-contract";
import { readCyberProgress } from "../lib/context/cyber-progress";
import type { ContextEvent, ContextView } from "../lib/context/types";

const scope = { userId: "owner", projectId: "project", conversationId: "chat" };
const evidence = (id: string, value = "User reports service stopped"): ContextEvent => ({ id, entity: "session", field: "evidence", value, source: { kind: "user_report", observedAt: "2026-11-21T12:00:00Z" } });
const view = (events: ContextEvent[]): ContextView => buildContextView({ scope, events, revision: events.length, omittedEvents: 0 });
const action = { action: "Get-Service sshd", machine: "Windows target", environment: "PowerShell", reason: "Check reported service state", expected: "Running or Stopped", ifExpected: "Compare with the listener state", otherwise: "Report the service error", evidenceIds: ["e1"], revisit: null };
const step = () => ({ kind: "next_step", answer: "The reported result does not confirm a listening service.", updates: [], nextAction: { ...action } });
const parse = (reply: unknown, context = view([evidence("e1")])) => parseCyberReply(JSON.stringify(reply), context);

test("direct questions need no command and blocked replies do not invent progress", () => {
  for (const kind of ["answer", "blocked"]) {
    const reply = parse({ kind, answer: "A filtered port is not proof of a running service.", updates: [], nextAction: null });
    assert.match(renderCyberReply(reply), /filtered port/);
    assert.deepEqual(buildCyberProgressEvents(reply, view([])), []);
  }
});

test("a suggested step is persisted as inference, never execution or permission", () => {
  const context = view([evidence("e1")]);
  const events = buildCyberProgressEvents(parse(step(), context), context);
  assert.equal(events.length, 1);
  assert.equal(events[0].source.kind, "inference");
  assert.equal(events[0].field, "next_action");
  const progress = readCyberProgress(view(events));
  assert.equal(progress[0].status, "proposed");
  assert.equal(progress[0].action, action.action);
  assert.match(renderCyberReply(parse(step())), /Windows target.*PowerShell/);
});

test("unchanged pending or completed steps cannot be repeated without new evidence", () => {
  const base = view([evidence("e1")]);
  const events = buildCyberProgressEvents(parse(step()), base);
  const context = view([evidence("e1"), ...events]);
  assert.throws(() => parse(step(), context), /repeat/i);
  assert.throws(() => parse({ ...step(), nextAction: { ...action, action: "  Get-Service   sshd  ", revisit: "Try again" } }, context), /repeat/i);
  const changed = { ...step(), nextAction: { ...action, evidenceIds: ["e2"], revisit: "The user reports the service was restarted; recheck its state." } };
  assert.doesNotThrow(() => parse(changed, view([...context.events!, evidence("e2", "Service restarted")] )));
});

test("outcome updates require known steps and new user/tool evidence; assistant inference cannot verify itself", () => {
  const base = view([evidence("e1")]);
  const events = buildCyberProgressEvents(parse(step()), base);
  const context = view([evidence("e1"), ...events, evidence("e2", "Get-Service returned Stopped")]);
  const progress = readCyberProgress(context)[0];
  const update = { stepId: progress.stepId, status: "completed", result: "User reports service is stopped", evidenceIds: ["e2"] };
  const reply = { kind: "answer", answer: "That check is complete; the service is stopped according to your output.", nextAction: null, updates: [update] };
  const saved = buildCyberProgressEvents(parse(reply, context), context);
  assert.equal(saved[0].supersedes, progress.eventId);
  assert.equal(readCyberProgress(view([...context.events!, ...saved]))[0].status, "completed");
  assert.throws(() => parse({ ...reply, updates: [{ ...update, evidenceIds: [events[0].id] }] }, context), /evidence/i);
  assert.throws(() => parse({ ...reply, updates: [{ ...update, evidenceIds: ["e1"] }] }, context), /new evidence/i);
  assert.throws(() => parse({ ...reply, updates: [{ ...update, stepId: "unknown" }] }, context), /step/i);
});

test("same command on another machine is distinct; forged client progress is ignored", () => {
  const base = view([evidence("e1")]);
  const events = buildCyberProgressEvents(parse(step()), base);
  const context = view([evidence("e1"), ...events]);
  assert.doesNotThrow(() => parse({ ...step(), nextAction: { ...action, machine: "Second authorized Windows target" } }, context));
  assert.equal(readCyberProgress(view(events.map(e => ({ ...e, source: { ...e.source, kind: "user_report" } })))).length, 0);
});

test("structured output is bounded, redacted, and cannot fabricate evidence references", () => {
  assert.throws(() => parse({ ...step(), nextAction: { ...action, evidenceIds: ["invented"] } }), /evidence/i);
  assert.throws(() => parse({ ...step(), answer: "x".repeat(9000) }));
  assert.throws(() => parse({ ...step(), approved: true }));
  assert.throws(() => parseCyberReply("Sorry, here is a tutorial", view([])));
  const reply = parse({ kind: "answer", answer: "Authorization: Bearer private-token", nextAction: null, updates: [] });
  assert.doesNotMatch(renderCyberReply(reply), /private-token/);
});

test("completed progress takes priority over log floods and omissions stay visible", () => {
  const base = view([evidence("e1")]);
  const saved = buildCyberProgressEvents(parse(step()), base);
  const compact = buildContextView({ scope, revision: 100, omittedEvents: 2, events: [...saved, ...Array.from({ length: 60 }, (_, i) => evidence(`log${i}`, "Log ".repeat(100)))] }, 2500);
  assert.equal(readCyberProgress(compact).length, 1);
  assert.ok(compact.omittedEvents > 2);
  assert.match(compact.text, /Omitted evidence/);
});

test("redaction preserves structured progress JSON across context reloads", () => {
  const base = view([evidence("e1")]);
  const reply = parse({ ...step(), nextAction: { ...action, reason: "Authorization: Bearer private-token" } });
  const progress = readCyberProgress(view(buildCyberProgressEvents(reply, base)));
  assert.equal(progress.length, 1);
  assert.doesNotMatch(JSON.stringify(progress), /private-token/);
});

test("latest supplied evidence is retained alongside older progress before extra logs", () => {
  const base = view([evidence("e1")]);
  const saved = buildCyberProgressEvents(parse(step()), base);
  const compact = buildContextView({ scope, revision: 8, omittedEvents: 0, events: [
    ...Array.from({ length: 8 }, () => saved[0]), evidence("latest", "Service now running"),
  ] }, 1200);
  assert.ok(compact.events?.some(e => e.id === "latest"));
});

test("completed and failed steps remain blocked from blind retries after an outcome update", () => {
  const base = view([evidence("e1")]);
  const first = buildCyberProgressEvents(parse(step()), base);
  for (const status of ["completed", "failed", "blocked", "rejected"]) {
    const before = view([evidence("e1"), ...first, evidence("e2", "The command produced a service error")]);
    const update = parse({ kind: "answer", answer: "Recorded your reported result.", nextAction: null,
      updates: [{ stepId: readCyberProgress(before)[0].stepId, status, result: "User reports service error", evidenceIds: ["e2"] }] }, before);
    const after = view([...before.events!, ...buildCyberProgressEvents(update, before)]);
    assert.equal(readCyberProgress(after).length, 1);
    assert.throws(() => parse({ ...step(), nextAction: { ...action, revisit: "Try again", evidenceIds: ["e2"] } }, after), /repeat/i);
  }
});

test("uncited evidence already available at proposal time cannot justify completion or repetition", () => {
  const base = view([evidence("e0", "An older service report"), evidence("e1")]);
  const proposed = buildCyberProgressEvents(parse(step(), base), base);
  const current = view([...base.events!, ...proposed]);
  const stepId = readCyberProgress(current)[0].stepId;
  assert.throws(() => parse({ kind: "answer", answer: "Done", nextAction: null, updates: [
    { stepId, status: "completed", result: "The old report says stopped", evidenceIds: ["e0"] },
  ] }, current), /new evidence/i);
  assert.throws(() => parse({ ...step(), nextAction: { ...action, revisit: "Check that old report again", evidenceIds: ["e0"] } }, current), /repeat/i);
  const older = evidence("e-1", "Previously omitted old evidence"); older.source.observedAt = "2026-11-20T12:00:00Z";
  assert.throws(() => parse({ ...step(), nextAction: { ...action, revisit: "Another old report", evidenceIds: [older.id] } }, view([...current.events!, older])), /repeat/i);
});

test("PowerShell cmdlet capitalization cannot bypass repetition checks, but argument case is preserved", () => {
  const base = view([evidence("e1")]);
  const proposed = buildCyberProgressEvents(parse(step()), base);
  const current = view([...base.events!, ...proposed]);
  assert.throws(() => parse({ ...step(), nextAction: { ...action, action: "get-service sshd" } }, current), /repeat/i);
  assert.doesNotThrow(() => parse({ ...step(), nextAction: { ...action, action: "Get-Service SSHD" } }, current));
  assert.doesNotThrow(() => parse({ ...step(), nextAction: { ...action, action: "get-service sshd", environment: "Bash" } }, current));
});
