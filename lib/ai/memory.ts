import type { ChatMessage, MemoryItem } from "@/lib/ai/types";

export async function getMemoryContext(
  latestUserMessage: string,
  messages: ChatMessage[]
): Promise<MemoryItem[]> {
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-8)
    .map((m, index) => ({
      id: `recent-${index}`,
      summary: m.content,
      relevance: scoreRelevance(latestUserMessage, m.content),
    }))
    .filter((item) => item.relevance > 0.15)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 4);

  const learnedMemory = extractLearnedMemory(messages);

  return [...learnedMemory, ...recentUserMessages]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);
}

export function extractLearnedMemory(messages: ChatMessage[]): MemoryItem[] {
  const learned: MemoryItem[] = [];

  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content.toLowerCase());

  if (userMessages.some((m) => m.includes("step by step"))) {
    learned.push({
      id: "pref-step-by-step",
      summary: "User prefers step-by-step explanations.",
      relevance: 0.95,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("example") ||
        m.includes("show me code") ||
        m.includes("code example")
    )
  ) {
    learned.push({
      id: "pref-examples",
      summary: "User prefers examples and code when helpful.",
      relevance: 0.9,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("direct answer") ||
        m.includes("answer directly") ||
        m.includes("don't be generic") ||
        m.includes("dont be generic")
    )
  ) {
    learned.push({
      id: "pref-direct",
      summary: "User prefers direct answers and dislikes generic fallback responses.",
      relevance: 0.98,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("conversation") ||
        m.includes("conversational") ||
        m.includes("talk like") ||
        m.includes("have conversations")
    )
  ) {
    learned.push({
      id: "pref-conversation",
      summary: "User wants conversational, adaptive responses instead of rigid one-shot answers.",
      relevance: 0.96,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("repetitive") ||
        m.includes("same template") ||
        m.includes("same structure") ||
        m.includes("key points") ||
        m.includes("brief explanation") ||
        m.includes("feel free to adjust")
    )
  ) {
    learned.push({
      id: "pref-no-repetitive-templates",
      summary:
        "User dislikes repetitive response templates; vary the answer shape and avoid canned labels or generic closing questions.",
      relevance: 0.99,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("paragraph form") ||
        m.includes("as a paragraph") ||
        m.includes("discussion paragraph") ||
        m.includes("without bullets") ||
        m.includes("no bullets")
    )
  ) {
    learned.push({
      id: "pref-paragraph-writing-feedback",
      summary:
        "User prefers paragraph form for writing feedback, discussion posts, and replies unless they ask for bullets.",
      relevance: 0.98,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("guide someone") ||
        m.includes("guide me") ||
        m.includes("without giving the answer") ||
        m.includes("don't give the answer") ||
        m.includes("dont give the answer") ||
        m.includes("tutor")
    )
  ) {
    learned.push({
      id: "pref-tutor-guidance",
      summary:
        "User wants tutor-style guidance when requested: give hints, reasoning cues, and one next step before revealing the final answer.",
      relevance: 0.98,
    });
  }

  if (
    userMessages.some(
      (m) =>
        m.includes("SVANS-AI") ||
        m.includes("super ai") ||
        m.includes("make it smarter") ||
        m.includes("make it more developed")
    )
  ) {
    learned.push({
      id: "project-SVANS-AI",
      summary: "User is actively building SVANS-AI and wants it to be smarter, more conversational, and more adaptive.",
      relevance: 0.97,
    });
  }

  return learned;
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
