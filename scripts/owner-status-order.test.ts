// Authored, not executed. Models response ordering without a browser or live auth.
import test from "node:test";
import assert from "node:assert/strict";
import { OwnerStatusGate } from "../lib/auth/owner-status-order";
test("a pre-unlock status response cannot overwrite the successful unlock", () => {
  const gate = new OwnerStatusGate(), oldRead = gate.begin(false), unlock = gate.begin(true);
  assert.equal(gate.canRead(), false);
  assert.equal(gate.accept(unlock), true);
  gate.finish(unlock);
  assert.equal(gate.canRead(), true);
  assert.equal(gate.accept(oldRead), false);
});
test("manual lock invalidates an in-flight unlock response", () => {
  const gate = new OwnerStatusGate(), unlock = gate.begin(true), lock = gate.begin(true);
  assert.equal(gate.accept(lock), true); assert.equal(gate.accept(unlock), false);
  gate.finish(unlock); gate.finish(lock); assert.equal(gate.canRead(), true);
});
test("finishing an old lock cannot invalidate a newer explicit unlock", () => {
  const gate = new OwnerStatusGate(), lock = gate.begin(true), unlock = gate.begin(true);
  gate.finish(lock); assert.equal(gate.accept(unlock), true);
});
test("out-of-order reads and old-account responses cannot restore stale state", () => {
  const gate = new OwnerStatusGate(), first = gate.begin(false), second = gate.begin(false);
  assert.equal(gate.accept(second), true); assert.equal(gate.accept(first), false);
  const oldAccount = gate.begin(true); gate.reset();
  assert.equal(gate.accept(oldAccount), false); assert.equal(gate.canRead(), true);
});
