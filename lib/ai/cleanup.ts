import type { ChatMessage } from "@/lib/ai/types";

const MAX_HISTORY = 20;
const MAX_CHARS_PER_MESSAGE = 4000;

export function sanitizeMessages(
  messages: unknown[],
  maxHistory = MAX_HISTORY,
): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (m): m is { role?: unknown; content?: unknown } =>
        !!m && typeof m === "object"
    )
    .map(
      (m): ChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content.trim() : "",
      })
    )
    .filter((m) => m.content.length > 0)
    .slice(-maxHistory)
    .map(
      (m): ChatMessage => ({
        role: m.role,
        content: m.content.slice(0, MAX_CHARS_PER_MESSAGE),
      })
    );
}

export function getLatestUserMessage(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((m) => m.role === "user")?.content?.trim() || ""
  );
}

export function getLastAssistantMessage(messages: ChatMessage[]): string {
  return (
    [...messages]
      .reverse()
      .find((m) => m.role === "assistant")
      ?.content?.trim() || ""
  );
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function cleanResponse(text: string): string {
  if (!text) return "";

  let cleaned = text.replace(/\n{3,}/g, "\n\n").trim();

  const paragraphs = cleaned
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const deduped: string[] = [];

  for (const paragraph of paragraphs) {
    if (
      !deduped.some(
        (existing) => normalizeText(existing) === normalizeText(paragraph)
      )
    ) {
      deduped.push(paragraph);
    }
  }

  cleaned = deduped.join("\n\n").trim();
  return cleaned;
}

export function isWeakResponse(text: string): boolean {
  const normalized = normalizeText(text);

  const weakPatterns = [
    "i’m still here with you",
    "im still here with you",
    "even if my live model response is delayed",
    "what are you trying to figure out",
    "what have you tried already",
    "where exactly are you getting stuck",
    "where exactly are you stuck",
    "tell me more so i can help",
    "give me more detail",
  ];

  return weakPatterns.some((pattern) => normalized.includes(pattern));
}

export function isUsableResponse(
  text: string,
  messages: ChatMessage[],
  latestUserMessage: string
): boolean {
  if (!text || !text.trim()) return false;

  const normalized = normalizeText(text);

  // Block obvious weak/generic stall responses
  if (isWeakResponse(text)) return false;

  // Allow short factual answers for short factual questions
  const normalizedQuestion = normalizeText(latestUserMessage);
  const shortQuestion =
    normalizedQuestion.length <= 30 ||
    /^(what is|who is|where is|when is|2\+2|hi|hello|yes|no)/.test(
      normalizedQuestion
    );

  if (shortQuestion && normalized.length >= 1) {
    const lastAssistantMessage =
      [...messages].reverse().find((m) => m.role === "assistant")?.content || "";

    if (
      lastAssistantMessage &&
      normalizeText(lastAssistantMessage) === normalized
    ) {
      return false;
    }

    return true;
  }

  // For normal questions, only reject extremely tiny empty-like outputs
  if (normalized.length < 2) return false;

  const lastAssistantMessage =
    [...messages].reverse().find((m) => m.role === "assistant")?.content || "";

  // Only reject exact duplicate of last assistant answer
  if (
    lastAssistantMessage &&
    normalizeText(lastAssistantMessage) === normalized
  ) {
    return false;
  }

  return true;
}
