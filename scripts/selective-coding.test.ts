// Deferred regression fixtures. No execution during the coding pass.
import test from "node:test";
import assert from "node:assert/strict";
import { SelectiveIndex, dependencyCandidates, textHash } from "../lib/agents/coding/indexer";
import { rankHypotheses, patchGate, type Evidence, type Hypothesis } from "../lib/agents/coding/hypotheses";
import { proposeNarrowPatch } from "../lib/agents/coding/patches";

test("index reads only explicit paths and one requested dependency hop", async () => {
  const read: string[] = [];
  const source: Record<string, string> = {
    "test/auth.mjs": "import { role } from '../src/role.js';",
    "src/role.js": "import './seed.js'; export const role = 'member';",
    "src/seed.js": "export const seed = true;",
  };
  const index = new SelectiveIndex({ read: async (path) => { read.push(path); return source[path] ?? null; } });
  await index.expand(["test/auth.mjs"], "failing-ci-file", { pin: true });
  assert.deepEqual(read, ["test/auth.mjs"]);
  await index.expandDependencies("test/auth.mjs", "stack-trace-import");
  assert.ok(read.includes("src/role.js"));
  assert.ok(!read.includes("src/seed.js"));
  const contracted = index.contract([], "New evidence moved the investigation away from this import.");
  assert.deepEqual(contracted.entries.map((entry) => entry.path), ["test/auth.mjs"]);
  assert.equal(contracted.scope, "selected-files-only");
  assert.deepEqual(dependencyCandidates("a.mjs", "import '../../../outside.js'"), []);
});
const evidence: Evidence[] = [
  { id: "serial", summary: "Serial passes, parallel fails", source: "experiment", sourceRef: "lab:serial-v-parallel", independentGroup: "parallel-control", observedAt: "2026-11-04T00:00:00Z" },
  { id: "isolated", summary: "Per-worker isolated seeds remove conflicts", source: "experiment", sourceRef: "lab:seed-isolation", independentGroup: "seed-intervention", observedAt: "2026-11-04T00:00:01Z" },
  { id: "jwt", summary: "JWT validation succeeds", source: "experiment", sourceRef: "lab:jwt-trace", independentGroup: "auth-trace", observedAt: "2026-11-04T00:00:02Z" },
];
const hypotheses: Hypothesis[] = [
  { id: "jwt", statement: "JWT parsing regressed", updates: [{ evidenceId: "jwt", effect: "contradicts", strength: 1, explanation: "Validation succeeded on the failing requests." }] },
  { id: "seed", statement: "Shared parallel seeding loses roles", updates: [
    { evidenceId: "serial", effect: "supports", strength: 1, explanation: "Failure requires concurrency." },
    { evidenceId: "isolated", effect: "supports", strength: 1, explanation: "A controlled seed-isolation intervention removes the failure." },
  ] },
];
test("new evidence demotes the original hypothesis without invented certainty", () => {
  assert.equal(rankHypotheses([{ ...hypotheses[0], updates: [] }], []).at(0)?.patchGate, "blocked");
  const ranked = rankHypotheses(hypotheses, evidence);
  assert.equal(ranked[0].id, "seed");
  assert.equal(ranked[0].confidenceKind, "heuristic_not_probability");
  assert.deepEqual(patchGate(ranked, "seed"), []);
  assert.ok(patchGate(ranked, "jwt").length);
  const related = evidence.map((item) => ({ ...item, independentGroup: "same-run" }));
  assert.ok(patchGate(rankHypotheses(hypotheses, related), "seed").length);
});
test("narrow patches bind original content and never mutate it", async () => {
  const snapshot = [{ path: "src/seed.js", content: "const key = 'shared';\n" }];
  const edited = { path: snapshot[0].path, expectedSha256: await textHash(snapshot[0].content), before: "'shared'", after: "'worker-1'" };
  const input = { snapshot, confirmedPaths: ["src/seed.js"], edits: [edited], hypotheses: rankHypotheses(hypotheses, evidence), hypothesisId: "seed" };
  const patch = proposeNarrowPatch(input);
  assert.equal(patch.status, "draft_untested");
  assert.equal(snapshot[0].content, "const key = 'shared';\n");
  assert.equal(patch.snapshot[0].content, "const key = 'worker-1';\n");
  assert.throws(() => proposeNarrowPatch({ ...input, confirmedPaths: [] }));
  assert.throws(() => proposeNarrowPatch({ ...input, edits: [{ ...edited, expectedSha256: "0".repeat(64) }] }));
});
