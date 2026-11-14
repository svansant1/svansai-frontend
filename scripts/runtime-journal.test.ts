// Deferred verification fixtures: do not run before the full implementation pass is complete.
import test from "node:test";
import assert from "node:assert/strict";
import { runCapability } from "../lib/platform/capabilities/runner";
import type { CapabilityDefinition, ExecutionEvent } from "../lib/platform/capabilities/contracts";
import { readBoundedJson, RequestBodyError } from "../lib/api/bounded-json";
const capability: CapabilityDefinition<string, string> = { id: "sample.read", version: 1, name: "Read",
  inputs: ["text"], outputs: ["text"], permissions: [], sideEffects: "none", validation: "Text checked",
  available: () => ({ available: true }), parse: (value) => String(value), execute: async (value) => value, validate: () => {} };

test("journal acknowledgement precedes execution and records validation", async () => {
  const seen: string[] = [], events: ExecutionEvent[] = [];
  const output = await runCapability({ ...capability, execute: async (value) => { seen.push("execute"); return value; } }, "hello",
    { requestId: "unit", permissions: new Set(), events, onEvent: async (event) => { seen.push(event.state); } });
  assert.equal(output, "hello");
  assert.deepEqual(seen, ["started", "execute", "validating", "completed"]);
});

test("journal failure prevents execution", async () => {
  let ran = false;
  await assert.rejects(() => runCapability({ ...capability, execute: async () => { ran = true; return ""; } }, "hello",
    { requestId: "unit", permissions: new Set(), events: [], onEvent: async () => { throw new Error("storage offline"); } }));
  assert.equal(ran, false);
});

test("body limit applies without trusting Content-Length", async () => {
  const request = new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ input: "x".repeat(1000) }) });
  await assert.rejects(() => readBoundedJson(request, 100), (error: unknown) => error instanceof RequestBodyError && error.status === 413);
});
