// ─────────────────────────────────────────────────────────────────────────────
// instruction-handler.ts
// Parses owner chat commands for the self-improvement system.
// Called from chat-engine.ts BEFORE the normal Gemini call.
// If a command is detected, returns a response directly without hitting Gemini.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { getPendingCandidates, getUnnotifiedCandidates, markCandidatesNotified } from "./self-improve";
import { deployCandidate, rejectCandidate } from "./deployer";
import { runMonitor } from "@/lib/ai/self-monitor";
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

const OWNER_USER_ID = process.env.OWNER_USER_ID;

// ─── Check if this user is the owner ─────────────────────────────────────────
export function isOwner(userId?: string | null): boolean {
  if (!OWNER_USER_ID) return false;
  return userId === OWNER_USER_ID;
}

// ─── Parse a message for sv commands ─────────────────────────────────────────
type SVCommand =
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

export function parseSVCommand(message: string): SVCommand {
  const q = message.toLowerCase().trim();

  if (!q.startsWith("sv ") && q !== "sv") return null;

  const body = q.slice(3).trim();

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

// ─── Handle a detected sv command ────────────────────────────────────────────
export async function handleSVCommand(
  command: SVCommand,
  userId?: string | null
): Promise<string | null> {
  if (!command) return null;
  if (!isOwner(userId)) return "Self-improvement commands are only available to the owner account.";

  switch (command.type) {

    // ── sv analyze ──────────────────────────────────────────────────────────
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

    // ── sv improve ──────────────────────────────────────────────────────────
    case "improve": {
      const result = await runMonitor("manual");
      if (result.candidatesGenerated === 0) {
        return "I ran the improvement cycle but didn't generate any high-confidence candidates yet. More weakness data is needed. Keep chatting and I'll try again.";
      }
      const candidates = await getPendingCandidates();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return buildUpgradeNotification(candidates);
    }

    // ── sv show candidates ───────────────────────────────────────────────────
    case "show_candidates": {
      const candidates = await getPendingCandidates();
      if (candidates.length === 0) return buildNoUpgradesMessage();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return buildUpgradeNotification(candidates);
    }

    // ── sv show [n] ──────────────────────────────────────────────────────────
    case "show_candidate": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found. Say "sv show candidates" to see the list.`;
      return buildCandidateDetail(candidate, command.index);
    }

    // ── sv deploy [n] ────────────────────────────────────────────────────────
    case "deploy": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found. Say "sv show candidates" to see the list.`;
      const preview = buildDeployConfirmation(candidate);
      const result = await deployCandidate(candidate.id);
      return `${preview}\n\n${result.message}`;
    }

    // ── sv deploy all ────────────────────────────────────────────────────────
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

    // ── sv reject [n] ────────────────────────────────────────────────────────
    case "reject": {
      const candidates = await getPendingCandidates();
      const candidate = candidates[command.index - 1];
      if (!candidate) return `No candidate #${command.index} found.`;
      await rejectCandidate(candidate.id, "Rejected by owner via chat.");
      return buildRejectConfirmation(candidate);
    }

    // ── sv skip ──────────────────────────────────────────────────────────────
    case "skip": {
      const candidates = await getPendingCandidates();
      await markCandidatesNotified(candidates.map((c) => c.id));
      return "Got it — I'll hold the upgrade list for now. You can check it anytime with \"sv show candidates\".";
    }

    // ── sv instruct: [text] ──────────────────────────────────────────────────
    case "instruct": {
      await storeInstruction(command.text);
      return `Instruction saved: "${command.text}"\n\nI'll factor this into the next improvement cycle.`;
    }

    // ── sv status ────────────────────────────────────────────────────────────
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

      return `**SVANSAI Self-Improvement Status**\n\nWeaknesses logged: ${summary.total}\nPending upgrades: ${candidates.length}\nLast analysis run: ${lastRun}\n\nTop weak areas: ${Object.entries(summary.byType).map(([t, c]) => `${t} (${c})`).join(", ") || "none"}\n\nSay "sv show candidates" to review upgrades, or "sv analyze" to run a fresh analysis.`;
    }

    default:
      return null;
  }
}

// ─── Check for unnotified candidates and surface them to owner ────────────────
export async function checkAndSurfaceUpgrades(userId?: string | null): Promise<string | null> {
  if (!isOwner(userId)) return null;

  const unnotified = await getUnnotifiedCandidates();
  if (unnotified.length === 0) return null;

  await markCandidatesNotified(unnotified.map((c) => c.id));
  return buildUpgradeNotification(unnotified);
}
