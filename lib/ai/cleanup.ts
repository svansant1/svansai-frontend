import type { ChatMessage } from "@/lib/ai/types";

const MAX_HISTORY = 20;
const MAX_CHARS_PER_MESSAGE = 4000;
const MIN_RESPONSE_LENGTH = 20;

export function sanitizeMessages(messages: unknown[]): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((m): m is { role?: unknown; content?: unknown } => !!m && typeof m === "object")
    .map(
      (m): ChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content.trim() : "",
      })
    )
    .filter((m) => m.content.length > 0)
    .slice(-MAX_HISTORY)
    .map(
      (m): ChatMessage => ({
        role: m.role,
        content: m.content.slice(0, MAX_CHARS_PER_MESSAGE),
      })
    );
}

export function getLatestUserMessage(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content?.trim() || "";
}

export function getLastAssistantMessage(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "assistant")?.content?.trim() || "";
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
    if (!deduped.some((existing) => normalizeText(existing) === normalizeText(paragraph))) {
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
    "tell me more",
    "give me more detail",
  ];

  return weakPatterns.some((pattern) => normalized.includes(pattern));
}
export function isUsableResponse(
  text: string,
  messages: ChatMessage[],
  latestUserMessage: string
): boolean {
  if (!text) return false;

  if (text.length < 8) return false;

  const lastAssistantMessage =
    [...messages].reverse().find((m) => m.role === "assistant")?.content || "";

  if (
    lastAssistantMessage &&
    normalizeText(lastAssistantMessage) === normalizeText(text)
  ) {
    return false;
  }

  return true;
}