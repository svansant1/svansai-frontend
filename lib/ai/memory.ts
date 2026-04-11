import type { ChatMessage, MemoryItem } from "@/lib/ai/types";

export async function getMemoryContext(
  latestUserMessage: string,
  messages: ChatMessage[]
): Promise<MemoryItem[]> {
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m, index) => ({
      id: `recent-${index}`,
      summary: m.content,
      relevance: scoreRelevance(latestUserMessage, m.content),
    }))
    .filter((item) => item.relevance > 0.15)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);

  return recentUserMessages;
}

function scoreRelevance(query: string, text: string): number {
  const qWords = tokenize(query);
  const tWords = tokenize(text);

  if (qWords.size === 0 || tWords.size === 0) return 0;

  let overlap = 0;

  for (const word of qWords) {
    if (tWords.has(word)) {
      overlap++;
    }
  }

  return overlap / qWords.size;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2)
  );
}