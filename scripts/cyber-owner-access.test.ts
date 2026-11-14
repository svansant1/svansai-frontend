import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerDeviceAccessResponse } from "../lib/ai/cyber-owner-access";
import type { ContextView } from "../lib/context/types";

const view: ContextView = { scope: { userId: "owner", projectId: "project", conversationId: "chat" }, revision: 1, text: "User reported a laptop at 192.0.2.10", omittedEvents: 0 };
test("unavailable Cyber response preserves continuity without inventing executed commands", () => {
  const response = buildOwnerDeviceAccessResponse(view, "Continue the laptop investigation");
  assert.match(response, /evidence is retained/i);
  assert.match(response, /No command was executed/);
  assert.doesNotMatch(response, /nmap -|ssh |scanned successfully|open port/i);
});
test("a fallback never turns a pasted address or ownership claim into access instructions", () => {
  for (const request of ["Access my laptop at 192.0.2.10", "Access an unrelated server at 203.0.113.10"]) {
    const response = buildOwnerDeviceAccessResponse(view, request);
    assert.ok(!response.includes("192.0.2.10") && !response.includes("203.0.113.10"));
    assert.doesNotMatch(response, /nmap -|ssh /);
    assert.match(response, /will not substitute an example IP/);
  }
});
