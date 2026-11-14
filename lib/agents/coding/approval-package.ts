import { getLabJob } from "@/lib/execution/store";
import { labHash, validateApprovedLab } from "@/lib/execution/client";
import { hashContent, type PatchProposal } from "./patches";

/** Loads real owner-scoped worker reports; no model-supplied 'tests passed' booleans. */
export async function preparePatchApprovalPackage(userId: string, patch: PatchProposal, baselineId: string, candidateId: string) {
  if (baselineId === candidateId) throw new Error("Baseline and candidate need separate execution records.");
  const [baseline, candidate] = await Promise.all([getLabJob(userId, baselineId), getLabJob(userId, candidateId)]);
  if (!baseline?.result?.lab || !candidate?.result?.lab) throw new Error("Both runs need saved execution reports.");
  validateApprovedLab(baseline.payload, baseline.payload_hash);
  validateApprovedLab(candidate.payload, candidate.payload_hash);
  const before = baseline.result.lab, after = candidate.result.lab;
  if (baseline.state !== "failed" || before.status !== "exited" || before.exitCode === null || before.exitCode === 0 || before.oomKilled ||
      candidate.state !== "succeeded" || after.status !== "exited" || after.exitCode !== 0 || after.oomKilled ||
      !before.cleanupConfirmed || !after.cleanupConfirmed || before.requestHash !== baseline.payload_hash || after.requestHash !== candidate.payload_hash) {
    throw new Error("Need a completed failing baseline and clean candidate run with confirmed cleanup, not a timeout or unknown outcome.");
  }
  if (baseline.payload.request.mode !== "tests" || candidate.payload.request.mode !== "tests") throw new Error("Script exits do not count as focused test runs.");
  const binding = { hypothesisId: patch.hypothesisId, files: patch.files.map(({ path, beforeSha256, afterSha256 }) => ({ path, beforeSha256, afterSha256 })) };
  if (hashContent(JSON.stringify(binding)) !== patch.hash || !patch.files.length || patch.files.length > 10) throw new Error("Patch identity changed.");
  const changed = new Map(patch.files.map((file) => [file.path, file]));
  if (changed.size !== patch.files.length || patch.files.some((file) =>
    hashContent(file.before) !== file.beforeSha256 || hashContent(file.after) !== file.afterSha256 ||
    !patch.snapshot.some((item) => item.path === file.path && item.content === file.after))) throw new Error("Patch content does not match its file hashes.");
  const baselineSnapshot = patch.snapshot.map((file) => ({ ...file, content: changed.get(file.path)?.before ?? file.content }));
  const expectedBaseline = { ...baseline.payload, request: { ...baseline.payload.request, files: baselineSnapshot.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) } };
  const expectedCandidate = { ...baseline.payload, request: { ...baseline.payload.request, purpose: candidate.payload.request.purpose,
    files: [...patch.snapshot].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) } };
  if (labHash(expectedBaseline) !== baseline.payload_hash || labHash(expectedCandidate) !== candidate.payload_hash) {
    throw new Error("The saved runs did not execute these exact before/after files under the same runtime, entrypoint and resource policy.");
  }
  return {
    state: "ready_for_owner_review" as const, patchHash: patch.hash, hypothesisId: patch.hypothesisId,
    evidenceIds: patch.evidenceIds, files: patch.files, changedLines: patch.changedLines,
    executionEvidence: { baseline: { id: baselineId, hash: before.requestHash, exitCode: before.exitCode },
      candidate: { id: candidateId, hash: after.requestHash, exitCode: after.exitCode }, image: after.image },
    approvals: { patchApplication: "required", commit: "not_authorized", push: "not_authorized", merge: "not_authorized", deploy: "not_authorized" },
    rollback: { strategy: "Restore recorded before-content only after fresh permission and current-file hash checks.", files: patch.files.map(({ path, beforeSha256, afterSha256 }) => ({ path, beforeSha256, afterSha256 })) },
    limitations: [
      "Process outcomes are evidence, not proof of complete test coverage or CI-environment equivalence.",
      "The current scope/known-secret checks are not a complete security assessment; additional Shield review is required.",
      "This package proposes changes only. No source file, branch, database or deployment was changed.",
    ],
  };
}
