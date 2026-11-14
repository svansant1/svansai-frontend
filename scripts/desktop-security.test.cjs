// Deferred tests. Do not execute during the code-update pass.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readOnlyGitArgs, safeExternalUrl, isSensitivePath, isTrustedSender } = require("../desktop/security.cjs");
test("generic command channel cannot impersonate the read-only Git channel", () => {
  assert.equal(readOnlyGitArgs("command.run", { command: "git", args: ["status", "--short"] }), null);
  assert.equal(readOnlyGitArgs("git.status", { command: "powershell", args: ["-Command", "anything"] }), null);
  assert.equal(readOnlyGitArgs("git.status", { command: "git", args: ["status", "--short", "--config=bad"] }), null);
  assert.ok(readOnlyGitArgs("git.status", { command: "git", args: ["status", "--short"] }));
});
test("dangerous external URL schemes cannot launch handlers", () => { for (const url of ["file:///C:/x", "javascript:alert(1)", "ms-settings:", "https://name:secret@example.com"]) assert.equal(safeExternalUrl(url), false); assert.equal(safeExternalUrl("https://example.com"), true); });
test("workspace excludes credentials while allowing example env files", () => { for (const name of [".env", "src/.env.local", ".ssh/id_rsa", "private.pem", ".git/config"]) assert.equal(isSensitivePath(name), true); assert.equal(isSensitivePath(".env.example"), false); });
test("only a registered top-level frame of the app origin can call desktop IPC", () => {
  const frame = { url: "https://svansai.com/" }; const sender = { id: 1, mainFrame: frame };
  assert.equal(isTrustedSender({ sender, senderFrame: frame }, "https://svansai.com", new Set([1])), true);
  assert.equal(isTrustedSender({ sender, senderFrame: { url: "https://svansai.com/" } }, "https://svansai.com", new Set([1])), false);
  assert.equal(isTrustedSender({ sender, senderFrame: frame }, "https://evil.example", new Set([1])), false);
});
