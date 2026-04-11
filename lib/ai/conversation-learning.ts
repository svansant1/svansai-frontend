import type { ChatMessage, MemoryItem } from "@/lib/ai/types";

export async function learnFromConversation(
  messages: ChatMessage[],
  response: string
): Promise<MemoryItem[]> {

  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-3);

  const learnedItems: MemoryItem[] = [];

  for (const msg of recentUserMessages) {
    if (msg.content.length > 20) {
      learnedItems.push({
        id: `learn-${Date.now()}-${Math.random()}`,
        summary: msg.content,
        relevance: 0.5,
      });
    }
  }

  if (response.length > 40) {
    learnedItems.push({
      id: `response-${Date.now()}`,
      summary: response,
      relevance: 0.6,
    });
  }

  return learnedItems;
}