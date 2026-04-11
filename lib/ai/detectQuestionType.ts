// ─────────────────────────────────────────────────────────────────────────────
// detectQuestionType.ts  —  drop-in replacement for the keyword-based classifier
// ─────────────────────────────────────────────────────────────────────────────
//
// HOW IT WORKS:
//   1. A fast heuristic pre-screen catches the most obvious cases with zero
//      latency (no API call). Clear-cut signals like fenced code blocks,
//      stack traces, or an explicit "write me an email" still route instantly.
//
//   2. Anything ambiguous goes to a lightweight Gemini Flash call. The model
//      receives ONLY the latest message (not the full history) so the call is
//      cheap and fast (~100–200 ms in practice).
//
//   3. The LLM returns a single JSON token. A strict schema + fallback to
//      "general" makes it resilient — a bad response never crashes the route.
//
// INTEGRATION:
//   Replace the old synchronous `detectQuestionType(question)` call with:
//
//     const questionType = await detectQuestionType(latestUserMessage);
//
//   Make sure generateBestResponse is also awaited (it already is).
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type QuestionType =
  | "coding"
  | "business"
  | "writing"
  | "tech_support"
  | "learning"
  | "life"
  | "general";

const ALL_TYPES: QuestionType[] = [
  "coding",
  "business",
  "writing",
  "tech_support",
  "learning",
  "life",
  "general",
];

// ─── 1. Fast heuristic pre-screen ────────────────────────────────────────────

/**
 * Returns a QuestionType immediately for high-confidence cases,
 * or null if the input is ambiguous and needs the LLM.
 */
function heuristicClassify(question: string): QuestionType | null {
  const q = question.trim();

  // Fenced code block or inline backtick code → always coding
  if (/```[\s\S]*```/.test(q) || /`[^`]+`/.test(q)) return "coding";

  // Stack traces / common error patterns
  if (
    /\b(traceback|NullPointerException|TypeError|SyntaxError|segfault|undefined is not|cannot read prop)\b/i.test(q)
  )
    return "coding";

  // Explicit writing requests with a clear deliverable noun
  if (
    /\b(write|draft|rewrite|proofread|edit)\b.{0,40}\b(email|essay|cover letter|resume|speech|post|paragraph|bio|letter|report)\b/i.test(
      q
    )
  )
    return "writing";

  // Hardware / OS crash signals
  if (
    /\b(blue ?screen|bsod|kernel panic|wont boot|won't boot|black screen|no display|bricked)\b/i.test(
      q
    )
  )
    return "tech_support";

  // Life / personal decision signals
  if (
    /\b(should i quit|should i leave|life advice|feeling (lost|stuck|burnt out|overwhelmed)|career change|relationship advice)\b/i.test(
      q
    )
  )
    return "life";

  // Ambiguous — let the LLM decide
  return null;
}

// ─── 2. LLM-based classifier ─────────────────────────────────────────────────

const CLASSIFIER_SYSTEM = `
You are a question classifier for an AI assistant called SVANSAI.

Your ONLY job is to read the user's message and return a single JSON object
with one field: "type". The value must be exactly one of these strings:

  "coding"       — writing, debugging, or understanding code / software / APIs / databases
  "business"     — marketing, startups, sales, pricing, branding, strategy, products
  "writing"      — composing, editing, or improving human-language content (emails, essays, posts, etc.)
  "tech_support" — troubleshooting hardware, OS, network, or consumer devices
  "learning"     — understanding a concept, homework help, explanations, academic subjects
  "life"         — personal decisions, career direction, relationships, motivation, mental state
  "general"      — anything that doesn't clearly fit the above

Classification rules:
- "write a python function" → coding  (it is code, not prose writing)
- "what is a product-market fit" → business  (not learning)
- "explain recursion to me" → learning  (not coding — the goal is understanding, not implementation)
- "help me plan my startup's go-to-market" → business
- "my MacBook won't connect to WiFi" → tech_support
- "rewrite this paragraph" → writing
- "should I take the job offer?" → life
- Mixed signals: pick the PRIMARY intent.

Return ONLY valid JSON. No markdown. No explanation. Example:
{"type":"coding"}
`.trim();

async function llmClassify(question: string): Promise<QuestionType> {
  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: CLASSIFIER_SYSTEM,
        temperature: 0,    // deterministic — we want a label, not creativity
        topP: 1,
        maxOutputTokens: 20,
      },
      contents: [{ role: "user", parts: [{ text: question }] }],
    });

    const raw = (result?.text ?? "").trim();

    // Strip accidental markdown fences
    const cleaned = raw.replace(/```json|```/gi, "").trim();

    const parsed = JSON.parse(cleaned) as { type?: string };

    if (parsed?.type && (ALL_TYPES as string[]).includes(parsed.type)) {
      return parsed.type as QuestionType;
    }
  } catch {
    // Swallow — fall through to default
  }

  return "general";
}

// ─── 3. Public API ───────────────────────────────────────────────────────────

/**
 * Classifies a user message into one of the QuestionType categories.
 *
 * - Synchronously returns for obvious cases (zero extra latency).
 * - Falls back to a cheap LLM call for anything ambiguous.
 * - Never throws — worst case returns "general".
 *
 * @param question  The latest user message (plain text, already trimmed).
 */
export async function detectQuestionType(
  question: string
): Promise<QuestionType> {
  if (!question || question.trim().length === 0) return "general";

  // Fast path — no API call needed
  const heuristic = heuristicClassify(question);
  if (heuristic !== null) return heuristic;

  // Slow path — LLM classification
  return llmClassify(question);
}
