import test from "node:test";
import assert from "node:assert/strict";
import { parseLabRequest, LAB_LIMITS } from "../lib/execution/contracts";
import { snapshotPath, validateSnapshotText } from "../lib/execution/scope";
import { prepareLab, labHash, validateApprovedLab } from "../lib/execution/client";

const request = { profile: "node", mode: "tests", purpose: "Reproduce one failure", entrypoint: "test/auth.test.mjs", files: [{ path: "test/auth.test.mjs", content: "import test from 'node:test'; test('sample', () => {});" }] };
test("lab scope rejects host paths, secrets and ambiguous files", () => {
  for (const path of ["../secret", "C:/secret", "/etc/passwd", "a\\b", ".env", "sub/.git/config", "NUL.txt", "a/../x", "id_rsa", "key.pem"]) assert.throws(() => snapshotPath(path), path);
  assert.throws(() => validateSnapshotText("-----BEGIN PRIVATE KEY-----"));
  assert.throws(() => parseLabRequest({ ...request, network: "host" }));
  assert.throws(() => parseLabRequest({ ...request, files: [...request.files, { path: "test/AUTH.test.mjs", content: "" }] }));
  assert.throws(() => parseLabRequest({ ...request, files: [{ path: request.entrypoint, content: "x".repeat(LAB_LIMITS.fileBytes + 1) }] }));
});
test("approval binds code, exact filenames and runtime digest", () => {
  const previous = process.env.SVANSAI_LAB_NODE_IMAGE;
  try {
    process.env.SVANSAI_LAB_NODE_IMAGE = "svans/node@sha256:" + "1".repeat(64);
    const envelope = prepareLab(request), hash = labHash(envelope);
    assert.deepEqual(validateApprovedLab(envelope, hash), envelope);
    assert.deepEqual(validateApprovedLab({ policy: envelope.policy, request: envelope.request }, hash), envelope);
    assert.throws(() => validateApprovedLab({ ...envelope, request: { ...envelope.request, mode: "script" } }, hash));
    process.env.SVANSAI_LAB_NODE_IMAGE = "svans/node@sha256:" + "2".repeat(64);
    assert.throws(() => validateApprovedLab(envelope, hash));
  } finally { if (previous === undefined) delete process.env.SVANSAI_LAB_NODE_IMAGE; else process.env.SVANSAI_LAB_NODE_IMAGE = previous; }
});
