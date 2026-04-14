import { supabase } from "@/lib/supabase";
import type { QuestionType, RetrievalItem } from "@/lib/ai/types";

type LearnedKnowledgeRow = {
  id: string;
  title: string | null;
  category: string | null;
  summary: string;
  source: string | null;
  confidence: number | null;
  tags: string[] | null;
  usage_count: number | null;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function scoreMatch(query: string, text: string, tags: string[] = []): number {
  const q = Array.from(new Set(tokenize(query)));
  if (q.length === 0) return 0;

  const haystack = new Set(tokenize(`${text} ${tags.join(" ")}`));
  let overlap = 0;

  for (const token of q) {
    if (haystack.has(token)) overlap++;
  }

  const phraseBoost =
    text.toLowerCase().includes(query.toLowerCase().trim()) && query.trim().length > 4
      ? 0.2
      : 0;

  return Math.min(1, overlap / q.length + phraseBoost);
}

export async function getLearnedKnowledge(query: string): Promise<RetrievalItem[]> {
  try {
    const { data, error } = await supabase
      .from("learned_knowledge")
      .select("id,title,category,summary,source,confidence,tags,usage_count")
      .order("updated_at", { ascending: false })
      .limit(250);

    if (error || !data) return [];

    const mapped = (data as LearnedKnowledgeRow[])
      .map((row) => {
        const title = row.title?.trim() || "Learned Knowledge";
        const snippet = row.summary?.trim() || "";
        const tags = row.tags ?? [];
        const confidence = typeof row.confidence === "number" ? row.confidence : 0.5;
        const score = Math.min(
          1,
          scoreMatch(query, `${title} ${snippet}`, tags) * 0.75 + confidence * 0.25
        );

        if (!snippet) return null;

        return {
          id: row.id,
          title,
          source: row.source?.trim() || "learned_knowledge",
          snippet,
          score,
          tags,
        };
      })
      .filter(Boolean) as RetrievalItem[];

    return mapped
      .filter((item) => item.score >= 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function queueLearningNeed(params: {
  question: string;
  questionType: QuestionType;
  reason: string;
  priority?: number;
  source?: string;
}): Promise<void> {
  const question = params.question.trim();
  if (!question) return;

  try {
    const { data } = await supabase
      .from("learning_queue")
      .select("id,status")
      .eq("question", question)
      .in("status", ["pending", "learning"])
      .limit(1);

    if ((data?.length ?? 0) > 0) return;

    await supabase.from("learning_queue").insert({
      question,
      category: params.questionType,
      reason: params.reason,
      priority: params.priority ?? 1,
      source: params.source ?? "runtime",
    });
  } catch {
    // Never break chat flow if the queue insert fails.
  }
}

export async function storeLearnedFallback(params: {
  question: string;
  answer: string;
  questionType: QuestionType;
  source: string;
  confidence?: number;
  tags?: string[];
}): Promise<void> {
  const question = params.question.trim();
  const answer = params.answer.trim();

  if (!question || !answer) return;

  const title = question.length > 72 ? `${question.slice(0, 72)}...` : question;
  const summary = answer.slice(0, 3000);
  const confidence = params.confidence ?? 0.72;

  try {
    const { data } = await supabase
      .from("learned_knowledge")
      .select("id,usage_count")
      .eq("title", title)
      .eq("category", params.questionType)
      .limit(1);

    if ((data?.length ?? 0) > 0) {
      const existing = data![0] as { id: string; usage_count?: number | null };

      await supabase
        .from("learned_knowledge")
        .update({
          summary,
          source: params.source,
          confidence,
          tags: params.tags ?? [],
          learned_from: "fallback",
          usage_count: (existing.usage_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("learned_knowledge").insert({
        title,
        category: params.questionType,
        summary,
        source: params.source,
        confidence,
        tags: params.tags ?? [],
        learned_from: "fallback",
        usage_count: 1,
        verified: false,
      });
    }

    await supabase
      .from("learning_queue")
      .update({
        status: "learned",
        learned_at: new Date().toISOString(),
      })
      .eq("question", question);
  } catch {
    // Never break chat flow if saving learned knowledge fails.
  }
}
