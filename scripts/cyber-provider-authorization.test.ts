// Authored only. Fake adapters; no paid calls.
import test from "node:test";
import assert from "node:assert/strict";
import { executeProviderPlan, ProviderExecutionError } from "../lib/ai/providers/execution-plan";
import { ProviderError } from "../lib/ai/providers/outcomes";
import { resetProviderCooldowns } from "../lib/ai/providers/executor";
const request = { prompt: "Interpret supplied evidence", systemInstruction: "Evidence first", temperature: 0 };
test("revocation between attempts prevents the fallback provider from receiving data", async () => {
  resetProviderCooldowns(); let valid = true, calls = 0;
  await assert.rejects(executeProviderPlan(request, { providers: ["openai", "anthropic"], assertAuthorized: async () => { if (!valid) throw new Error("Locked"); } },
    { configured: () => true, call: async () => { calls++; valid = false; throw new ProviderError("RATE_LIMIT", "Temporary"); } }),
    (e: ProviderExecutionError) => e.outcome === "SVANS_POLICY_BLOCK");
  assert.equal(calls, 1);
});
test("a successful provider result is withheld if permission was revoked", async () => {
  resetProviderCooldowns(); let valid = true;
  await assert.rejects(executeProviderPlan(request, { providers: ["openai"], assertAuthorized: async () => { if (!valid) throw new Error("Locked"); } },
    { configured: () => true, call: async () => { valid = false; return "Result"; } }),
    (e: ProviderExecutionError) => e.outcome === "SVANS_POLICY_BLOCK");
});
