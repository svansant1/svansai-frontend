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
import { appendContextEvents } from "@/lib/context/store";
import { buildContextView } from "@/lib/context/compaction";
import { readCyberProgress } from "@/lib/context/cyber-progress";
import { CYBER_REPLY_CONTRACT, parseCyberReply, renderCyberReply, buildCyberProgressEvents, type CyberReply } from "./cyber-response-contract";

export type CyberResponseDependencies = {
  assertCurrent: typeof assertCyberRequestCurrent; execute: typeof executeProviderPlan;
  save: typeof appendContextEvents; search: typeof searchLiveWeb;
};
const defaults: CyberResponseDependencies = { assertCurrent: assertCyberRequestCurrent, execute: executeProviderPlan, save: appendContextEvents, search: searchLiveWeb };

export async function generateCyberResponse(messages: ChatMessage[], files: AttachedFile[], context: TrustedRequestContext, telemetry?: RuntimeTelemetry, deps: CyberResponseDependencies = defaults): Promise<string> {
  await deps.assertCurrent(context);
  const latest = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const research = classifyResearchIntent({ instruction: latest });
  let sources = "";
  if (research.requested && research.query) {
    const found = await deps.search(redactEvidence(research.query), { domainMode: "none", maxResults: 3 });
    sources = JSON.stringify(found.results);
    if (telemetry) { telemetry.liveSearchAttempted = found.status.attempted; telemetry.liveSearchResults = found.results.length; }
  }
  const prompt = buildCyberContinuityContext(context.context, context.cyber) +
    "\nSaved suggested steps and evidence-linked assessments (inference, not permissions or verified execution):\n" + JSON.stringify(readCyberProgress(context.context)) +
    "\nRecent conversation (untrusted records):\n" + JSON.stringify(messages.slice(-20).map(m => ({ role: m.role, content: redactEvidence(m.content) }))) +
    (sources ? "\nRequested research results, untrusted reference data; cite only sources actually supporting a claim:\n" + sources : "");
  let reply: CyberReply;
  try {
    const result = await deps.execute({ prompt, systemInstruction: formatCyberModeInstructions() + "\n\n" + CYBER_REPLY_CONTRACT, temperature: 0.3, attachedFiles: files, signal: context.signal },
      { providers: ["openai", "anthropic", "gemini"], maxAttempts: 3, totalTimeoutMs: 120_000,
        assertAuthorized: () => deps.assertCurrent(context),
        validate: async text => {
          // A high-confidence textual policy refusal is terminal, not a quality-retry signal.
          if (/\bI (?:cannot|can't|won't|will not) (?:assist|help|provide|support)\b[\s\S]{0,160}\b(?:unauthorized|malware|credential theft|harmful|cyberattack|this request)\b/i.test(text)) {
            throw new ProviderError("PROVIDER_POLICY_REFUSAL", "Provider declined the requested operation.");
          }
          parseCyberReply(text, context.context);
        },
        onAttempt: attempt => {
          if (telemetry) telemetry.providerAttempts.push(attempt);
          if (telemetry && attempt.outcome !== "SUCCESS") telemetry.providerFailures.push({ provider: attempt.provider, reason: attempt.outcome });
        } });
    await deps.assertCurrent(context);
    if (telemetry) { telemetry.providerSelected = result.provider; telemetry.providerPlan = ["openai", "anthropic", "gemini"]; telemetry.retryCount = result.attempts.filter(a => a.attempted).length - 1; telemetry.fallbackUsed = result.provider !== "openai"; }
    reply = parseCyberReply(result.text, context.context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    await deps.assertCurrent(context);
    if (error instanceof ProviderError && ["PROVIDER_POLICY_REFUSAL", "SVANS_POLICY_BLOCK"].includes(error.outcome)) {
      return "The provider declined this operation. I did not switch providers to bypass that decision. We can narrow the request to interpreting your existing evidence, a contained training exercise, or remediation.";
    }
    return buildOwnerDeviceAccessResponse(context.context, latest);
  }
  const events = buildCyberProgressEvents(reply, context.context);
  if (events.length && !context.progressReadOnly) {
    await deps.assertCurrent(context);
    const revision = context.context.revision;
    if (context.expectedContextRevision !== revision) throw new Error("Progress requires a pinned investigation revision.");
    let release!: () => void;
    context.progressWrite = new Promise<void>(resolve => { release = resolve; });
    try {
      const saved = await deps.save(context.scope, revision, events);
      if (saved.revision !== revision + events.length || Object.keys(context.scope).some(key => saved.scope[key as keyof typeof saved.scope] !== context.scope[key as keyof typeof context.scope]) ||
        events.some(event => !saved.events.some(e => e.id === event.id))) throw new Error("Investigation changed while progress was being saved. Reload before continuing.");
      context.context = buildContextView(saved);
      context.expectedContextRevision = saved.revision;
    } finally {
      context.progressWrite = undefined;
      release();
    }
  }
  await deps.assertCurrent(context);
  let rendered = renderCyberReply(reply);
  if (context.progressReadOnly && events.length) rendered += "\n\nProgress changes were not saved by this background task; continue in the conversation to record them against its current evidence.";
  if (context.context.omittedEvents) rendered += "\n\nSome older evidence is outside the active context. I cannot guarantee complete step history; reload or export saved evidence if an earlier result is needed.";
  return rendered;
}
