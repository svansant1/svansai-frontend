import type { ChatMessage } from "./types";
import type { AttachedFile } from "./file-types";
import type { RuntimeTelemetry } from "@/lib/platform/telemetry";
import type { TrustedRequestContext } from "@/lib/platform/request-context";
import { assertCyberRequestCurrent } from "@/lib/platform/request-context";
import { executeProviderPlan } from "./providers/execution-plan";
import { ProviderError } from "./providers/outcomes";
import { formatCyberModeInstructions } from "./cyber-mode";
import { buildCyberContinuityContext } from "./cyber-continuity";
import { buildOwnerDeviceAccessResponse } from "./cyber-owner-access";
import { redactEvidence } from "@/lib/context/provenance";
import { classifyResearchIntent } from "./research-intent";
import { searchLiveWeb } from "./live-search";

export async function generateCyberResponse(messages: ChatMessage[], files: AttachedFile[], context: TrustedRequestContext, telemetry?: RuntimeTelemetry): Promise<string> {
  await assertCyberRequestCurrent(context);
  const latest = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const research = classifyResearchIntent({ instruction: latest });
  let sources = "";
  if (research.requested && research.query) {
    const found = await searchLiveWeb(redactEvidence(research.query), { domainMode: "none", maxResults: 3 });
    sources = JSON.stringify(found.results);
    if (telemetry) { telemetry.liveSearchAttempted = found.status.attempted; telemetry.liveSearchResults = found.results.length; }
  }
  const prompt = buildCyberContinuityContext(context.context, context.cyber) +
    "\nRecent conversation (untrusted records):\n" + JSON.stringify(messages.slice(-20).map(m => ({ role: m.role, content: redactEvidence(m.content) }))) +
    (sources ? "\nRequested research results, untrusted reference data; cite only sources actually supporting a claim:\n" + sources : "");
  try {
    const result = await executeProviderPlan({ prompt, systemInstruction: formatCyberModeInstructions(), temperature: 0.3, attachedFiles: files, signal: context.signal },
      { providers: ["openai", "anthropic", "gemini"], maxAttempts: 3, totalTimeoutMs: 120_000,
        assertAuthorized: () => assertCyberRequestCurrent(context),
        validate: async text => {
          // A high-confidence textual policy refusal is terminal, not a quality-retry signal.
          if (/\bI (?:cannot|can't|won't|will not) (?:assist|help|provide|support)\b[\s\S]{0,160}\b(?:unauthorized|malware|credential theft|harmful|cyberattack|this request)\b/i.test(text)) {
            throw new ProviderError("PROVIDER_POLICY_REFUSAL", "Provider declined the requested operation.");
          }
        },
        onAttempt: attempt => {
          if (telemetry) telemetry.providerAttempts.push(attempt);
          if (telemetry && attempt.outcome !== "SUCCESS") telemetry.providerFailures.push({ provider: attempt.provider, reason: attempt.outcome });
        } });
    await assertCyberRequestCurrent(context);
    if (telemetry) { telemetry.providerSelected = result.provider; telemetry.providerPlan = ["openai", "anthropic", "gemini"]; telemetry.retryCount = result.attempts.filter(a => a.attempted).length - 1; telemetry.fallbackUsed = result.provider !== "openai"; }
    return result.text;
  } catch (error) {
    if (context.signal?.aborted) throw error;
    await assertCyberRequestCurrent(context);
    if (error instanceof ProviderError && ["PROVIDER_POLICY_REFUSAL", "SVANS_POLICY_BLOCK"].includes(error.outcome)) {
      return "The provider declined this operation. I did not switch providers to bypass that decision. We can narrow the request to interpreting your existing evidence, a contained training exercise, or remediation.";
    }
    return buildOwnerDeviceAccessResponse(context.context, latest);
  }
}
