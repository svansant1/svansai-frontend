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
    ownerSessionUnlocked: true,
    featureEnabled: true,
  });

  assert.equal(result.active, false);
  assert.match(cyberModeDenialReason(result), /verified owner/i);
});

test("a verified owner still cannot activate cyber mode before sv unlock", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: true,
    ownerSessionUnlocked: false,
    featureEnabled: true,
  });

  assert.equal(result.active, false);
  assert.match(cyberModeDenialReason(result), /sv unlock/i);
});

test("the verified unlocked owner can activate admin cyber mode", () => {
  const result = resolveCyberAccess({
    requested: true,
    ownerVerified: true,
    ownerSessionUnlocked: true,
    featureEnabled: true,
  });

  assert.equal(result.active, true);
  assert.equal(result.scope, "owner_authorized");
  assert.equal(result.depth, "expert");
});

test("owner status and unlock do not activate the mode unless requested", () => {
  const result = resolveCyberAccess({
    requested: false,
    ownerVerified: true,
    ownerSessionUnlocked: true,
    featureEnabled: true,
  });

  assert.equal(result.active, false);
});
