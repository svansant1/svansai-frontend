import assert from "node:assert/strict";
import test from "node:test";
import {
  cyberModeDenialReason,
  isAdminCyberModeEnabled,
  resolveCyberAccess,
} from "../lib/ai/cyber-mode";

test("admin cyber mode is disabled unless explicitly enabled", () => {
  assert.equal(isAdminCyberModeEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(
    isAdminCyberModeEnabled({
      SVANSAI_ADMIN_CYBER_MODE_ENABLED: "1",
    } as NodeJS.ProcessEnv),
    true,
  );
});

test("a non-owner cannot activate admin cyber mode", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: false,
    env: { SVANSAI_ADMIN_CYBER_MODE_ENABLED: "1" } as NodeJS.ProcessEnv,
  });

  assert.equal(result.active, false);
  assert.match(cyberModeDenialReason(result), /verified owner/i);
});

test("the verified owner can activate admin cyber mode when enabled", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: true,
    env: { SVANSAI_ADMIN_CYBER_MODE_ENABLED: "1" } as NodeJS.ProcessEnv,
  });

  assert.equal(result.active, true);
  assert.equal(result.scope, "owner_authorized");
  assert.equal(result.depth, "expert");
});

test("owner status alone does not activate the mode", () => {
  const result = resolveCyberAccess({
    requested: false,
    ownerVerified: true,
    env: { SVANSAI_ADMIN_CYBER_MODE_ENABLED: "1" } as NodeJS.ProcessEnv,
  });

  assert.equal(result.active, false);
});
