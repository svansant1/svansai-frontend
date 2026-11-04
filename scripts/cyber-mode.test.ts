import assert from "node:assert/strict";
import test from "node:test";
import {
  cyberModeDenialReason,
  isAdminCyberModeEnabled,
  resolveCyberAccess,
} from "../lib/ai/cyber-mode";

test("admin cyber mode is disabled unless explicitly enabled", () => {
  assert.equal(isAdminCyberModeEnabled(undefined), false);
  assert.equal(isAdminCyberModeEnabled("1"), true);
  assert.equal(isAdminCyberModeEnabled("0"), false);
});

test("a non-owner cannot activate admin cyber mode", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: false,
    featureEnabled: true,
  });

  assert.equal(result.active, false);
  assert.match(cyberModeDenialReason(result), /verified owner/i);
});

test("the verified owner can activate admin cyber mode when enabled", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: true,
    featureEnabled: true,
  });

  assert.equal(result.active, true);
  assert.equal(result.scope, "owner_authorized");
  assert.equal(result.depth, "expert");
});

test("owner status alone does not activate the mode", () => {
  const result = resolveCyberAccess({
    requested: false,
    ownerVerified: true,
    featureEnabled: true,
  });

  assert.equal(result.active, false);
});
