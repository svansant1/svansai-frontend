import type { RetrievalItem } from "@/lib/ai/types";

const SYSTEM_KNOWLEDGE: RetrievalItem[] = [
  {
    id: "sv-architecture",
    title: "SVANSAI Architecture",
    source: "system",
    snippet:
      "SVANSAI uses multi-provider routing with OpenAI, Gemini, and Anthropic. It includes self-analysis, self-improvement, retrieval, and memory systems.",
    score: 0.9,
    tags: ["system", "architecture"],
  },
  {
    id: "sv-fallback",
    title: "Fallback Behavior",
    source: "system",
    snippet:
      "Fallback occurs when providers fail, retrieval returns empty, or response scoring determines output quality is too low.",
    score: 0.9,
    tags: ["fallback", "logic"],
  },
  {
    id: "sv-providers",
    title: "AI Providers",
    source: "system",
    snippet:
      "SVANSAI uses OpenAI, Gemini, and Anthropic. Router selects provider based on question type.",
    score: 0.9,
    tags: ["providers", "ai"],
  },
  {
    id: "sv-learning",
    title: "Self Learning System",
    source: "system",
    snippet:
      "SVANSAI logs weak responses, analyzes failures, generates improvements, and deploys updates with owner approval.",
    score: 0.9,
    tags: ["learning", "self-improve"],
  },
];

export async function getRetrievedKnowledge(
  query: string
): Promise<RetrievalItem[]> {
  const normalized = query.toLowerCase();

  const results = SYSTEM_KNOWLEDGE.filter((item) =>
    item.snippet.toLowerCase().includes(normalized) ||
    item.title.toLowerCase().includes(normalized) ||
    item.tags?.some((tag) => normalized.includes(tag))
  );

  return results.slice(0, 5);
}