// ─────────────────────────────────────────────────────────────────────────────
// self-analysis.ts
// Silently scores every response SV generates.
// Weak responses get logged to sv_weaknesses.
// This runs after every generateChatResponse call in chat-engine.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import type { QuestionType } from "@/lib/ai/types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const WEAKNESS_THRESHOLD = 0.70; // below this = logged as weak

export type ResponseScore = {
  relevance: number;   // 0-1: did it answer the actual question?
  depth: number;       // 0-1: was it detailed enough?
  tone: number;        // 0-1: was it natural vs robotic?
  fallback: number;    // 0-1: 0 = hit fallback, 1 = real answer
  overall: number;     // weighted average
};

// ─── Score a response heuristically ──────────────────────────────────────────
export function scoreResponse(
  input: string,
  output: string,
  questionType: QuestionType
): ResponseScore {
  const normalized = output.toLowerCase();
  const inputLen = input.trim().length;
  const outputLen = output.trim().length;

  // Fallback detection — these patterns mean SV gave up
  const fallbackPatterns = [
    "tell me more",
    "give me more detail",
    "what are you trying",
    "i can help with that",
    "could you rephrase",
    "i'm still here",
    "let's start here",
    "send it again",
    "what have you tried",
    "here's a direct start based on what you asked",
  ];
  const hitFallback = fallbackPatterns.some((p) => normalized.includes(p));
  const fallback = hitFallback ? 0 : 1;

  // Relevance — did output share vocabulary with input?
  const inputWords = tokenize(input);
  const outputWords = tokenize(output);
  let overlap = 0;
  for (const word of inputWords) {
    if (outputWords.has(word)) overlap++;
  }
  const relevance = inputWords.size > 0
    ? Math.min(1, overlap / Math.max(inputWords.size * 0.3, 1))
    : 0.5;

  // Depth — output length relative to question type expectation
  const expectedMinLength: Record<QuestionType, number> = {
    coding: 200,
    business: 150,
    writing: 100,
    tech_support: 150,
    learning: 120,
    life: 100,
    general: 80,
  };
  const minLen = expectedMinLength[questionType] || 80;
  const depth = Math.min(1, outputLen / minLen);

  // Tone — robotic patterns reduce score
  const roboticPatterns = [
    "as an ai",
    "i am an ai",
    "i don't have feelings",
    "i cannot",
    "i am unable to",
    "certainly!",
    "absolutely!",
    "great question",
    "i'd be happy to",
  ];
  const roboticCount = roboticPatterns.filter((p) => normalized.includes(p)).length;
  const tone = Math.max(0, 1 - roboticCount * 0.25);

  // Weighted overall score
  const overall = (
    relevance * 0.35 +
    depth * 0.25 +
    tone * 0.20 +
    fallback * 0.20
  );

  return { relevance, depth, tone, fallback, overall };
}

// ─── Determine failure reason from score ─────────────────────────────────────
function getFailureReason(score: ResponseScore): string {
  const reasons: string[] = [];
  if (score.fallback === 0) reasons.push("hit fallback instead of real answer");
  if (score.relevance < 0.4) reasons.push("low relevance to input");
  if (score.depth < 0.4) reasons.push("response too short/shallow");
  if (score.tone < 0.5) reasons.push("robotic or generic tone");
  return reasons.join("; ") || "low overall quality";
}

// ─── Log a weak response to Supabase ─────────────────────────────────────────
export async function logWeakResponse(params: {
  questionType: QuestionType;
  input: string;
  output: string;
  score: ResponseScore;
}): Promise<void> {
  try {
    await supabase.from("sv_weaknesses").insert({
      question_type: params.questionType,
      response_quality: params.score.overall,
      failure_reason: getFailureReason(params.score),
      sample_input: params.input.slice(0, 500),
      sample_output: params.output.slice(0, 500),
    });
  } catch (err) {
    console.error("sv_weaknesses insert failed:", err);
  }
}

// ─── Main — call this after every response generation ────────────────────────
export async function analyzeResponse(params: {
  input: string;
  output: string;
  questionType: QuestionType;
}): Promise<ResponseScore> {
  const score = scoreResponse(params.input, params.output, params.questionType);

  // Only log if below threshold — don't clutter with good responses
  if (score.overall < WEAKNESS_THRESHOLD) {
    await logWeakResponse({
      questionType: params.questionType,
      input: params.input,
      output: params.output,
      score,
    });
  }

  return score;
}

// ─── Get weakness summary for improvement engine ──────────────────────────────
export async function getWeaknessSummary(): Promise<{
  total: number;
  byType: Record<string, number>;
  topFailureReasons: string[];
  samples: Array<{ input: string; output: string; reason: string; type: string }>;
}> {
  const { data, error } = await supabase
    .from("sv_weaknesses")
    .select("*")
    .eq("addressed", false)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) {
    return { total: 0, byType: {}, topFailureReasons: [], samples: [] };
  }

  const byType: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};

  for (const row of data) {
    byType[row.question_type] = (byType[row.question_type] || 0) + 1;
    if (row.failure_reason) {
      for (const reason of row.failure_reason.split(";")) {
        const r = reason.trim();
        if (r) reasonCounts[r] = (reasonCounts[r] || 0) + 1;
      }
    }
  }

  const topFailureReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason]) => reason);

  const samples = data.slice(0, 5).map((row) => ({
    input: row.sample_input,
    output: row.sample_output,
    reason: row.failure_reason,
    type: row.question_type,
  }));

  return { total: data.length, byType, topFailureReasons, samples };
}

// ─── Mark weaknesses as addressed after a candidate is generated ──────────────
export async function markWeaknessesAddressed(questionType: string): Promise<void> {
  await supabase
    .from("sv_weaknesses")
    .update({ addressed: true })
    .eq("question_type", questionType)
    .eq("addressed", false);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}
