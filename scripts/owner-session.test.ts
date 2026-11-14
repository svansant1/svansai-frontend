import assert from "node:assert/strict";
import test from "node:test";
import { grantIsCurrent, OWNER_IDLE_MS } from "../lib/auth/owner-grant";
import { stripSecretMessages } from "../lib/ai/secret-messages";

test("idle deadline locks exactly at thirty minutes, not thirty minutes of active use", () => {
  const grant = { id: "grant", userId: "owner", lastActivityAt: new Date(0).toISOString(), idleLocksAt: new Date(OWNER_IDLE_MS).toISOString(), revision: 1 };
  assert.equal(grantIsCurrent(grant, OWNER_IDLE_MS - 1), true);
  assert.equal(grantIsCurrent(grant, OWNER_IDLE_MS), false);
  const active = { ...grant, lastActivityAt: new Date(4 * OWNER_IDLE_MS).toISOString(), idleLocksAt: new Date(5 * OWNER_IDLE_MS).toISOString() };
  assert.equal(grantIsCurrent(active, 4 * OWNER_IDLE_MS + 1), true);
});

test("legacy password exchange is excluded from future prompts and storage", () => {
  const messages = [
    { role: "assistant", content: "Enter owner password:" },
    { role: "user", content: "test-secret-only-not-a-real-password" },
    { role: "assistant", content: "Owner mode enabled." },
    { role: "user", content: "Review this result." },
  ];
  assert.equal(stripSecretMessages(messages).some(m => m.content.includes("test-secret")), false);
  assert.equal(stripSecretMessages([{ role: "user", content: "hidden", isPassword: true }]).length, 0);
  assert.equal(stripSecretMessages(messages).at(-1)?.content, "Review this result.");
});
