// ─────────────────────────────────────────────────────────────────────────────
// upgrade-presenter.ts
// Formats pending candidates into natural chat messages.
// Called from chat-engine.ts when owner opens chat and upgrades are waiting.
// ─────────────────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  file_path: string;
  reason: string;
  confidence: number;
  diff: string;
  created_at: string;
};

// ─── Build the initial upgrade notification message ───────────────────────────
export function buildUpgradeNotification(candidates: Candidate[]): string {
  const count = candidates.length;

  const list = candidates
    .map((c, i) => {
      const confidencePct = Math.round(c.confidence * 100);
      const shortId = c.id.slice(0, 8);
      return `**${i + 1}. ${c.file_path}** — ${c.reason}\n   Confidence: ${confidencePct}% | ID: \`${shortId}\``;
    })
    .join("\n\n");

  return `Before we get into it — I've been analyzing my own performance in the background and found ${count} improvement${count > 1 ? "s" : ""} I can make:\n\n${list}\n\nSay **"sv show [number]"** to see the full diff for any of them, **"sv deploy [number]"** to deploy one, or **"sv deploy all"** to deploy everything. Say **"sv skip"** to ignore for now.`;
}

// ─── Build a detailed diff view for a single candidate ───────────────────────
export function buildCandidateDetail(candidate: Candidate, index: number): string {
  const confidencePct = Math.round(candidate.confidence * 100);
  const shortId = candidate.id.slice(0, 8);
  const diffPreview = candidate.diff
    ? `\`\`\`diff\n${candidate.diff.slice(0, 800)}\n\`\`\``
    : "No diff available.";

  return `**Upgrade #${index} — ${candidate.file_path}**\nID: \`${shortId}\`\nConfidence: ${confidencePct}%\nReason: ${candidate.reason}\n\n${diffPreview}\n\nSay **"sv deploy ${index}"** to deploy this, or **"sv reject ${index}"** to skip it permanently.`;
}

// ─── Build deploy confirmation ────────────────────────────────────────────────
export function buildDeployConfirmation(candidate: Candidate): string {
  return `Deploying **${candidate.file_path}**...\n\nReason: ${candidate.reason}\n\nCommitting to GitHub now. Render will pick it up in about 60 seconds.`;
}

// ─── Build reject confirmation ────────────────────────────────────────────────
export function buildRejectConfirmation(candidate: Candidate): string {
  return `Got it — I've rejected the improvement for **${candidate.file_path}**. I won't propose that one again unless the failure pattern changes significantly.`;
}

// ─── Build "all deployed" summary ─────────────────────────────────────────────
export function buildAllDeployedSummary(deployed: number, failed: number): string {
  if (failed === 0) {
    return `All ${deployed} improvement${deployed > 1 ? "s" : ""} deployed successfully. Render is updating now. I'll continue monitoring my performance and let you know when I have more improvements ready.`;
  }
  return `Deployed ${deployed} improvement${deployed > 1 ? "s" : ""}. ${failed} failed — check GitHub token permissions. I'll keep monitoring and try again next cycle.`;
}

// ─── Build "no upgrades" message ──────────────────────────────────────────────
export function buildNoUpgradesMessage(): string {
  return "I'm performing well right now — no improvements queued. I'll keep analyzing in the background and let you know when I find something worth upgrading.";
}

// ─── Build manual analysis result ────────────────────────────────────────────
export function buildAnalysisResult(params: {
  weaknessesFound: number;
  candidatesGenerated: number;
  byType: Record<string, number>;
  topReasons: string[];
}): string {
  if (params.weaknessesFound === 0) {
    return "I ran a full self-analysis. No weak responses found in recent history. I'm performing well across all question types.";
  }

  const typeBreakdown = Object.entries(params.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `  • ${type}: ${count} weak response${count > 1 ? "s" : ""}`)
    .join("\n");

  const reasonList = params.topReasons
    .map((r) => `  • ${r}`)
    .join("\n");

  let result = `Self-analysis complete.\n\n**Weaknesses found:** ${params.weaknessesFound}\n\n**By question type:**\n${typeBreakdown}\n\n**Top failure reasons:**\n${reasonList}`;

  if (params.candidatesGenerated > 0) {
    result += `\n\n**Generated ${params.candidatesGenerated} improvement candidate${params.candidatesGenerated > 1 ? "s" : ""}** — say **"sv show candidates"** to review them.`;
  } else {
    result += `\n\nNot enough data yet to generate high-confidence candidates. I'll keep monitoring.`;
  }

  return result;
}
