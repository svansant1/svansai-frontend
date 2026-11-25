import assert from "node:assert/strict";
import test from "node:test";
import { assertContextRevisionCurrent } from "../lib/context/revision-guard";

test("the permission watcher waits for our own write but still rejects an unrelated revision", async () => {
  let release!: () => void;
  const state = { expectedContextRevision: 1, progressWrite: new Promise<void>(r => { release = r; }) as Promise<void> | undefined };
  const check = assertContextRevisionCurrent(state, async () => 2);
  state.expectedContextRevision = 2; state.progressWrite = undefined; release();
  await check;
  await assert.rejects(assertContextRevisionCurrent(state, async () => 3), /changed/);
});

test("a context read started before our own write finishes is retried against the new revision", async () => {
  const state = { expectedContextRevision: 1 };
  let reads = 0;
  await assertContextRevisionCurrent(state, async () => { reads++; if (reads === 1) { state.expectedContextRevision = 2; return 1; } return 2; });
  assert.equal(reads, 2);
});
