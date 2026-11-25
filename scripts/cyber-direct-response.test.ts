import assert from "node:assert/strict";
import test from "node:test";
import { generateCyberResponse, type CyberResponseDependencies } from "../lib/ai/cyber-response";
import { buildContextView } from "../lib/context/compaction";
import { resolveCyberAccess } from "../lib/ai/cyber-mode";
import { ProviderError } from "../lib/ai/providers/outcomes";
import type { TrustedRequestContext } from "../lib/platform/request-context";
import type { ContextEvent } from "../lib/context/types";

const answer = { kind: "answer", answer: "The output reports a stopped service, not a firewall diagnosis.", updates: [], nextAction: null };
const next = { ...answer, kind: "next_step", nextAction: { action: "Get-Service sshd", machine: "Windows target", environment: "PowerShell", reason: "Confirm the reported service state", expected: "Service status", ifExpected: "Compare listener state", otherwise: "Report error text", evidenceIds: ["e1"], revisit: null } };
function fixture() {
  const scope = { userId: "owner", projectId: "project", conversationId: "chat" };
  const events: ContextEvent[] = [{ id: "e1", entity: "session", field: "evidence", value: "User reports a stopped Windows service", source: { kind: "user_report", observedAt: "2026-11-21T12:00:00Z" } }];
  const context: TrustedRequestContext = { requestId: "request", userId: "owner", scope,
    ownerGrant: { id: "grant", userId: "owner", revision: 1, lastActivityAt: "", idleLocksAt: "" },
    cyber: resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true }),
    context: buildContextView({ scope, revision: 1, events, omittedEvents: 0 }), expectedContextRevision: 1 };
  let saves = 0, searches = 0, checks = 0;
  const deps: CyberResponseDependencies = {
    assertCurrent: async () => { checks++; },
    search: async () => { searches++; throw new Error("Unexpected web call"); },
    execute: async (_request, policy) => { const text = JSON.stringify(next); await policy.validate?.(text); return { text, provider: "openai", attempts: [], estimatedTokensReserved: 0 }; },
    save: async (savedScope, revision, added) => { saves++; assert.deepEqual(savedScope, scope); assert.equal(revision, 1); return { scope, revision: revision + added.length, events: [...events, ...added], omittedEvents: 0 }; },
  };
  return { context, deps, counts: () => ({ saves, searches, checks }) };
}
const messages = [{ role: "user" as const, content: "What next? Nmap banner: https://nmap.org" }];

test("typed evidence needs no image or web search; validated progress saves before publication", async () => {
  const f = fixture();
  const reply = await generateCyberResponse(messages, [], f.context, undefined, f.deps);
  assert.match(reply, /Windows target.*PowerShell/);
  assert.match(reply, /have not run it/);
  assert.equal(f.counts().saves, 1); assert.equal(f.counts().searches, 0);
  assert.equal(f.context.expectedContextRevision, 2);
  assert.ok(f.counts().checks >= 3);
});

test("current attachments pass through even with identical names; direct answers create no steps", async () => {
  const f = fixture();
  const files = [{ name: "pasted-image.png", type: "image/png", base64: "one" }, { name: "pasted-image.png", type: "image/png", base64: "two" }];
  f.deps.execute = async (request, policy) => {
    assert.deepEqual(request.attachedFiles, files); assert.match(request.systemInstruction, /fresh input/);
    const text = JSON.stringify(answer); await policy.validate?.(text); return { text, provider: "openai", attempts: [], estimatedTokensReserved: 0 };
  };
  assert.match(await generateCyberResponse(messages, files, f.context, undefined, f.deps), /stopped service/);
  assert.equal(f.counts().saves, 0);
});

test("malformed/repeated results are withheld, not printed as a tutorial", async () => {
  const f = fixture();
  f.deps.execute = async (_request, policy) => { await policy.validate?.("Unvalidated tutorial"); throw new Error("Expected rejection"); };
  const reply = await generateCyberResponse(messages, [], f.context, undefined, f.deps);
  assert.doesNotMatch(reply, /Unvalidated tutorial/); assert.match(reply, /could not complete/);
  assert.equal(f.counts().saves, 0);
});

test("policy refusals remain terminal and create no progress", async () => {
  const f = fixture();
  f.deps.execute = async (_request, policy) => {
    await assert.rejects(async () => policy.validate?.("I cannot help with unauthorized compromise."), (e: unknown) => e instanceof ProviderError && e.outcome === "PROVIDER_POLICY_REFUSAL");
    throw new ProviderError("PROVIDER_POLICY_REFUSAL", "Declined");
  };
  assert.match(await generateCyberResponse(messages, [], f.context, undefined, f.deps), /did not switch providers/);
  assert.equal(f.counts().saves, 0);
});

test("storage failure or concurrent revisions cannot publish a claimed saved step", async () => {
  for (const concurrent of [false, true]) {
    const f = fixture();
    f.deps.save = async (_scope, revision, events) => {
      if (!concurrent) throw new Error("Storage unavailable");
      return { scope: f.context.scope, revision: revision + events.length + 1, events, omittedEvents: 0 };
    };
    await assert.rejects(generateCyberResponse(messages, [], f.context, undefined, f.deps));
    assert.equal(f.context.expectedContextRevision, 1);
    assert.equal(f.context.progressWrite, undefined);
  }
});

test("revocation after provider result prevents persistence and response", async () => {
  const f = fixture(); let revoked = false;
  f.deps.assertCurrent = async () => { if (revoked) throw new Error("Locked"); };
  const original = f.deps.execute;
  f.deps.execute = async (...args) => { const result = await original(...args); revoked = true; return result; };
  await assert.rejects(generateCyberResponse(messages, [], f.context, undefined, f.deps), /Locked/);
  assert.equal(f.counts().saves, 0);
});

test("background analysis preserves frozen job binding and discloses unsaved progress", async () => {
  const f = fixture(); f.context.progressReadOnly = true;
  const reply = await generateCyberResponse(messages, [], f.context, undefined, f.deps);
  assert.equal(f.counts().saves, 0); assert.equal(f.context.expectedContextRevision, 1);
  assert.match(reply, /not saved.*background/i);
});
