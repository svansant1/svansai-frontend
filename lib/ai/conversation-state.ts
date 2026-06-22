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
    return "Upgrade SVANSAI toward top-tier conversational quality.";
  }

  if (joined.includes("guide") || responseMode === "guide") {
    return "Guide the user through the problem with a practical next step.";
  }

  if (joined.includes("tutor") || responseMode === "tutor") {
    return "Tutor the user by teaching the concept and checking understanding.";
  }

  if (latest) return compact(latest);

  return "Answer the latest user turn helpfully.";
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
- User preferences: ${state.userPreferences.length ? state.userPreferences.join(" ") : "None detected."}
- Avoid patterns: ${state.avoidPatterns.join(" ")}
`.trim();
}
