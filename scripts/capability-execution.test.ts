// Written now; execution is intentionally deferred by the user.
import test from "node:test";
import assert from "node:assert/strict";
import { runCapability } from "../lib/platform/capabilities/runner";
import { CapabilityRegistry } from "../lib/platform/capabilities/registry";
import type { CapabilityDefinition, ExecutionContext } from "../lib/platform/capabilities/contracts";
const definition: CapabilityDefinition<string, string> = {
  id: "example.reply", name: "Example", version: 1, inputs: ["text"], outputs: ["text"], permissions: ["reply"], sideEffects: "none", validation: "Nonempty text checked.",
  parse: (input) => { if (typeof input !== "string") throw new Error("Invalid input"); return input; }, available: () => ({ available: true }), execute: async (input) => input,
  validate: (output) => { if (!output) throw new Error("Empty output"); },
};
const context = (granted = true): ExecutionContext => ({ requestId: "test", events: [], permissions: new Set(granted ? ["reply"] : []) });
test("execution events are emitted by the runner in order", async () => { const ctx = context(); assert.equal(await runCapability(definition, "hi", ctx), "hi"); assert.deepEqual(ctx.events.map((e) => e.state), ["started", "validating", "completed"]); });
test("missing permissions block before the handler runs", async () => { let ran = false; const ctx = context(false); await assert.rejects(runCapability({ ...definition, execute: async () => { ran = true; return "x"; } }, "hi", ctx)); assert.equal(ran, false); assert.equal(ctx.events[0].state, "blocked"); });
test("invalid outputs never receive completion events", async () => { const ctx = context(); await assert.rejects(runCapability(definition, "", ctx)); assert.equal(ctx.events.at(-1)?.state, "failed"); assert.equal(ctx.events.some((e) => e.state === "completed"), false); });
test("external actions cannot use the ordinary chat executor", async () => { const ctx = context(); await assert.rejects(runCapability({ ...definition, sideEffects: "external" }, "hi", ctx)); assert.equal(ctx.events[0].state, "blocked"); });
test("registry refuses duplicate names and missing handlers", () => { const registry = new CapabilityRegistry<string, string>(); registry.register(definition); assert.throws(() => registry.register(definition)); assert.throws(() => registry.get("not.installed")); });
