import assert from "node:assert/strict";
import test from "node:test";
import { resolveCyberAccess } from "../lib/ai/cyber-mode";
import { cyberEnabled } from "../lib/auth/owner-session";

test("Cyber Lab is disabled unless explicitly enabled", () => {
  const previous = process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED;
  try {
    delete process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED;
    assert.equal(cyberEnabled(), false);
    process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED = "0";
    assert.equal(cyberEnabled(), false);
    process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED = "1";
    assert.equal(cyberEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED;
    else process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED = previous;
  }
});
for (const gate of ["requested", "ownerVerified", "ownerSessionUnlocked", "featureEnabled"] as const) {
  test("Cyber Lab cannot activate when " + gate + " is false", () => {
    const input = { requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true, [gate]: false };
    assert.equal(resolveCyberAccess(input).active, false);
  });
}
test("all explicit Cyber Lab gates are required together", () => {
  assert.equal(resolveCyberAccess({ requested: true, ownerVerified: true, ownerSessionUnlocked: true, featureEnabled: true }).active, true);
});
