import type { ChatMessage, ConversationStateSummary } from "@/lib/ai/types";

export type ResponseCritique = {
  usable: boolean;
  score: number;
  reasons: string[];
};

const CANNED_PHRASES = [
  "it sounds like",
  "i appreciate your feedback",
  "let me know",
  "feel free to",
  "what sets me apart",
  "key features",
  "key aspects",
  "modular design",
  "self-improvement",
  "tailored responses",
  "dive deeper",
  "based on the relevant context i found",
  "key reference point here",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((word) => word.length > 3),
  );
}

function similarity(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap++;
  }

  return overlap / new Set([...left, ...right]).size;
}

function lastAssistant(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.content ?? ""
  );
}

function violatesNoBullets(response: string): boolean {
  return /(^|\n)\s*(?:[-*•]|\d+[.)])\s+/.test(response);
}

export function critiqueResponse(params: {
  response: string;
  latestUserMessage: string;
  messages: ChatMessage[];
  conversationState: ConversationStateSummary;
}): ResponseCritique {
  const reasons: string[] = [];
  const response = params.response.trim();
  const normalized = normalize(response);

  if (response.length < 20) reasons.push("response is too short to be useful");

  const previousAssistant = lastAssistant(params.messages);
  if (previousAssistant && similarity(response, previousAssistant) > 0.52) {
    reasons.push("response is too similar to the previous assistant answer");
  }

  const cannedHits = CANNED_PHRASES.filter((phrase) =>
    normalized.includes(phrase),
  );
  if (cannedHits.length >= 2) {
    reasons.push(`response uses canned phrasing: ${cannedHits.join(", ")}`);
  }

  if (
    params.conversationState.styleDirective === "no_bullets" &&
    violatesNoBullets(response)
  ) {
    reasons.push("response violates the user's no-bullets preference");
  }

  if (
    params.conversationState.isShortFollowUp &&
    /\b(what do you mean|could you clarify|please elaborate|specific topic|specific concerns)\b/i.test(
      response,
    )
  ) {
    reasons.push("response failed to resolve a context-dependent follow-up");
  }

  if (
    /\b(repeats|repetitive|fake|not up to par|top tier|openai|anthropic)\b/i.test(
      params.latestUserMessage,
    ) &&
    /\b(i appreciate|i understand your concern|let me know|specific areas|specific topics|specific styles|your feedback is valuable|i'm here to adapt|i would love to hear)\b/i.test(
      response,
    )
  ) {
    reasons.push(
      "response gives reassurance instead of the requested engineering fix",
    );
  }

  if (
    params.conversationState.taskRoute === "build" &&
    !/\b(implement|file|module|component|api|state|test|verify|build|route|function|step|change|patch|deploy)\b/i.test(
      response,
    )
  ) {
    reasons.push(
      "build-mode response lacks concrete implementation or verification detail",
    );
  }

  const namedModules = [
    "SVANS-AI",
    "Shield",
    "Debugger",
    "Sandbox",
    "VOS",
  ].filter((module) =>
    new RegExp(`\\b${module.replace("-", "[- ]?")}\\b`, "i").test(
      params.latestUserMessage,
    ),
  );
  const missingModules = namedModules.filter(
    (module) =>
      !new RegExp(`\\b${module.replace("-", "[- ]?")}\\b`, "i").test(response),
  );
  if (missingModules.length) {
    reasons.push(
      `response omitted named component(s): ${missingModules.join(", ")}`,
    );
  }

  if (
    /\b(folder-based|workspace|local folder|c drive|vos)\b/i.test(
      params.latestUserMessage,
    ) &&
    /\b(test(?:ed)?|ran|read|mounted|applied|modified|changed)\b/i.test(
      response,
    ) &&
    !/\b(should|would|once|after approval|if|plan|workflow|needs|requires|not pretend|has not been)\b/i.test(
      response,
    )
  ) {
    reasons.push(
      "response appears to claim tool/workspace actions happened without permission or evidence",
    );
  }

  if (
    params.conversationState.taskRoute === "debug" &&
    !/\b(cause|symptom|check|log|error|fix|verify|reproduce|inspect|likely|because)\b/i.test(
      response,
    )
  ) {
    reasons.push(
      "debug-mode response lacks diagnosis, checks, or verification detail",
    );
  }

  if (
    params.conversationState.taskRoute === "analyze" &&
    /\b(how can i assist|specific question or topic|feel free to share|please attach|upload the file|provide the file)\b/i.test(
      response,
    )
  ) {
    reasons.push(
      "analysis response ignored the attached evidence and asked for information already provided",
    );
  }

  const teachingFirst =
    /teaching-first|teach the concept|clue or checkpoint/i.test(
      params.conversationState.modeBehavior,
    );
  const explicitDirect =
    /\b(just (give me|tell me)|direct answer|give me the answer|answer only|no hints)\b/i.test(
      params.latestUserMessage,
    );
  const looksLikeQuiz =
    /\b([a-d][.)]\s|multiple choice|which (answer|option)|quiz)\b/i.test(
      params.latestUserMessage,
    );
  if (
    teachingFirst &&
    !explicitDirect &&
    looksLikeQuiz &&
    /^(correct )?answer\s*:|^[a-d]\s*[—:-]/i.test(response)
  ) {
    reasons.push(
      "teaching-first mode revealed the quiz answer before offering a useful clue or reasoning step",
    );
  }

  const score = Math.max(0, 1 - reasons.length * 0.28);

  return {
    usable: reasons.length === 0,
    score,
    reasons,
  };
}

export function buildCritiqueRetryInstruction(
  critique: ResponseCritique,
): string {
  if (critique.usable) return "";

  return `
Quality check failed:
${critique.reasons.map((reason) => `- ${reason}`).join("\n")}

Rewrite the answer. Fix those issues. Be specific, honor the conversation state, and avoid canned phrasing.
`.trim();
}

export function shouldLearnFromResponse(critique: ResponseCritique): boolean {
  return critique.usable && critique.score >= 0.85;
}
