import { createHash } from "node:crypto";
import { snapshotPath, validateSnapshotText } from "@/lib/execution/scope";
import type { SnapshotFile } from "@/lib/execution/contracts";
import { patchGate, type RankedHypothesis } from "./hypotheses";

export type NarrowEdit = { path: string; expectedSha256: string; before: string; after: string };
export type PatchProposal = {
  status: "draft_untested"; hash: string; hypothesisId: string; evidenceIds: string[];
  files: { path: string; beforeSha256: string; afterSha256: string; before: string; after: string }[];
  snapshot: SnapshotFile[]; changedLines: number; security: { decision: "allow_review"; limitations: string[] };
};
export const hashContent = (text: string) => createHash("sha256").update(text).digest("hex");

/** Return an immutable proposal; never write the original workspace or invoke Git. */
export function proposeNarrowPatch(input: {
  snapshot: SnapshotFile[]; confirmedPaths: string[]; edits: NarrowEdit[];
  hypotheses: RankedHypothesis[]; hypothesisId: string;
}): PatchProposal {
  const blockers = patchGate(input.hypotheses, input.hypothesisId);
  if (blockers.length) throw new Error("Patch generation blocked: " + blockers.join(" "));
  if (!input.edits.length || input.edits.length > 20 || input.snapshot.length > 50) throw new Error("Patch scope exceeds the narrow-edit limit.");
  const originals = new Map(input.snapshot.map((file) => [snapshotPath(file.path), validateSnapshotText(file.content)]));
  if (new Set([...originals.keys()].map((path) => path.toLowerCase())).size !== input.snapshot.length) throw new Error("Duplicate or case-ambiguous source paths.");
  if ([...originals.values()].some((content) => Buffer.byteLength(content) > 32768) ||
      [...originals.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0) > 131072) throw new Error("Source snapshot exceeds its byte budget.");
  const allowed = new Set(input.confirmedPaths.map(snapshotPath)), changed = new Map<string, string>();
  let changedLines = 0;
  for (const edit of input.edits) {
    const path = snapshotPath(edit.path), original = originals.get(path);
    if (!allowed.has(path) || original === undefined) throw new Error("Patch exceeds evidence-confirmed file scope.");
    if (/^(?:\.github\/|package(?:-lock)?\.json$|yarn\.lock$|pnpm-lock\.yaml$)|(?:^|\/)(?:migrations|security-policies)(?:\/|$)/i.test(path)) {
      throw new Error("Dependency, workflow, database, and policy changes need a separately scoped approval.");
    }
    if (hashContent(original) !== edit.expectedSha256) throw new Error("Source changed after investigation; re-read it before generating a patch.");
    const content = changed.get(path) ?? original;
    validateSnapshotText(edit.after);
    if (!edit.before || edit.before === edit.after || content.split(edit.before).length !== 2) throw new Error("Each replacement must match exactly once and make an explicit change.");
    changedLines += edit.before.split("\n").length + edit.after.split("\n").length;
    if (changedLines > 200 || changed.size > 10) throw new Error("Patch exceeds the changed-line/file review budget.");
    const next = content.replace(edit.before, () => edit.after);
    if (Buffer.byteLength(next) > 32768) throw new Error("Patched file exceeds snapshot size.");
    changed.set(path, next);
  }
  if (changed.size > 10) throw new Error("Patch changes too many files.");
  if ([...originals].reduce((sum, [path, content]) => sum + Buffer.byteLength(changed.get(path) ?? content), 0) > 131072) throw new Error("Patched snapshot exceeds its total byte budget.");
  const files = [...changed].map(([path, after]) => ({ path, before: originals.get(path)!, after,
    beforeSha256: hashContent(originals.get(path)!), afterSha256: hashContent(after) }));
  const selected = input.hypotheses.find((item) => item.id === input.hypothesisId)!;
  const binding = { hypothesisId: input.hypothesisId, files: files.map(({ path, beforeSha256, afterSha256 }) => ({ path, beforeSha256, afterSha256 })) };
  return { status: "draft_untested", hash: hashContent(JSON.stringify(binding)), hypothesisId: input.hypothesisId,
    evidenceIds: [...selected.supportingEvidence], files, changedLines,
    snapshot: input.snapshot.map((file) => ({ ...file, content: changed.get(file.path) ?? file.content })),
    security: { decision: "allow_review", limitations: ["Path and known-secret checks only; not a full security audit.", "No CI equivalence, test pass, owner approval or deployment is implied."] } };
}
