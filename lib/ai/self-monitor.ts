// ─────────────────────────────────────────────────────────────────────────────
// self-monitor.ts
// The autonomous analysis loop.
// Called by the Render cron job every 6 hours AND
// triggered from chat-engine.ts every 50 conversations.
// THIS FILE IS LOCKED — the improvement engine can never modify it.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { getWeaknessSummary } from "./self-analysis";
import { runImprovementCycle } from "./self-improve";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Run improvement cycle if this many unaddressed weaknesses exist
const WEAKNESS_THRESHOLD = 15;

// ─── Log a monitor run ────────────────────────────────────────────────────────
async function logMonitorRun(params: {
  weaknessesFound: number;
  candidatesGenerated: number;
  trigger: string;
}): Promise<void> {
  await supabase.from("sv_monitor_log").insert({
    weaknesses_found: params.weaknessesFound,
    candidates_generated: params.candidatesGenerated,
    trigger: params.trigger,
  });
}

// ─── Main monitor run ─────────────────────────────────────────────────────────
export async function runMonitor(trigger: "cron" | "manual" | "threshold" = "cron"): Promise<{
  weaknessesFound: number;
  candidatesGenerated: number;
  skipped: string[];
  message: string;
}> {
  console.log(`[SV Monitor] Running — trigger: ${trigger}`);

  // Get current weakness state
  const summary = await getWeaknessSummary();

  if (summary.total === 0) {
    await logMonitorRun({ weaknessesFound: 0, candidatesGenerated: 0, trigger });
    return {
      weaknessesFound: 0,
      candidatesGenerated: 0,
      skipped: [],
      message: "No weaknesses found. SVANSAI is performing well.",
    };
  }

  // Run improvement cycle
  const result = await runImprovementCycle();

  await logMonitorRun({
    weaknessesFound: summary.total,
    candidatesGenerated: result.candidatesGenerated,
    trigger,
  });

  console.log(`[SV Monitor] Done — ${summary.total} weaknesses, ${result.candidatesGenerated} candidates generated`);

  return {
    weaknessesFound: summary.total,
    candidatesGenerated: result.candidatesGenerated,
    skipped: result.skipped,
    message: result.candidatesGenerated > 0
      ? `Found ${summary.total} weaknesses. Generated ${result.candidatesGenerated} improvement candidate(s).`
      : `Found ${summary.total} weaknesses but no candidates met the confidence threshold yet.`,
  };
}

// ─── Threshold check — call this from chat-engine every N conversations ───────
export async function checkThresholdAndRun(): Promise<void> {
  try {
    const summary = await getWeaknessSummary();
    if (summary.total >= WEAKNESS_THRESHOLD) {
      console.log(`[SV Monitor] Threshold hit (${summary.total} weaknesses) — running improvement cycle`);
      await runMonitor("threshold");
    }
  } catch (err) {
    console.error("[SV Monitor] Threshold check failed:", err);
  }
}

// ─── Get conversation count from monitor log ──────────────────────────────────
export async function getConversationCount(): Promise<number> {
  const { count } = await supabase
    .from("sv_monitor_log")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}
