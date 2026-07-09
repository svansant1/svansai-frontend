import type {
  ChatMessage,
  ConversationStateSummary,
  ResponseMode,
} from "@/lib/ai/types";
import type { FollowUpIntent } from "@/lib/ai/router";

export type ConversationState = ConversationStateSummary;

const SHORT_FOLLOW_UPS = new Set([
  "why",
  "how",
  "what first",
  "what part",
  "what next",
  "are you sure",
  "you sure",
  "make it sharper",
  "make it better",
  "real fix",
  "explain",
  "explain that",
  "go deeper",
]);

function compact(text: string, maxLength = 220): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function recentUserMessages(messages: ChatMessage[], count = 8): string[] {
  return messages
    .filter((message) => message.role === "user")
    .slice(-count)
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function lastUserBeforeLatest(messages: ChatMessage[]): string {
  const userMessages = recentUserMessages(messages, 6);
  return userMessages.length > 1 ? userMessages[userMessages.length - 2] : "";
}

function detectPreferences(messages: ChatMessage[]): string[] {
  const joined = normalize(recentUserMessages(messages, 10).join(" "));
  const preferences: string[] = [];

  if (/\b(no bullets|without bullets|do not use bullets|dont use bullets)\b/.test(joined)) {
    preferences.push("Do not use bullets unless the user asks for them.");
  }

  if (/\b(talk like a person|natural|conversational|less fake|feels fake)\b/.test(joined)) {
    preferences.push("Sound natural and specific, not scripted or fake.");
  }

  if (/\b(direct|answer first|straight answer|be concise)\b/.test(joined)) {
    preferences.push("Lead with the answer and avoid unnecessary setup.");
  }

  if (/\b(product pitch|brochure|less like a product|more honest)\b/.test(joined)) {
    preferences.push("Avoid product-pitch language; be honest about tradeoffs.");
  }

  if (/\b(tutor|guide me|hint|teach me)\b/.test(joined)) {
    preferences.push("When tutoring, guide with a clue or checkpoint before revealing the answer.");
  }

  return Array.from(new Set(preferences));
}

function detectAvoidPatterns(messages: ChatMessage[]): string[] {
  const joined = normalize(recentUserMessages(messages, 10).join(" "));
  const avoid = [
    "Avoid generic closers like 'let me know if you need more help.'",
    "Avoid canned openings like 'It sounds like...' when the intent is clear.",
  ];

  if (/\b(repeats|repeating|repetitive|same template|same structure)\b/.test(joined)) {
    avoid.push("Do not reuse the same answer structure, phrases, or product-pitch bullets.");
  }

  if (/\b(key features|key aspects|modular design|self improvement|tailored responses)\b/.test(joined)) {
    avoid.push("Avoid repeating 'key features', 'modular design', 'self-improvement', and 'tailored responses' as default selling points.");
  }

  return avoid;
}

function detectStyleDirective(messages: ChatMessage[]): ConversationState["styleDirective"] {
  const joined = normalize(recentUserMessages(messages, 10).join(" "));

  if (/\b(no bullets|without bullets|do not use bullets|dont use bullets)\b/.test(joined)) {
    return "no_bullets";
  }

  if (/\b(talk like a person|natural|conversational|less fake|feels fake)\b/.test(joined)) {
    return "natural";
  }

  if (/\b(direct|answer first|straight answer|be concise)\b/.test(joined)) {
    return "direct";
  }

  return "structured";
}

function inferGoal(messages: ChatMessage[], responseMode: ResponseMode): string {
  const latest = recentUserMessages(messages, 1)[0] || "";
  const joined = normalize(recentUserMessages(messages, 8).join(" "));

  if (joined.includes("top tier") || joined.includes("openai") || joined.includes("anthropic")) {
    return "Upgrade SVANS-AI toward top-tier conversational quality.";
  }

  if (joined.includes("guide") || responseMode === "guide") {
    return "Guide the user through the problem with a practical next step.";
  }

  if (joined.includes("tutor") || responseMode === "tutor") {
    return "Tutor the user by teaching the concept and checking understanding.";
  }

  if (responseMode === "build") {
    return "Help the user design, implement, or improve the project with concrete next steps.";
  }

  if (responseMode === "debug") {
    return "Diagnose the issue, identify the likely cause, and give the smallest practical fix.";
  }

  if (latest) return compact(latest);

  return "Answer the latest user turn helpfully.";
}

function inferTaskRoute(messages: ChatMessage[], responseMode: ResponseMode): ConversationState["taskRoute"] {
  const joined = normalize(recentUserMessages(messages, 8).join(" "));

  if (responseMode === "build") return "build";
  if (responseMode === "debug") return "debug";

  if (/\b(shield|unsafe|risk|protect|security|guardrail|phishing|malware|bypass|unauthorized)\b/.test(joined)) {
    return "protect";
  }

  if (/\b(debug|error|bug|broken|not working|stack trace|log|fix)\b/.test(joined)) {
    return "debug";
  }

  if (/\b(build|implement|update|feature|code|component|api|deploy|project|platform)\b/.test(joined)) {
    return "build";
  }

  if (/\b(teach|tutor|learn|study|quiz|homework|explain|guide)\b/.test(joined) || responseMode === "guide" || responseMode === "tutor") {
    return "learn";
  }

  if (/\b(file|image|pdf|screenshot|analyze|review|inspect)\b/.test(joined)) {
    return "analyze";
  }

  return "conversation";
}

function requestsDirectAnswer(message: string): boolean {
  return /\b(just (give me|tell me|show me)|direct answer|answer directly|give me the answer|tell me the answer|correct answer|answer only|no hints|skip the explanation)\b/i.test(
    message,
  );
}

function modeBehavior(
  responseMode: ResponseMode,
  taskRoute: ConversationState["taskRoute"],
  latestUserMessage: string,
): string {
  const directOverride = requestsDirectAnswer(latestUserMessage);

  if (directOverride) {
    return "The user explicitly requested a direct answer. Give it immediately, then add only essential explanation.";
  }

  switch (responseMode) {
    case "direct":
      return "Answer first, keep setup short, and only explain what is needed.";
    case "guide":
      return "Show the reasoning path with a useful hint or checkpoint, then help the user reach a practical next move without stalling.";
    case "tutor":
      return "Teach the concept with a clue or checkpoint before giving away answers unless the user asks directly.";
    case "build":
      return "Think like a project helper: propose architecture, implementation steps, code-level changes, and verification.";
    case "debug":
      return "Think like a debugger: isolate symptoms, likely causes, checks, and the smallest fix.";
    default:
      return taskRoute === "learn"
        ? "Use teaching-first assistance: begin with the key concept, clue, or reasoning step and help the user work toward the answer. Reveal it when needed or requested."
        : "Choose the response shape that best fits the task. Complete writing, building, debugging, analysis, and ordinary assistance requests without forcing a lesson.";
  }
}

function providerStrategy(taskRoute: ConversationState["taskRoute"], responseMode: ResponseMode): string {
  if (taskRoute === "debug") {
    return "Prefer precise diagnosis and code/project reasoning. Use critique to reject vague troubleshooting.";
  }

  if (taskRoute === "build") {
    return "Prefer implementation-focused reasoning. Connect ideas to files, modules, tests, and rollout steps.";
  }

  if (taskRoute === "learn" || responseMode === "tutor" || responseMode === "guide") {
    return "Prefer clear teaching flow, continuity, and examples over generic definitions.";
  }

  if (taskRoute === "analyze") {
    return "Use attached files, images, screenshots, and retrieved context as primary evidence.";
  }

  if (taskRoute === "protect") {
    return "Route through Shield-style safety judgment before giving technical details.";
  }

  return "Prefer natural conversation, memory continuity, and low-repetition answers.";
}

function resolveShortFollowUp(
  latestUserMessage: string,
  previousUserMessage: string,
  lastAssistantMessage: string,
  followUpIntent: FollowUpIntent,
): { isShortFollowUp: boolean; resolvedFollowUp: string; unresolvedNeed: string } {
  const normalized = normalize(latestUserMessage);
  const isShort =
    normalized.length <= 45 &&
    (SHORT_FOLLOW_UPS.has(normalized) ||
      followUpIntent !== "none" ||
      /^(why|how|what|which one|are you sure|you sure)\b/.test(normalized));

  if (!isShort || !lastAssistantMessage) {
    return {
      isShortFollowUp: false,
      resolvedFollowUp: latestUserMessage,
      unresolvedNeed: latestUserMessage,
    };
  }

  const anchor = previousUserMessage || "the prior topic";

  if (normalized === "why") {
    return {
      isShortFollowUp: true,
      resolvedFollowUp: `The user asks why the previous recommendation or answer makes sense. Explain the reason in context of: ${anchor}`,
      unresolvedNeed: "Explain the reasoning behind the previous recommendation.",
    };
  }

  if (normalized.includes("are you sure") || normalized.includes("you sure")) {
    return {
      isShortFollowUp: true,
      resolvedFollowUp: `The user is asking for confidence checking. Re-check the previous answer, state whether it still holds, and explain briefly. Prior topic: ${anchor}`,
      unresolvedNeed: "Verify the previous answer without being defensive.",
    };
  }

  if (normalized.includes("sharper") || normalized.includes("better") || normalized.includes("real fix")) {
    return {
      isShortFollowUp: true,
      resolvedFollowUp: `The user wants a more practical, less generic version of the previous answer. Prior topic: ${anchor}`,
      unresolvedNeed: "Give the practical fix instead of generic reassurance.",
    };
  }

  return {
    isShortFollowUp: true,
    resolvedFollowUp: `The user follow-up "${latestUserMessage}" refers to the previous assistant answer. Use that context and answer the implied request. Prior topic: ${anchor}`,
    unresolvedNeed: `Resolve the short follow-up: ${latestUserMessage}`,
  };
}

export function buildConversationState(params: {
  messages: ChatMessage[];
  latestUserMessage: string;
  lastAssistantMessage: string;
  followUpIntent: FollowUpIntent;
  responseMode: ResponseMode;
}): ConversationState {
  const previousUserMessage = lastUserBeforeLatest(params.messages);
  const taskRoute = inferTaskRoute(params.messages, params.responseMode);
  const followUp = resolveShortFollowUp(
    params.latestUserMessage,
    previousUserMessage,
    params.lastAssistantMessage,
    params.followUpIntent,
  );

  return {
    currentTopic: compact(previousUserMessage || params.latestUserMessage || "General conversation"),
    userGoal: inferGoal(params.messages, params.responseMode),
    userPreferences: detectPreferences(params.messages),
    avoidPatterns: detectAvoidPatterns(params.messages),
    unresolvedNeed: followUp.unresolvedNeed,
    isShortFollowUp: followUp.isShortFollowUp,
    resolvedFollowUp: followUp.resolvedFollowUp,
    styleDirective: detectStyleDirective(params.messages),
    taskRoute,
    modeBehavior: modeBehavior(params.responseMode, taskRoute, params.latestUserMessage),
    providerStrategy: providerStrategy(taskRoute, params.responseMode),
  };
}

export function formatConversationState(state: ConversationState): string {
  return `
Conversation state:
- User goal: ${state.userGoal}
- Current topic: ${state.currentTopic}
- Unresolved need: ${state.unresolvedNeed}
- Short follow-up: ${state.isShortFollowUp ? "yes" : "no"}
- Resolved follow-up: ${state.resolvedFollowUp}
- Style directive: ${state.styleDirective}
- Task route: ${state.taskRoute}
- Mode behavior: ${state.modeBehavior}
- Provider strategy: ${state.providerStrategy}
- User preferences: ${state.userPreferences.length ? state.userPreferences.join(" ") : "None detected."}
- Avoid patterns: ${state.avoidPatterns.join(" ")}
`.trim();
}
