// Authored only; database lease/revocation scenarios remain separate acceptance checks.
import test from "node:test";
import assert from "node:assert/strict";
import { parseJobPayload } from "../lib/jobs/types";
import { parseCyberBinding } from "../lib/jobs/cyber-context";
import { hashJobPayload } from "../lib/jobs/payload-hash";
test("client cannot queue a forged privileged binding", () => {
  const base = { messages: [{ role: "user", content: "Prepare a report" }] };
  for (const key of ["_cyber", "grantId", "ownerGrant", "isVerifiedOwner", "trustedContext"]) assert.throws(() => parseJobPayload({ ...base, [key]: "forged" }));
  const result = parseJobPayload({ ...base, cyberMode: true, projectId: "client-choice", conversationId: "client-choice" });
  assert.ok(!("_cyber" in result)); // Only the verified server handler may attach a binding.
});
test("grant capability and revision cannot be omitted", () => {
  assert.throws(() => parseCyberBinding({ version: 1, capability: "generation" }, "generation"));
  assert.throws(() => parseCyberBinding({ version: 1, capability: "cyber.exercise" }, "generation"));
});
test("owner password exchanges cannot enter the background queue", () => {
  assert.throws(() => parseJobPayload({ messages: [{ role: "assistant", content: "Enter owner password:" }, { role: "user", content: "example" }] }));
});
test("privileged payload hash survives JSONB key ordering but not edits", () => {
  assert.equal(hashJobPayload({ b: 2, a: 1 }), hashJobPayload({ a: 1, b: 2 }));
  assert.notEqual(hashJobPayload({ a: 1 }), hashJobPayload({ a: 2 }));
});
