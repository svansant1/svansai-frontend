// Pure contract fixtures only. No Docker, images, workers or network are invoked.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCyberRunRequest, CYBER_LIMITS } from "../lib/cyber/contracts";
import { prepareCyber, cyberHash, validateApprovedCyber } from "../lib/cyber/approvals";
import type { CyberJobBinding } from "../lib/jobs/cyber-context";
const uuid = "00000000-0000-4000-a000-000000000001";
const request = { targetId: "training-http-fixture-v1", exerciseId: "http-headers-v1", projectId: uuid, conversationId: uuid, contextRevision: 4 };
const binding: CyberJobBinding = { version: 1, capability: "cyber.exercise", userId: uuid, grantId: uuid, grantRevision: 1, context: { projectId: uuid, conversationId: uuid, revision: 4 } };
test("arbitrary commands, targets, environment and mounts are rejected", () => {
  for (const key of ["command", "hostname", "ip", "mounts", "env", "image", "network", "grantId"]) assert.throws(() => parseCyberRunRequest({ ...request, [key]: "injected" }));
  assert.throws(() => parseCyberRunRequest({ ...request, targetId: "outside.example" }));
});
test("approval binds immutable images, exact context and containment policy", () => {
  const oldScanner = process.env.SVANSAI_CYBER_SCANNER_IMAGE, oldFixture = process.env.SVANSAI_CYBER_FIXTURE_IMAGE;
  try {
    process.env.SVANSAI_CYBER_SCANNER_IMAGE = "sha256:" + "a".repeat(64);
    process.env.SVANSAI_CYBER_FIXTURE_IMAGE = "sha256:" + "b".repeat(64);
    const e = prepareCyber(request, binding), hash = cyberHash(e);
    assert.deepEqual(validateApprovedCyber(JSON.parse(JSON.stringify(e)), hash), e);
    assert.throws(() => validateApprovedCyber({ ...e, policy: { ...e.policy, wallTimeMs: 999999 } }, hash));
    assert.throws(() => validateApprovedCyber(e, "0".repeat(64)));
    assert.throws(() => prepareCyber({ ...request, contextRevision: 5 }, binding));
    assert.equal(e.policy.network, "fixture-loopback-only"); assert.equal(e.policy.hostWrites, false);
    assert.equal(e.policy.wallTimeMs, CYBER_LIMITS.wallTimeMs); assert.equal(e.policy.outputBytes, 65536);
  } finally {
    if (oldScanner === undefined) delete process.env.SVANSAI_CYBER_SCANNER_IMAGE; else process.env.SVANSAI_CYBER_SCANNER_IMAGE = oldScanner;
    if (oldFixture === undefined) delete process.env.SVANSAI_CYBER_FIXTURE_IMAGE; else process.env.SVANSAI_CYBER_FIXTURE_IMAGE = oldFixture;
  }
});
