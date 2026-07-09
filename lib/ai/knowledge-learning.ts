import { supabase } from "@/lib/supabase";
import type { ChatMessage, QuestionType, RetrievalItem } from "@/lib/ai/types";

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
      .eq("verified", true)
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

function hasSensitiveData(text: string): boolean {
  const lower = text.toLowerCase();

  return (
    /\b(api[_ -]?key|secret|password|passwd|token|bearer|private[_ -]?key|supabase[_ -]?key|anthropic[_ -]?key|openai[_ -]?key)\b/i.test(text) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(text) ||
    /\b(?:\d[ -]*?){13,16}\b/.test(text) ||
    lower.includes("-----begin") ||
    lower.includes("-----end")
  );
}

function compactText(text: string, maxLength: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildLearnedTitle(prefix: string, value: string): string {
  const compact = compactText(value, 76);
  return compact.length >= 76 ? `${prefix}: ${compact}...` : `${prefix}: ${compact}`;
}

function extractPreferenceLesson(question: string): string | null {
  const lower = question.toLowerCase();
  const preferenceSignals = [
    "i want",
    "i need",
    "make sure",
    "don't",
    "dont",
    "i like",
    "i don't like",
    "i dont like",
    "it should",
    "it needs",
    "can you make",
    "stop",
    "avoid",
    "don't always",
    "dont always",
    "too repetitive",
    "repetitive",
    "paragraph form",
    "without bullets",
    "no bullets",
    "guide me",
    "guide someone",
    "without giving the answer",
    "don't give the answer",
    "dont give the answer",
  ];

  if (!preferenceSignals.some((signal) => lower.includes(signal))) return null;

  const styleLessons: string[] = [];

  if (/\b(repetitive|same structure|same template|template)\b/i.test(question)) {
    styleLessons.push("avoid repetitive templates and vary the response shape");
  }

  if (/\b(paragraph form|discussion paragraph|as a paragraph|without bullets|no bullets)\b/i.test(question)) {
    styleLessons.push("use paragraph form for writing feedback and discussion posts unless the user asks for bullets");
  }

  if (/\b(key points|brief explanation|feel free|here'?s|what are your next steps|how do you feel)\b/i.test(question)) {
    styleLessons.push("avoid canned labels and generic closing questions");
  }

  if (/\b(guide|hint|tutor|without giving the answer|don't give the answer|dont give the answer)\b/i.test(question)) {
    styleLessons.push("when tutoring, guide the user with hints and reasoning instead of immediately revealing the final answer");
  }

  if (styleLessons.length > 0) {
    return `User response-style preference: ${styleLessons.join("; ")}. Original user wording: ${compactText(question, 500)}`;
  }

  return `User preference or requirement: ${compactText(question, 700)}`;
}

function extractCorrectionLesson(
  question: string,
  previousAssistantMessage?: string,
): string | null {
  if (!/\b(wrong|incorrect|nah|nope|not right|look deeper|double check|recheck)\b/i.test(question)) {
    return null;
  }

  const previous = previousAssistantMessage
    ? ` Previous assistant answer to re-check: ${compactText(previousAssistantMessage, 500)}`
    : "";

  return `Correction behavior learned: when the user challenges an answer, re-check the previous question and answer instead of blindly switching. User challenge: ${compactText(question, 500)}${previous}`;
}

function extractProjectLesson(question: string, answer: string): string | null {
  if (!/\b(svansai|svans-ai|shield|debugger|sandbox|vansant|mascot|chat|sidebar|supabase|render|github)\b/i.test(`${question} ${answer}`)) {
    return null;
  }

  return `Project context learned: ${compactText(question, 520)} Answer pattern that helped: ${compactText(answer, 700)}`;
}

function extractReusableAnswerLesson(question: string, answer: string): string | null {
  const combined = `${question}\n${answer}`;

  if (
    !/\b(correct answer|quiz|multiple choice|osi|switch|network|code|error|bug|fix|architecture|flow|build first|self-check|brain|memory|retrieval)\b/i.test(
      combined,
    )
  ) {
    return null;
  }

  if (
    /\b(i appreciate your feedback|let me know|feel free|it sounds like|specific topics or styles)\b/i.test(
      answer,
    )
  ) {
    return null;
  }

  return `Reusable answer pattern learned. User need: ${compactText(question, 650)} Helpful response: ${compactText(answer, 900)}`;
}

async function upsertLearnedKnowledge(params: {
  title: string;
  category: QuestionType;
  summary: string;
  confidence: number;
  tags: string[];
  source: string;
  learnedFrom: string;
}): Promise<void> {
  const { data } = await supabase
    .from("learned_knowledge")
    .select("id,usage_count")
    .eq("title", params.title)
    .eq("category", params.category)
    .limit(1);

  if ((data?.length ?? 0) > 0) {
    const existing = data![0] as { id: string; usage_count?: number | null };

    await supabase
      .from("learned_knowledge")
      .update({
        summary: params.summary,
        source: params.source,
        confidence: params.confidence,
        tags: params.tags,
        learned_from: params.learnedFrom,
        usage_count: (existing.usage_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return;
  }

  await supabase.from("learned_knowledge").insert({
    title: params.title,
    category: params.category,
    summary: params.summary,
    source: params.source,
    confidence: params.confidence,
    tags: params.tags,
    learned_from: params.learnedFrom,
    usage_count: 1,
    verified: false,
  });
}

export async function storeConversationLearning(params: {
  messages: ChatMessage[];
  question: string;
  answer: string;
  questionType: QuestionType;
  conversationIntent: string;
  responseStyle: string;
  source?: string;
}): Promise<void> {
  const question = params.question.trim();
  const answer = params.answer.trim();

  if (question.length < 4 || answer.length < 20) return;
  if (hasSensitiveData(`${question}\n${answer}`)) return;

  const previousAssistantMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.content;

  const baseTags = Array.from(
    new Set([
      "conversation-learned",
      params.questionType,
      params.conversationIntent,
      params.responseStyle,
    ].filter(Boolean)),
  );

  const lessons = [
    {
      title: buildLearnedTitle("Preference", question),
      summary: extractPreferenceLesson(question),
      confidence: 0.78,
      tags: [...baseTags, "preference"],
    },
    {
      title: buildLearnedTitle("Correction", question),
      summary: extractCorrectionLesson(question, previousAssistantMessage),
      confidence: 0.8,
      tags: [...baseTags, "correction"],
    },
    {
      title: buildLearnedTitle("Project context", question),
      summary: extractProjectLesson(question, answer),
      confidence: 0.74,
      tags: [...baseTags, "project-context"],
    },
    {
      title: buildLearnedTitle("Reusable pattern", question),
      summary: extractReusableAnswerLesson(question, answer),
      confidence: 0.7,
      tags: [...baseTags, "reusable-pattern"],
    },
  ].filter((lesson): lesson is {
    title: string;
    summary: string;
    confidence: number;
    tags: string[];
  } => Boolean(lesson.summary));

  try {
    await Promise.all(
      lessons.slice(0, 4).map((lesson) =>
        upsertLearnedKnowledge({
          title: lesson.title,
          category: params.questionType,
          summary: lesson.summary,
          confidence: lesson.confidence,
          tags: lesson.tags,
          source: params.source ?? "conversation-learning",
          learnedFrom: "conversation",
        }),
      ),
    );
  } catch {
    // Learning should never break the chat response.
  }
}
