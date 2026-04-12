// ─────────────────────────────────────────────────────────────────────────────
// deployer.ts
// Commits an approved candidate to GitHub via the API.
// Render detects the push and auto-deploys.
// THIS FILE IS LOCKED — the improvement engine can never modify it.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const GITHUB_REPO = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

type GitHubFileResponse = {
  content: string;
  sha: string;
};

// ─── Get current file SHA from GitHub (required for updates) ─────────────────
async function getFileSha(filePath: string): Promise<{ sha: string; content: string } | null> {
  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) return null;
    const data = await res.json() as GitHubFileResponse;
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf-8") };
  } catch {
    return null;
  }
}

// ─── Commit a file to GitHub ──────────────────────────────────────────────────
async function commitFile(params: {
  filePath: string;
  content: string;
  sha: string;
  message: string;
}): Promise<boolean> {
  try {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${params.filePath}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content, "utf-8").toString("base64"),
        sha: params.sha,
        branch: GITHUB_BRANCH,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

// ─── Deploy a candidate ───────────────────────────────────────────────────────
export async function deployCandidate(candidateId: string): Promise<{
  success: boolean;
  message: string;
}> {
  // Fetch candidate from Supabase
  const { data: candidate, error } = await supabase
    .from("sv_candidates")
    .select("*")
    .eq("id", candidateId)
    .single();

  if (error || !candidate) {
    return { success: false, message: "Candidate not found." };
  }

  if (candidate.status !== "pending") {
    return { success: false, message: `Candidate is already ${candidate.status}.` };
  }

  // Get current file from GitHub
  const fileData = await getFileSha(candidate.file_path);
  if (!fileData) {
    return { success: false, message: `Could not read ${candidate.file_path} from GitHub.` };
  }

  // Safety check — make sure the file hasn't changed since candidate was generated
  if (fileData.content.trim() !== candidate.original_code.trim()) {
    await supabase
      .from("sv_candidates")
      .update({ status: "rejected", rejection_reason: "Source file changed since candidate was generated." })
      .eq("id", candidateId);

    return {
      success: false,
      message: `The source file has changed since this candidate was created. It's been marked rejected for safety. Run a new improvement cycle.`,
    };
  }

  // Commit the improved code
  const commitMessage = `SVANSAI self-improvement: ${candidate.reason} (candidate ${candidateId.slice(0, 8)})`;
  const committed = await commitFile({
    filePath: candidate.file_path,
    content: candidate.improved_code,
    sha: fileData.sha,
    message: commitMessage,
  });

  if (!committed) {
    return { success: false, message: "GitHub commit failed. Check GITHUB_TOKEN permissions." };
  }

  // Mark as deployed in Supabase
  await supabase
    .from("sv_candidates")
    .update({ status: "deployed", deployed_at: new Date().toISOString() })
    .eq("id", candidateId);

  return {
    success: true,
    message: `Deployed. ${candidate.file_path} has been updated on GitHub. Render will pick it up in about 60 seconds.`,
  };
}

// ─── Reject a candidate ───────────────────────────────────────────────────────
export async function rejectCandidate(
  candidateId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const { error } = await supabase
    .from("sv_candidates")
    .update({
      status: "rejected",
      rejection_reason: reason || "Rejected by owner.",
    })
    .eq("id", candidateId);

  if (error) {
    return { success: false, message: "Failed to reject candidate." };
  }

  return { success: true, message: "Got it. I've rejected that candidate and won't propose it again." };
}
