import { callProvider, markProviderFailure, markProviderHealthy, providerCooldownRemaining, type ProviderRequest } from "./executor";
import type { ProviderName } from "./router";
import { canFailover, classifyProviderError, ProviderError, type ProviderOutcome } from "./outcomes";

export type ProviderAttempt = { provider: ProviderName; outcome: ProviderOutcome; durationMs: number; attempted: boolean };
export type ProviderExecutionPolicy = {
  providers: ProviderName[];
  allowedProviders?: ProviderName[];
  privacy?: "cloud" | "local-only";
  models?: Partial<Record<ProviderName, string>>;
  maxAttempts?: number;
  totalTimeoutMs?: number;
  attemptTimeoutMs?: number;
  maxEstimatedTokens?: number;
  assertAuthorized?: () => Promise<void>;
  validate?: (text: string) => void | Promise<void>;
  onAttempt?: (attempt: ProviderAttempt) => void;
};
export type ProviderExecutionResult = { text: string; provider: ProviderName; attempts: ProviderAttempt[]; estimatedTokensReserved: number };
export class ProviderExecutionError extends ProviderError {
  constructor(outcome: Exclude<ProviderOutcome, "SUCCESS">, public readonly attempts: ProviderAttempt[]) {
    super(outcome, `No usable provider result (${outcome}).`);
  }
}
export function isProviderConfigured(provider: ProviderName): boolean {
  const keys = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };
  return Boolean(process.env[keys[provider]]?.trim());
}

/** Bounded availability fallback, never refusal-shopping or a permission escalation. */
export async function executeProviderPlan(
  request: ProviderRequest,
  policy: ProviderExecutionPolicy,
  dependencies: { call?: typeof callProvider; configured?: typeof isProviderConfigured; now?: () => number } = {},
): Promise<ProviderExecutionResult> {
  const now = dependencies.now ?? Date.now;
  const call = dependencies.call ?? callProvider;
  const configured = dependencies.configured ?? isProviderConfigured;
  const attempts: ProviderAttempt[] = [];
  const authorize = async () => {
    if (request.signal?.aborted) throw new ProviderExecutionError("CANCELLED", attempts);
    try { await policy.assertAuthorized?.(); }
    catch { throw new ProviderExecutionError("SVANS_POLICY_BLOCK", attempts); }
  };
  if (policy.privacy === "local-only") throw new ProviderExecutionError("SVANS_POLICY_BLOCK", attempts);
  const configuredAllowlist = process.env.SVANSAI_ALLOWED_PROVIDERS?.split(",").map((p) => p.trim());
  const providers = [...new Set(policy.providers)].filter((p) =>
    (!policy.allowedProviders || policy.allowedProviders.includes(p)) && (!configuredAllowlist || configuredAllowlist.includes(p)));
  const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(value!, max)) : fallback;
  const deadline = now() + finite(policy.totalTimeoutMs, 120_000, 1, 300_000);
  const maxAttempts = Math.floor(finite(policy.maxAttempts, 3, 1, 6));
  const maxTokens = finite(policy.maxEstimatedTokens, 150_000, 1, 1_000_000);
  // This is an estimate, not provider billing or a dollar-spending guarantee.
  const perAttemptTokens = Math.ceil((request.prompt.length + request.systemInstruction.length) / 3) + (request.maxOutputTokens ?? 4096);
  let estimatedTokensReserved = 0;
  let calls = 0;
  let lastOutcome: Exclude<ProviderOutcome, "SUCCESS"> = "AUTHENTICATION_OR_CONFIGURATION_FAILURE";
  const record = (attempt: ProviderAttempt) => { attempts.push(attempt); policy.onAttempt?.(attempt); };
  for (const provider of providers) {
    if (request.signal?.aborted) throw new ProviderExecutionError("CANCELLED", attempts);
    if (calls >= maxAttempts) break;
    if (!configured(provider)) {
      record({ provider, outcome: "AUTHENTICATION_OR_CONFIGURATION_FAILURE", durationMs: 0, attempted: false });
      continue;
    }
    if (providerCooldownRemaining(provider) > 0) {
      record({ provider, outcome: "TEMPORARY_FAILURE", durationMs: 0, attempted: false });
      continue;
    }
    await authorize(); // Live permission checks precede every paid attempt, including fallback.
    const remaining = deadline - now();
    if (remaining <= 0) throw new ProviderExecutionError("TIMEOUT", attempts);
    if (estimatedTokensReserved + perAttemptTokens > maxTokens) throw new ProviderExecutionError("BUDGET_EXCEEDED", attempts);
    estimatedTokensReserved += perAttemptTokens;
    calls += 1;
    const started = now();
    try {
      // Vendor-specific model names must never leak into another vendor's request.
      const text = await call(provider, { ...request, model: policy.models?.[provider] }, Math.min(remaining, finite(policy.attemptTimeoutMs, 60_000, 1, 180_000)));
      await authorize();
      if (!text?.trim()) throw new ProviderError("INVALID_OR_TRUNCATED_RESPONSE", "Empty provider response.");
      try { await policy.validate?.(text); } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError("INVALID_OR_TRUNCATED_RESPONSE", "Provider output failed validation.");
      }
      await authorize();
      markProviderHealthy(provider);
      record({ provider, outcome: "SUCCESS", durationMs: now() - started, attempted: true });
      return { text, provider, attempts, estimatedTokensReserved };
    } catch (error) {
      lastOutcome = classifyProviderError(error);
      record({ provider, outcome: lastOutcome, durationMs: now() - started, attempted: true });
      markProviderFailure(provider, error);
      if (!canFailover(lastOutcome)) throw new ProviderExecutionError(lastOutcome, attempts);
    }
  }
  throw new ProviderExecutionError(lastOutcome, attempts);
}
