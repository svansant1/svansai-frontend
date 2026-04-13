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
import { getPendingCandidates, getUnnotifiedCandidates, markCandidatesNotified } from "./self-improve";
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

const OWNER_PASSWORD = process.env.SV_OWNER_PASSWORD;

// ─── In-memory owner session ──────────────────────────────────────────────────
// Stored per-process. Resets on server restart (deploy).
// sessionId is passed from the frontend per browser session.
const ownerSessions = new Set<string>();

// ─── Session helpers ──────────────────────────────────────────────────────────
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
// Tracks which sessions are in the middle of the unlock flow
const awaitingPassword = new Set<string>();

export function isAwaitingPassword(sessionId: string): boolean {
  return awaitingPassword.has(sessionId);
}

// ─── Parse sv commands ────────────────────────────────────────────────────────
export function parseSVCommand(message: string, sessionId: string): SVCommand {
  const q = message.toLowerCase().trim();
  const raw = message.trim();

  // If session is awaiting password — treat any message as a password attempt
  if (awaitingPassword.has(sessionId)) {
    return { type: "password_attempt", text: raw };
  }

  // Must start with "sv " or be exactly "sv"
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
      return "Owner mode enabled. You now have full access to self-improvement commands.\n\nAvailable commands:\n• **sv analyze** — run full self-analysis\n• **sv improve** — generate improvement candidates\n• **sv show candidates** — review pending upgrades\n• **sv show [n]** — see diff for candidate #n\n• **sv deploy [n]** — deploy candidate #n\n• **sv deploy all** — deploy all candidates\n• **sv reject [n]** — reject candidate #n\n• **sv status** — view current system status\n• **sv instruct: [text]** — give me a direct instruction\n• **sv lock** — disable owner mode";
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
    case "instruct": {
      await storeInstruction(command.text);
      return `Instruction saved: "${command.text}"\n\nI'll factor this into the next improvement cycle.`;
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
