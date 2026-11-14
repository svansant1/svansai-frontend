// Authored only. No storage or SQL requests are executed by these pure fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { publicationFailureOutcome } from "../lib/artifacts/storage";
test("explicit permission/constraint rejection permits unpublished-object cleanup", () => {
  for (const code of ["P0001", "23505", "42501", "40001", "40P01"]) assert.equal(publicationFailureOutcome(code), "rejected");
});
test("network, missing acknowledgement and connection errors do not justify deletion", () => {
  for (const code of [undefined, "", "08006", "PGRST000", "TIMEOUT", "57P01"]) assert.equal(publicationFailureOutcome(code), "unknown");
});
