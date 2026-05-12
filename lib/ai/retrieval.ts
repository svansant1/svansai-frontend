import type { RetrievalItem } from "@/lib/ai/types";
import { supabase } from "@/lib/supabase";
import { getLearnedKnowledge } from "@/lib/ai/knowledge-learning";

type KnowledgeRow = {
  id: string;
  title: string | null;
  source: string | null;
  snippet: string | null;
  tags: string[] | null;
  created_at?: string | null;
};

const SYSTEM_KNOWLEDGE: RetrievalItem[] = [
  {
    id: "sv-architecture",
    title: "SVANSAI Architecture",
    source: "system",
    snippet:
      "SVANSAI uses a chat engine, routing logic, memory, retrieval, response cleanup, question detection, self-analysis, self-monitoring, self-improvement, and provider-based AI responses.",
    score: 0.92,
    tags: ["system", "architecture", "chat-engine", "memory", "retrieval"],
  },
  {
    id: "sv-fallback",
    title: "Fallback Behavior",
    source: "system",
    snippet:
      "Fallback happens when retrieval returns weak context, providers fail, responses are filtered as too generic or too weak, or the question cannot be confidently answered.",
    score: 0.91,
    tags: ["fallback", "responses", "quality", "generic"],
  },
  {
    id: "sv-providers",
    title: "AI Providers",
    source: "system",
    snippet:
      "SVANSAI can use Gemini, OpenAI, and Anthropic providers. Routing can prioritize different models depending on coding, learning, tech support, business, or general questions.",
    score: 0.93,
    tags: ["providers", "gemini", "openai", "anthropic", "routing"],
  },
  {
    id: "sv-self-improvement",
    title: "Self Improvement",
    source: "system",
    snippet:
      "SVANSAI logs weak responses, analyzes failure patterns, creates improvement candidates, and can deploy approved upgrades through owner commands.",
    score: 0.94,
    tags: ["self-analysis", "self-monitor", "self-improve", "upgrade"],
  },
  {
    id: "sv-chat-history",
    title: "Chat Persistence",
    source: "system",
    snippet:
      "SVANSAI stores conversations and conversation_messages in Supabase. The active chat should persist through refresh and saved chats should remain available in the sidebar.",
    score: 0.9,
    tags: ["chat", "history", "sidebar", "supabase", "conversations"],
  },
  {
    id: "sv-owner-mode",
    title: "Owner Commands",
    source: "system",
    snippet:
      "SVANSAI supports owner commands like sv unlock, sv lock, sv analyze, sv improve, sv show candidates, sv deploy, and sv instruct for guided self-improvement.",
    score: 0.9,
    tags: ["owner", "sv unlock", "sv lock", "sv analyze", "sv instruct"],
  },
  {
    id: "sv-shield",
    title: "Shield Module",
    source: "system",
    snippet:
      "Shield is SVANSAI's protection layer. It should detect risky prompts, enforce safe behavior, protect user data, and guide cybersecurity requests toward defensive education.",
    score: 0.92,
    tags: ["shield", "safety", "security", "protection", "cybersecurity"],
  },
  {
    id: "sv-debugger",
    title: "Debugger Module",
    source: "system",
    snippet:
      "Debugger is SVANSAI's diagnosis layer. It should inspect errors, trace failures, explain likely causes, and suggest the smallest practical fix.",
    score: 0.92,
    tags: ["debugger", "debugging", "errors", "diagnosis", "fixes"],
  },
  {
    id: "sv-sandbox",
    title: "Sandbox Module",
    source: "system",
    snippet:
      "Sandbox is SVANSAI's isolated experiment layer. It should support safe simulations, prompt tests, and code-like reasoning without treating experiments as production actions.",
    score: 0.92,
    tags: ["sandbox", "simulation", "testing", "experiments", "isolation"],
  },
  {
    id: "sv-module-collaboration",
    title: "SVANSAI Module Collaboration",
    source: "system",
    snippet:
      "Sandbox runs isolated experiments, Debugger diagnoses failures, Shield enforces safety and risk boundaries, and SVANSAI coordinates the assistant experience across them.",
    score: 0.94,
    tags: ["sandbox", "debugger", "shield", "svansai", "modules"],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function scoreTextMatch(query: string, text: string, tags: string[] = []): number {
  const qTokens = unique(tokenize(query));
  const textBlob = `${text} ${tags.join(" ")}`.toLowerCase();
  const textTokens = new Set(tokenize(textBlob));

  if (qTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of qTokens) {
    if (textTokens.has(token)) overlap++;
  }

  const phraseBoost =
    textBlob.includes(query.toLowerCase().trim()) && query.trim().length > 4 ? 0.25 : 0;

  return Math.min(1, overlap / Math.max(qTokens.length, 1) + phraseBoost);
}

function boostSelfKnowledge(query: string, item: RetrievalItem): number {
  const q = query.toLowerCase();

  const selfTerms = [
    "yourself",
    "your code",
    "how do you work",
    "how you work",
    "what do you use",
    "what models",
    "what provider",
    "fallback",
    "why did you fail",
    "why fallback",
    "svansai",
    "architecture",
    "chat engine",
    "memory",
    "retrieval",
    "self improvement",
    "self-improve",
    "self analysis",
    "self-analysis",
    "owner mode",
    "shield",
    "debugger",
    "sandbox",
  ];

  const isSelfQuery = selfTerms.some((term) => q.includes(term));
  const itemTags = (item.tags ?? []).join(" ").toLowerCase();
  const itemText = `${item.title} ${item.snippet} ${itemTags}`.toLowerCase();

  if (!isSelfQuery) return 0;
  if (item.source !== "system") return 0.05;

  if (
    itemText.includes("architecture") ||
    itemText.includes("provider") ||
    itemText.includes("fallback") ||
    itemText.includes("self") ||
    itemText.includes("owner")
  ) {
    return 0.2;
  }

  return 0.1;
}

function toRetrievalItem(row: KnowledgeRow, query: string): RetrievalItem | null {
  const title = row.title?.trim() || "Knowledge Entry";
  const source = row.source?.trim() || "knowledge";
  const snippet = row.snippet?.trim() || "";
  const tags = row.tags ?? [];

  if (!snippet) return null;

  const score = scoreTextMatch(query, `${title} ${snippet}`, tags);

  return {
    id: row.id,
    title,
    source,
    snippet,
    score,
    tags,
  };
}

function rankItems(query: string, items: RetrievalItem[]): RetrievalItem[] {
  return items
    .map((item) => {
      const baseScore = scoreTextMatch(
        query,
        `${item.title} ${item.snippet}`,
        item.tags ?? []
      );

      let boosted = Math.min(
        1,
        Math.max(item.score ?? 0, baseScore) + boostSelfKnowledge(query, item)
      );

      // Give learned knowledge a small boost for repeated future use
      if (item.source === "learned_knowledge") {
        boosted = Math.min(1, boosted + 0.08);
      }

      return { ...item, score: boosted };
    })
    .sort((a, b) => b.score - a.score);
}

async function getSystemKnowledge(query: string): Promise<RetrievalItem[]> {
  return rankItems(query, SYSTEM_KNOWLEDGE).filter((item) => item.score >= 0.18);
}

async function getSupabaseKnowledge(query: string): Promise<RetrievalItem[]> {
  try {
    const { data, error } = await supabase
      .from("knowledge")
      .select("id,title,source,snippet,tags,created_at")
      .limit(200);

    if (error || !data) {
      return [];
    }

    const mapped = (data as KnowledgeRow[])
      .map((row) => toRetrievalItem(row, query))
      .filter(Boolean) as RetrievalItem[];

    return rankItems(query, mapped).filter((item) => item.score >= 0.18);
  } catch {
    return [];
  }
}

function dedupeItems(items: RetrievalItem[]): RetrievalItem[] {
  const seen = new Set<string>();
  const result: RetrievalItem[] = [];

  for (const item of items) {
    const key = `${item.title.toLowerCase()}|${item.snippet.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

export async function getRetrievedKnowledge(query: string): Promise<RetrievalItem[]> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  const [systemItems, dbItems, learnedItems] = await Promise.all([
    getSystemKnowledge(cleanedQuery),
    getSupabaseKnowledge(cleanedQuery),
    getLearnedKnowledge(cleanedQuery),
  ]);

  const combined = dedupeItems([...learnedItems, ...dbItems, ...systemItems]);
  return rankItems(cleanedQuery, combined).slice(0, 6);
}
