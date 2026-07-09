// ─────────────────────────────────────────────────────────────────────────────
// instruction-handler.ts
// Owner access via unlock/lock password session.
// No dependency on userId or auth state.
//
// Flow:
//   User: "sv unlock"
//   SV:   "Enter owner password:"
//   User: "mypassword"
//   SV:   "Owner mode enabled."
//   User: "sv analyze" / "sv deploy 1" / etc.
//   User: "sv lock"
//   SV:   "Owner mode disabled."
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import {
  getPendingCandidates,
  getUnnotifiedCandidates,
  markCandidatesNotified,
} from "./self-improve";
import { deployCandidate, rejectCandidate } from "./deployer";
import { runMonitor } from "./self-monitor";
import { getWeaknessSummary } from "./self-analysis";
import {
  buildUpgradeNotification,
  buildCandidateDetail,
  buildDeployConfirmation,
  buildRejectConfirmation,
  buildAllDeployedSummary,
  buildNoUpgradesMessage,
  buildAnalysisResult,
} from "./upgrade-presenter";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const OWNER_PASSWORD = process.env.SV_OWNER_PASSWORD;

// Files that can never be touched by the improvement engine
const LOCKED_FILES = [
  "lib/ai/deployer.ts",
  "lib/ai/self-monitor.ts",
  "lib/ai/self-improve.ts",
  "lib/ai/self-analysis.ts",
  "app/api/sv/deploy/route.ts",
  "app/api/sv/monitor/route.ts",
];

// ─── In-memory owner session ──────────────────────────────────────────────────
const ownerSessions = new Set<string>();

export function isOwnerSession(sessionId: string): boolean {
  return ownerSessions.has(sessionId);
}

export function unlockOwnerSession(sessionId: string): void {
  ownerSessions.add(sessionId);
}

export function lockOwnerSession(sessionId: string): void {
  ownerSessions.delete(sessionId);
}

// ─── Command types ────────────────────────────────────────────────────────────
type SVCommand =
  | { type: "unlock" }
  | { type: "lock" }
  | { type: "password_attempt"; text: string }
  | { type: "analyze" }
  | { type: "improve" }
  | { type: "show_candidates" }
  | { type: "show_candidate"; index: number }
  | { type: "deploy_all" }
  | { type: "deploy"; index: number }
  | { type: "reject"; index: number }
  | { type: "skip" }
  | { type: "instruct"; text: string }
  | { type: "status" }
  | null;

// ─── Awaiting password state per session ─────────────────────────────────────
const awaitingPassword = new Set<string>();

export function isAwaitingPassword(sessionId: string): boolean {
  return awaitingPassword.has(sessionId);
}

// ─── Parse sv commands ────────────────────────────────────────────────────────
export function parseSVCommand(message: string, sessionId: string): SVCommand {
  const q = message.toLowerCase().trim();
  const raw = message.trim();

  if (awaitingPassword.has(sessionId)) {
    return { type: "password_attempt", text: raw };
  }

  if (!q.startsWith("sv ") && q !== "sv") return null;

  const body = q.slice(3).trim();

  if (body === "unlock") return { type: "unlock" };
  if (body === "lock") return { type: "lock" };
  if (body === "analyze" || body === "analyse") return { type: "analyze" };
  if (body === "improve") return { type: "improve" };
  if (body === "show candidates" || body === "candidates" || body === "list") return { type: "show_candidates" };
  if (body === "deploy all") return { type: "deploy_all" };
  if (body === "skip") return { type: "skip" };
  if (body === "status") return { type: "status" };

  const showMatch = body.match(/^show\s+(\d+)$/);
  if (showMatch) return { type: "show_candidate", index: parseInt(showMatch[1]) };

  const deployMatch = body.match(/^deploy\s+(\d+)$/);
  if (deployMatch) return { type: "deploy", index: parseInt(deployMatch[1]) };

  const rejectMatch = body.match(/^reject\s+(\d+)$/);
  if (rejectMatch) return { type: "reject", index: parseInt(rejectMatch[1]) };

  const instructMatch = body.match(/^instruct[:\s]+(.+)$/s);
  if (instructMatch) return { type: "instruct", text: instructMatch[1].trim() };

  return null;
}

// ─── Store an owner instruction ───────────────────────────────────────────────
async function storeInstruction(text: string): Promise<void> {
  await supabase.from("sv_instructions").insert({ instruction: text });
}

// ─── Read a source file from disk ─────────────────────────────────────────────
function readSourceFile(filePath: string): string | null {
  try {
    return fs.readFileSync(
      path.join(/* turbopackIgnore: true */ process.cwd(), filePath),
      "utf-8",
    );
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
    if (orig === undefined) diff.push(`+ ${next}`);
    else if (next === undefined) diff.push(`- ${orig}`);
    else if (orig !== next) { diff.push(`- ${orig}`); diff.push(`+ ${next}`); }
  }
  return diff.slice(0, 100).join("\n");
}

// ─── Execute improvement from a direct owner instruction ──────────────────────
// This runs immediately when owner types "sv instruct: [text]"
// It picks the most relevant file, asks Gemini to improve it, stores the
// candidate, and returns the diff so the owner can deploy right away.
async function executeInstruction(instruction: string): Promise<string> {
  // Determine which file to target based on keywords in the instruction
  const lower = instruction.toLowerCase();
  let targetFile = "lib/ai/prompt.ts"; // default — most impactful for response quality

  if (lower.includes("router") || lower.includes("routing") || lower.includes("question type") || lower.includes("detect")) {
    targetFile = "lib/ai/router.ts";
  } else if (lower.includes("chat engine") || lower.includes("response filter") || lower.includes("fallback") || lower.includes("generic")) {
    targetFile = "lib/ai/chat-engine.ts";
  } else if (lower.includes("memory") || lower.includes("context") || lower.includes("remember")) {
    targetFile = "lib/ai/memory.ts";
  } else if (lower.includes("cleanup") || lower.includes("clean") || lower.includes("sanitize")) {
    targetFile = "lib/ai/cleanup.ts";
  } else if (lower.includes("prompt") || lower.includes("system") || lower.includes("instruction") || lower.includes("tone") || lower.includes("personality")) {
    targetFile = "lib/ai/prompt.ts";
  }

  // Safety check — never touch locked files
  if (LOCKED_FILES.includes(targetFile)) {
    return `Cannot modify ${targetFile} — it is locked for safety.`;
  }

  const originalCode = readSourceFile(targetFile);
  if (!originalCode) {
    return `Could not read ${targetFile} from disk. Check that the file exists.`;
  }

  // Ask Gemini to apply the instruction to the file
  const prompt = `
You are improving SVANSAI's source code based on a direct owner instruction.

FILE: ${targetFile}

CURRENT CODE:
\`\`\`typescript
${originalCode}
\`\`\`

OWNER INSTRUCTION:
"${instruction}"

Your task:
1. Read the instruction carefully and understand exactly what the owner wants changed.
2. Apply that change to the relevant section of code.
3. Keep all other code completely identical — do not refactor unrelated parts.
4. Do not add imports that don't already exist.
5. Do not change function signatures.

Return ONLY a JSON object with this exact structure:
{
  "improvedCode": "the complete file with your change applied",
  "reason": "one sentence explaining exactly what you changed and why",
  "confidence": 0.90
}

The confidence should reflect how certain you are this implements the instruction correctly.
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
      return "I generated a response but it wasn't in the expected format. Try rephrasing your instruction more specifically.";
    }

    if (parsed.improvedCode === originalCode) {
      return `I analyzed ${targetFile} but the instruction didn't result in any code changes. Try being more specific about what you want changed — for example: "make SV responses shorter by default" or "add more personality to the system prompt".`;
    }

    // Store as a candidate
    const diff = generateDiff(originalCode, parsed.improvedCode);
    const { data, error } = await supabase
      .from("sv_candidates")
      .insert({
        file_path: targetFile,
        original_code: originalCode,
        improved_code: parsed.improvedCode,
        diff,
        reason: parsed.reason,
        confidence: parsed.confidence,
        status: "pending",
        owner_notified: true,
      })
      .select("id")
      .single();

    if (error || !data) {
      return "The improvement was generated but failed to save. Check Supabase logs.";
    }

    const candidateId = data.id as string;
    const confidencePct = Math.round(parsed.confidence * 100);
    const diffPreview = diff ? `\`\`\`diff\n${diff.slice(0, 600)}\n\`\`\`` : "No diff available.";

    return `Got it. Here's what I'll change in **${targetFile}**:

**Reason:** ${parsed.reason}
**Confidence:** ${confidencePct}%
**Candidate ID:** \`${candidateId.slice(0, 8)}\`

${diffPreview}

Say **sv deploy 1** to deploy this now, or **sv show candidates** to review all pending upgrades.`;

  } catch (err) {
    console.error("executeInstruction failed:", err);
    return "Something went wrong while generating the improvement. Check the server logs.";
  }
}

// ─── Handle a parsed sv command ───────────────────────────────────────────────
export async function handleSVCommand(
  command: SVCommand,
  sessionId: string
): Promise<string | null> {
  if (!command) return null;

  // ── sv unlock ──────────────────────────────────────────────────────────────
  if (command.type === "unlock") {
    if (isOwnerSession(sessionId)) {
      return "Owner mode is already enabled. Say **sv lock** to disable it.";
    }
    awaitingPassword.add(sessionId);
    return "Enter owner password:";
  }

  // ── password attempt ───────────────────────────────────────────────────────
  if (command.type === "password_attempt") {
    awaitingPassword.delete(sessionId);

    if (!OWNER_PASSWORD) {
      return "SV_OWNER_PASSWORD is not set in environment variables. Add it to your Render dashboard.";
    }

    if (command.text === OWNER_PASSWORD) {
      unlockOwnerSession(sessionId);
      return "Owner mode enabled. You now have full access to self-improvement commands.\n\nAvailable commands:\n• **sv analyze** — run full self-analysis\n• **sv improve** — generate improvement candidates\n• **sv show candidates** — review pending upgrades\n• **sv show [n]** — see diff for candidate #n\n• **sv deploy [n]** — deploy candidate #n\n• **sv deploy all** — deploy all candidates\n• **sv reject [n]** — reject candidate #n\n• **sv status** — view current system status\n• **sv instruct: [text]** — give a direct improvement instruction and execute it immediately\n• **sv lock** — disable owner mode";
    }

    return "Incorrect password. Owner mode not enabled.";
  }

  // ── sv lock ────────────────────────────────────────────────────────────────
  if (command.type === "lock") {
    lockOwnerSession(sessionId);
    return "Owner mode disabled.";
  }

  // All commands below require owner session
  if (!isOwnerSession(sessionId)) {
    return "Owner mode is not enabled. Say **sv unlock** to authenticate.";
  }

  switch (command.type) {

    // ── sv analyze ────────────────────────────────────────────────────────────
    case "analyze": {
      const monitorResult = await runMonitor("manual");
      const summary = await getWeaknessSummary();
      return buildAnalysisResult({
        weaknessesFound: monitorResult.weaknessesFound,
        candidatesGenerated: monitorResult.candidatesGenerated,
        byType: summary.byType,
        topReasons: summary.topFailureReasons,
      });
    }

    // ── sv improve ────────────────────────────────────────────────────────────
    case "improve": {
      const result = await runMonitor("manual");
      if (result.candidatesGenerated === 0) {
        return "I ran the improvement cycle but no high-confidence candidates were generated yet. More weakness data is needed — keep chatting and I'll try again.";
      }
      const candidates = await getPendingCandidates();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return buildUpgradeNotification(candidates);
    }

    // ── sv show candidates ────────────────────────────────────────────────────
    case "show_candidates": {
      const candidates = await getPendingCandidates();
      if (candidates.length === 0) return buildNoUpgradesMessage();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return buildUpgradeNotification(candidates);
    }

    // ── sv show [n] ───────────────────────────────────────────────────────────
    case "show_candidate": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found. Say "sv show candidates" to see the list.`;
      return buildCandidateDetail(candidate, command.index);
    }

    // ── sv deploy [n] ─────────────────────────────────────────────────────────
    case "deploy": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found. Say "sv show candidates" to see the list.`;
      const preview = buildDeployConfirmation(candidate);
      const result = await deployCandidate(candidate.id);
      return `${preview}\n\n${result.message}`;
    }

    // ── sv deploy all ─────────────────────────────────────────────────────────
    case "deploy_all": {
      const candidates = await getPendingCandidates();
      if (candidates.length === 0) return buildNoUpgradesMessage();
      let deployed = 0;
      let failed = 0;
      for (const candidate of candidates) {
        const result = await deployCandidate(candidate.id);
        if (result.success) deployed++;
        else failed++;
      }
      return buildAllDeployedSummary(deployed, failed);
    }

    // ── sv reject [n] ─────────────────────────────────────────────────────────
    case "reject": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found.`;
      await rejectCandidate(candidate.id, "Rejected by owner via chat.");
      return buildRejectConfirmation(candidate);
    }

    // ── sv skip ───────────────────────────────────────────────────────────────
    case "skip": {
      const candidates = await getPendingCandidates();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return "Got it — holding the upgrade list for now. Say **sv show candidates** anytime to review.";
    }

    // ── sv instruct: [text] ───────────────────────────────────────────────────
    // Now executes the improvement immediately instead of just storing it
    case "instruct": {
      await storeInstruction(command.text);
      return await executeInstruction(command.text);
    }

    // ── sv status ─────────────────────────────────────────────────────────────
    case "status": {
      const summary = await getWeaknessSummary();
      const candidates = await getPendingCandidates();
      const { data: logs } = await supabase
        .from("sv_monitor_log")
        .select("created_at, trigger")
        .order("created_at", { ascending: false })
        .limit(1);

      const lastRun = logs?.[0]?.created_at
        ? new Date(logs[0].created_at).toLocaleString()
        : "never";

      return `**SVANSAI Self-Improvement Status**\n\nWeaknesses logged: ${summary.total}\nPending upgrades: ${candidates.length}\nLast analysis run: ${lastRun}\nOwner mode: enabled ✓\n\nTop weak areas: ${Object.entries(summary.byType).map(([t, c]) => `${t} (${c})`).join(", ") || "none"}\n\nSay **sv show candidates** to review upgrades or **sv analyze** for a fresh analysis.`;
    }

    default:
      return null;
  }
}

// ─── Check for unnotified candidates — only shown in owner sessions ───────────
export async function checkAndSurfaceUpgrades(sessionId: string): Promise<string | null> {
  if (!isOwnerSession(sessionId)) return null;

  const unnotified = await getUnnotifiedCandidates();
  if (unnotified.length === 0) return null;

  await markCandidatesNotified(unnotified.map((c) => c.id));
  return buildUpgradeNotification(unnotified);
}
