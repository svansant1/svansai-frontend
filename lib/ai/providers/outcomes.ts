/** Public failure categories never include source documents, secrets or vendor response bodies. */
export type ProviderOutcome =
  | "SUCCESS" | "TEMPORARY_FAILURE" | "TIMEOUT" | "RATE_LIMIT"
  | "BILLING_OR_QUOTA_FAILURE" | "INVALID_OR_TRUNCATED_RESPONSE"
  | "PROVIDER_POLICY_REFUSAL" | "SVANS_POLICY_BLOCK"
  | "AUTHENTICATION_OR_CONFIGURATION_FAILURE" | "CANCELLED" | "BUDGET_EXCEEDED";

export class ProviderError extends Error {
  constructor(public readonly outcome: Exclude<ProviderOutcome, "SUCCESS">, message: string, public readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}
export function classifyProviderError(error: unknown): Exclude<ProviderOutcome, "SUCCESS"> {
  if (error instanceof ProviderError) return error.outcome;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/TimeoutError|timed out|timeout/i.test(message)) return "TIMEOUT";
  if (/AbortError|cancelled|canceled/i.test(message)) return "CANCELLED";
  if (/insufficient_quota|billing|credit|quota|\b402\b/i.test(message)) return "BILLING_OR_QUOTA_FAILURE";
  if (/rate.?limit|\b429\b/i.test(message)) return "RATE_LIMIT";
  if (/\b401\b|\b403\b|api.?key|not configured/i.test(message)) return "AUTHENTICATION_OR_CONFIGURATION_FAILURE";
  if (/truncat|output limit|empty provider|invalid.*(?:schema|response)|JSON/i.test(message)) return "INVALID_OR_TRUNCATED_RESPONSE";
  return "TEMPORARY_FAILURE";
}
export function canFailover(outcome: ProviderOutcome): boolean {
  return ["TEMPORARY_FAILURE", "TIMEOUT", "RATE_LIMIT", "BILLING_OR_QUOTA_FAILURE", "INVALID_OR_TRUNCATED_RESPONSE", "AUTHENTICATION_OR_CONFIGURATION_FAILURE"].includes(outcome);
}
/** Inspect machine-readable error codes only; never persist vendor response bodies. */
export async function providerHttpError(response: Response, vendor: string): Promise<ProviderError> {
  let code = "";
  try {
    const body = await response.json();
    code = String(body?.error?.code || body?.error?.type || body?.error?.status || "");
  } catch { /* A proxy may return HTML instead of vendor JSON. */ }
  const outcome = /content_filter|safety|policy|prohibited/i.test(code) ? "PROVIDER_POLICY_REFUSAL"
    : /quota|billing|credit/i.test(code) || response.status === 402 ? "BILLING_OR_QUOTA_FAILURE"
    : response.status === 429 ? "RATE_LIMIT"
    : [401, 403, 404, 400].includes(response.status) ? "AUTHENTICATION_OR_CONFIGURATION_FAILURE"
    : response.status === 408 || response.status === 504 ? "TIMEOUT" : "TEMPORARY_FAILURE";
  return new ProviderError(outcome, `${vendor} request failed (${response.status}; ${outcome}).`, response.status);
}
