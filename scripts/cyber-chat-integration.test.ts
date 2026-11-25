import assert from "node:assert/strict";
import test from "node:test";
import { buildContextView } from "../lib/context/compaction";
import { resolveCyberAccess } from "../lib/ai/cyber-mode";
import type { ContextEvent } from "../lib/context/types";
import type { TrustedRequestContext } from "../lib/platform/request-context";

// The real chat entry point and provider/store adapters run against an in-memory HTTP fixture.
// Never contact a provider, owner account, or database from this test process.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://cyber-chat-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.OPENAI_API_KEY = "test-only";
process.env.GEMINI_API_KEY = "test-only";
process.env.SVANSAI_ALLOWED_PROVIDERS = "openai";
process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED = "1";

const id = (n: number) => "00000000-0000-4000-a000-" + String(n).padStart(12, "0");
const scope = { userId: id(1), projectId: id(2), conversationId: id(3) };
const initial: ContextEvent = { id: id(4), entity: "session", field: "evidence", value: "My Windows target reports a stopped service", source: { kind: "user_report", observedAt: "2026-11-23T12:00:00Z" } };
let revision = 1;
let events = [initial];
let calls = 0;
globalThis.fetch = async (input, init) => {
  calls++;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  const body = typeof raw === "string" && raw ? JSON.parse(raw) : {};
  if (url.hostname === "cyber-chat-test.supabase.co") {
    if (url.pathname.endsWith("/rpc/sv_owner_resolve")) return Response.json({ id: id(5), user_id: scope.userId, revision: 1, last_activity_at: "2026-11-23T12:00:00Z", idle_locks_at: "2026-11-23T12:30:00Z" });
    if (url.pathname.endsWith("/rpc/sv_context_read")) return Response.json({ revision, events, omitted: 0 });
    if (url.pathname.endsWith("/rpc/sv_context_append")) {
      assert.equal(body.p_user, scope.userId); assert.equal(body.p_project, scope.projectId); assert.equal(body.p_conversation, scope.conversationId);
      assert.equal(body.p_revision, revision);
      events = [...events, ...body.p_events]; revision += body.p_events.length;
      return Response.json({ revision });
    }
    if (url.pathname.endsWith("/sv_projects")) return Response.json([{ id: scope.projectId }]);
    if (url.pathname.endsWith("/conversations")) return Response.json([{ id: scope.conversationId }]);
    if (url.pathname.endsWith("/sv_context_heads")) return Response.json([{ project_id: scope.projectId }]);
    if (url.pathname.endsWith("/sv_cyber_modes")) return Response.json([{ grant_id: id(5) }]);
  }
  if (url.hostname === "api.openai.com") return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ kind: "next_step", answer: "The reported service is stopped; a firewall cause is not confirmed.", updates: [], nextAction: {
    action: "Get-Service sshd", machine: "Windows target", environment: "PowerShell", reason: "Confirm service state", expected: "Running or Stopped", ifExpected: "Inspect listener state", otherwise: "Report error", evidenceIds: [initial.id], revisit: null,
  } }) } }] });
  throw new Error(`Unexpected network request blocked: ${url.hostname}${url.pathname}`);
};
function context(): TrustedRequestContext {
  return { requestId: "request", userId: scope.userId, scope, ownerGrant: { id: id(5), userId: scope.userId, revision: 1, lastActivityAt: "", idleLocksAt: "" },
    cyber: resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true }),
    context: buildContextView({ scope, revision, events, omittedEvents: 0 }), expectedContextRevision: revision };
}

test("chat entry point retains the shared context so progress survives outer publication checks", async () => {
  const { generateChatResponse } = await import("../lib/ai/chat-engine");
  const { assertCyberRequestCurrent } = await import("../lib/platform/request-context");
  const trusted = context();
  const reply = await generateChatResponse([{ role: "user", content: initial.value }], { trustedContext: trusted });
  assert.match(reply, /Next — Windows target/);
  assert.equal(revision, 2);
  await assertCyberRequestCurrent(trusted);
  assert.equal(trusted.expectedContextRevision, revision);
  assert.ok(trusted.context.events?.some(e => e.source.kind === "inference"));
});

test("a separate request signal cannot replace a revoked owner-watch signal", async () => {
  const { generateChatResponse } = await import("../lib/ai/chat-engine");
  const trusted = context(); const owner = new AbortController(); owner.abort(); trusted.signal = owner.signal;
  const before = calls;
  await assert.rejects(generateChatResponse([{ role: "user", content: "Continue" }], { trustedContext: trusted, signal: new AbortController().signal }), /cancelled|abort/i);
  assert.equal(calls, before);
});
