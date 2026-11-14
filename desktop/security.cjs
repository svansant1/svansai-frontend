const path = require("node:path");
const fs = require("node:fs");

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function isSensitivePath(target) {
  const pieces = target.replace(/\\/g, "/").toLowerCase().split("/");
  return pieces.some((piece) => [".git", ".ssh", ".aws", ".azure", ".gnupg", ".npmrc", ".pypirc", "credentials", "credentials.json"].includes(piece)
    || /^\.env(?:\.|$)/.test(piece) && !/^\.env\.(?:example|sample|template)$/.test(piece)
    || /\.(?:pem|pfx|p12|key)$/.test(piece));
}
/** Reject links/junctions beneath the grant, alternate streams, devices and secret files. */
function resolveWorkspacePath(root, target = "", { allowMissing = false } = {}) {
  if (typeof target !== "string" || target.includes("\0")) throw new Error("Invalid workspace path.");
  const canonicalRoot = fs.realpathSync(root);
  const absolute = path.resolve(canonicalRoot, target);
  if (!isWithin(canonicalRoot, absolute)) throw new Error("Path escapes the approved workspace.");
  const relative = path.relative(canonicalRoot, absolute);
  const pieces = relative ? relative.split(path.sep) : [];
  if (isSensitivePath(relative)) throw new Error("Credential and internal repository files are excluded from workspace access.");
  let cursor = canonicalRoot;
  for (const piece of pieces) {
    if (process.platform === "win32" && (piece.includes(":") || /[. ]$/.test(piece) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece))) throw new Error("Unsupported Windows path.");
    cursor = path.join(cursor, piece);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("Links and junctions are not allowed inside a workspace grant.");
      if (!isWithin(canonicalRoot, fs.realpathSync(cursor))) throw new Error("Resolved path escapes the workspace.");
      if (stat.isFile() && stat.nlink > 1) throw new Error("Hard-linked files require a separate explicit access workflow.");
    } catch (error) {
      if (!allowMissing || error.code !== "ENOENT") throw error;
    }
  }
  return absolute;
}
function isTrustedSender(event, appUrl, trustedIds) {
  try {
    return trustedIds.has(event.sender.id) && event.senderFrame === event.sender.mainFrame
      && new URL(event.senderFrame.url).origin === new URL(appUrl).origin;
  } catch { return false; }
}
function safeExternalUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function readOnlyGitArgs(action, payload) {
  if (payload.command !== "git") return null;
  const args = payload.args ?? [];
  const exact = {
    "git.status": ["status", "--short"], "git.branch": ["branch", "--show-current"],
    "git.diff": ["diff"], "git.diff.staged": ["diff", "--staged"],
  };
  if (action === "git.log") {
    if (args.length !== 3 || args[0] !== "log" || args[1] !== "--oneline" || !/^-(?:[1-9]|[1-4][0-9]|50)$/.test(args[2])) return null;
  } else if (!exact[action] || JSON.stringify(args) !== JSON.stringify(exact[action])) return null;
  return ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=", "-c", "diff.external=", ...args,
    ...(action.startsWith("git.diff") ? ["--no-ext-diff", "--no-textconv"] : [])];
}
function resolveGitExecutable(workspace) {
  const metadata = path.join(workspace, ".git");
  if (!fs.existsSync(metadata) || !fs.lstatSync(metadata).isDirectory() || fs.lstatSync(metadata).isSymbolicLink()) throw new Error("Host inspection supports normal repositories only; linked or external Git metadata requires the isolated Code Lab.");
  const configPath = path.join(metadata, "config");
  if (fs.existsSync(configPath)) {
    const stat = fs.lstatSync(configPath);
    if (stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error("Git configuration cannot be safely inspected.");
    const config = fs.readFileSync(configPath, "utf8");
    if (/^\s*\[\s*(?:include|includeif|filter|alias)\b/im.test(config) || /^\s*worktree\s*=/im.test(config)) throw new Error("This repository uses configuration that requires isolated Git execution.");
  }
  const candidates = process.platform === "win32"
    ? [process.env.SVANSAI_GIT_EXECUTABLE, process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe"), process.env.ProgramW6432 && path.join(process.env.ProgramW6432, "Git", "cmd", "git.exe")]
    : [process.env.SVANSAI_GIT_EXECUTABLE, "/usr/bin/git", "/usr/local/bin/git"];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate)) continue;
    const resolved = fs.realpathSync(candidate);
    if (!isWithin(fs.realpathSync(workspace), resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new Error("A trusted Git executable outside the workspace is not configured.");
}
function gitEnvironment() {
  const env = { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "", LC_ALL: "C" };
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}
module.exports = { isWithin, isSensitivePath, resolveWorkspacePath, isTrustedSender, safeExternalUrl, readOnlyGitArgs, resolveGitExecutable, gitEnvironment };
