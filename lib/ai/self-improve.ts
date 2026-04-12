// ─────────────────────────────────────────────────────────────────────────────
// self-improve.ts
// Reads the weakness summary, reads the relevant source file,
// asks Gemini to generate an improved version, stores as a candidate.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { getWeaknessSummary, markWeaknessesAddressed } from "./self-analysis";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Minimum weaknesses of same type before generating a candidate
const MIN_WEAKNESSES_TO_TRIGGER = 8;

// Confidence threshold — below this, don't surface to owner
const MIN_CONFIDENCE = 0.72;

// Files SV is allowed to improve — locked files are excluded
const IMPROVABLE_FILES: Record<string, string> = {
  coding: "lib/ai/prompt.ts",
  business: "lib/ai/prompt.ts",
  writing: "lib/ai/prompt.ts",
  tech_support: "lib/ai/prompt.ts",
  learning: "lib/ai/prompt.ts",
  life: "lib/ai/prompt.ts",
  general: "lib/ai/router.ts",
  fallback: "lib/ai/chat-engine.ts",
};

// Files that can NEVER be modified by the improvement engine
const LOCKED_FILES = [
  "lib/ai/deployer.ts",
  "lib/ai/self-monitor.ts",
  "lib/ai/self-improve.ts",
  "lib/ai/self-analysis.ts",
  "app/api/sv/deploy/route.ts",
  "app/api/sv/monitor/route.ts",
];

// ─── Read a source file from disk ─────────────────────────────────────────────
function readSourceFile(filePath: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), filePath);
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

// ─── Generate a simple line-level diff ───────────────────────────────────────
function generateDiff(original: string, improved: string): string {
  const origLines = original.split("\n");
  const newLines = improved.split("\n");
  const diff: string[] = [];

  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const next = newLines[i];
    if (orig === undefined) {
      diff.push(`+ ${next}`);
    } else if (next === undefined) {
      diff.push(`- ${orig}`);
    } else if (orig !== next) {
      diff.push(`- ${orig}`);
      diff.push(`+ ${next}`);
    }
  }

  return diff.slice(0, 100).join("\n"); // cap diff length
}

// ─── Ask Gemini to improve a file based on weakness context ──────────────────
async function generateImprovedCode(params: {
  filePath: string;
  originalCode: string;
  weaknessSummary: string;
  failureExamples: string;
}): Promise<{ improvedCode: string; reason: string; confidence: number } | null> {
  const prompt = `
You are analyzing SVANSAI's source code to improve its response quality.

FILE: ${params.filePath}

CURRENT CODE:
\`\`\`typescript
${params.originalCode}
\`\`\`

WEAKNESS ANALYSIS:
${params.weaknessSummary}

FAILURE EXAMPLES:
${params.failureExamples}

Your task:
1. Identify the specific section of code responsible for the weaknesses above.
2. Rewrite ONLY that section to fix the problem.
3. Keep all other code identical.
4. Do not add imports that don't exist.
5. Do not change function signatures.
6. Do not break anything that currently works.

Return ONLY a JSON object with this exact structure:
{
  "improvedCode": "the complete file with your fix applied",
  "reason": "one sentence explaining what you changed and why",
  "confidence": 0.85
}

The confidence should be between 0 and 1 based on how certain you are this fix will improve response quality.
Return ONLY the JSON. No markdown. No explanation outside the JSON.
`.trim();

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: { temperature: 0.2, topP: 0.9 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = (result?.text ?? "").trim().replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(raw) as {
      improvedCode?: string;
      reason?: string;
      confidence?: number;
    };

    if (!parsed.improvedCode || !parsed.reason || parsed.confidence === undefined) {
      return null;
    }

    return {
      improvedCode: parsed.improvedCode,
      reason: parsed.reason,
      confidence: parsed.confidence,
    };
  } catch (err) {
    console.error("self-improve generateContent failed:", err);
    return null;
  }
}

// ─── Check if a candidate already exists for this file ───────────────────────
async function hasPendingCandidate(filePath: string): Promise<boolean> {
  const { data } = await supabase
    .from("sv_candidates")
    .select("id")
    .eq("file_path", filePath)
    .eq("status", "pending")
    .limit(1);

  return (data?.length ?? 0) > 0;
}

// ─── Store a candidate in Supabase ───────────────────────────────────────────
async function storeCandidate(params: {
  filePath: string;
  originalCode: string;
  improvedCode: string;
  diff: string;
  reason: string;
  confidence: number;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("sv_candidates")
    .insert({
      file_path: params.filePath,
      original_code: params.originalCode,
      improved_code: params.improvedCode,
      diff: params.diff,
      reason: params.reason,
      confidence: params.confidence,
      status: "pending",
      owner_notified: false,
    })
    .select("id")
    .single();

  if (error) {
    console.error("storeCandidate failed:", error);
    return null;
  }

  return data?.id ?? null;
}

// ─── Main — run the full improvement cycle ────────────────────────────────────
export async function runImprovementCycle(): Promise<{
  candidatesGenerated: number;
  skipped: string[];
}> {
  const summary = await getWeaknessSummary();
  const candidatesGenerated: number[] = [];
  const skipped: string[] = [];

  if (summary.total === 0) {
    return { candidatesGenerated: 0, skipped: ["no weaknesses found"] };
  }

  // Find question types with enough failures to warrant a fix
  const eligibleTypes = Object.entries(summary.byType)
    .filter(([, count]) => count >= MIN_WEAKNESSES_TO_TRIGGER)
    .sort((a, b) => b[1] - a[1]);

  for (const [questionType, count] of eligibleTypes) {
    const targetFile = IMPROVABLE_FILES[questionType];
    if (!targetFile) { skipped.push(`${questionType}: no mapped file`); continue; }
    if (LOCKED_FILES.includes(targetFile)) { skipped.push(`${questionType}: file locked`); continue; }

    const alreadyPending = await hasPendingCandidate(targetFile);
    if (alreadyPending) { skipped.push(`${questionType}: candidate already pending`); continue; }

    const originalCode = readSourceFile(targetFile);
    if (!originalCode) { skipped.push(`${questionType}: could not read ${targetFile}`); continue; }

    const weaknessSummary = `
Question type "${questionType}" has failed ${count} times.
Top failure reasons: ${summary.topFailureReasons.join(", ")}
`.trim();

    const failureExamples = summary.samples
      .filter((s) => s.type === questionType)
      .map((s, i) => `Example ${i + 1}:\nInput: ${s.input}\nOutput: ${s.output}\nReason: ${s.reason}`)
      .join("\n\n");

    const result = await generateImprovedCode({
      filePath: targetFile,
      originalCode,
      weaknessSummary,
      failureExamples,
    });

    if (!result) { skipped.push(`${questionType}: Gemini failed to generate`); continue; }
    if (result.confidence < MIN_CONFIDENCE) { skipped.push(`${questionType}: confidence too low (${result.confidence})`); continue; }
    if (result.improvedCode === originalCode) { skipped.push(`${questionType}: no change produced`); continue; }

    const diff = generateDiff(originalCode, result.improvedCode);

    const candidateId = await storeCandidate({
      filePath: targetFile,
      originalCode,
      improvedCode: result.improvedCode,
      diff,
      reason: result.reason,
      confidence: result.confidence,
    });

    if (candidateId) {
      await markWeaknessesAddressed(questionType);
      candidatesGenerated.push(1);
    }
  }

  return {
    candidatesGenerated: candidatesGenerated.length,
    skipped,
  };
}

// ─── Get all pending candidates for owner review ──────────────────────────────
export async function getPendingCandidates() {
  const { data, error } = await supabase
    .from("sv_candidates")
    .select("*")
    .eq("status", "pending")
    .order("confidence", { ascending: false });

  if (error) return [];
  return data ?? [];
}

// ─── Get unnotified candidates ────────────────────────────────────────────────
export async function getUnnotifiedCandidates() {
  const { data } = await supabase
    .from("sv_candidates")
    .select("*")
    .eq("status", "pending")
    .eq("owner_notified", false)
    .order("confidence", { ascending: false });

  return data ?? [];
}

// ─── Mark candidates as notified ─────────────────────────────────────────────
export async function markCandidatesNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabase
    .from("sv_candidates")
    .update({ owner_notified: true, presented_at: new Date().toISOString() })
    .in("id", ids);
}
