// Authored during implementation. DO NOT RUN until the full code pass is finished.
import test from "node:test";
import assert from "node:assert/strict";
import { executeProviderPlan, ProviderExecutionError } from "../lib/ai/providers/execution-plan";
import { ProviderError } from "../lib/ai/providers/outcomes";
import { resetProviderCooldowns } from "../lib/ai/providers/executor";
const request = { prompt: "Write an answer", systemInstruction: "Be accurate", temperature: 0.2 };
test("availability failure moves to an eligible provider without reusing another vendor's model", async () => {
  resetProviderCooldowns();
  const seen: Array<[string, string | undefined]> = [];
  const result = await executeProviderPlan({ ...request, model: "wrong-vendor-model" }, { providers: ["openai", "anthropic"], models: { openai: "openai-model", anthropic: "anthropic-model" } }, {
    configured: () => true,
    call: async (provider, input) => { seen.push([provider, input.model]); if (provider === "openai") throw new ProviderError("RATE_LIMIT", "Limited"); return "Answer"; },
  });
  assert.equal(result.provider, "anthropic");
  assert.deepEqual(seen, [["openai", "openai-model"], ["anthropic", "anthropic-model"]]);
});
test("a provider refusal stops rather than shopping for another provider", async () => {
  resetProviderCooldowns(); let calls = 0;
  await assert.rejects(executeProviderPlan(request, { providers: ["openai", "anthropic"] }, { configured: () => true, call: async () => { calls++; throw new ProviderError("PROVIDER_POLICY_REFUSAL", "Declined"); } }), (error: ProviderExecutionError) => error.outcome === "PROVIDER_POLICY_REFUSAL");
  assert.equal(calls, 1);
});
test("local-only requests never invoke cloud adapters", async () => {
  let calls = 0;
  await assert.rejects(executeProviderPlan(request, { providers: ["openai"], privacy: "local-only" }, { configured: () => true, call: async () => { calls++; return "wrong"; } }), (error: ProviderExecutionError) => error.outcome === "SVANS_POLICY_BLOCK");
  assert.equal(calls, 0);
});
test("malformed data may fail over but never counts as successful output", async () => {
  resetProviderCooldowns();
  const result = await executeProviderPlan(request, { providers: ["openai", "gemini"], validate: (text) => { JSON.parse(text); } }, { configured: () => true, call: async (provider) => provider === "openai" ? "not JSON" : '{"ok":true}' });
  assert.equal(result.provider, "gemini"); assert.equal(result.attempts[0].outcome, "INVALID_OR_TRUNCATED_RESPONSE");
});
test("budget is enforced before making a paid call", async () => {
  resetProviderCooldowns(); let calls = 0;
  await assert.rejects(executeProviderPlan(request, { providers: ["openai"], maxEstimatedTokens: 1 }, { configured: () => true, call: async () => { calls++; return "no"; } }), (error: ProviderExecutionError) => error.outcome === "BUDGET_EXCEEDED");
  assert.equal(calls, 0);
});
test("an already-cancelled request cannot start a provider call", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(executeProviderPlan({ ...request, signal: controller.signal }, { providers: ["openai"] }, { configured: () => true, call: async () => { calls++; return "no"; } }), (error: ProviderExecutionError) => error.outcome === "CANCELLED");
  assert.equal(calls, 0);
});
