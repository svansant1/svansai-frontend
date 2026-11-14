const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { DESKTOP_CAPABILITIES } = require("./capabilities.cjs");
const { resolveWorkspacePath, isSensitivePath, isTrustedSender, safeExternalUrl, readOnlyGitArgs, resolveGitExecutable, gitEnvironment } = require("./security.cjs");
const trustedWebContents = new Set();
const activeCommands = new Set();
let workspaceGeneration = 0;

const IS_DEV = process.env.SVANSAI_DESKTOP_DEV === "1" || !app.isPackaged;
const APP_PORT = Number(process.env.SVANSAI_DESKTOP_PORT || 3187);
const APP_URL =
  process.env.SVANSAI_DESKTOP_URL ||
  (IS_DEV ? "http://127.0.0.1:3000" : "https://svansai-frontend.onrender.com");
const MAX_TREE_ENTRIES = 2500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const DEFAULT_IGNORES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "dist-desktop",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "__pycache__",
]);
const SEARCH_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const workspaceState = {
  root: null,
  mode: "none",
  expiresAt: null,
};

let nextProcess = null;

function nowIso() {
  return new Date().toISOString();
}

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

async function appendAudit(event) {
  const auditPath = userDataPath("svansai-desktop-audit.jsonl");
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(
    auditPath,
    `${JSON.stringify({ at: nowIso(), ...event })}\n`,
    "utf8",
  );
}

function createDecision(action, allowed, reason, extra = {}) {
  return {
    id: crypto.randomUUID(),
    at: nowIso(),
    action,
    allowed,
    reason,
    ...extra,
  };
}

function isExpired() {
  return (
    workspaceState.expiresAt !== null && Date.now() > workspaceState.expiresAt
  );
}

function requireWorkspace(action, { write = false } = {}) {
  if (!workspaceState.root || workspaceState.mode === "none" || isExpired()) {
    workspaceState.root = null;
    workspaceState.mode = "none";
    workspaceState.expiresAt = null;
    return createDecision(
      action,
      false,
      "No active workspace permission. Select a folder first.",
    );
  }

  if (write && workspaceState.mode !== "trusted") {
    return createDecision(
      action,
      false,
      "Write access requires trusted workspace permission.",
    );
  }

  return createDecision(action, true, "Workspace permission active.", {
    workspaceRoot: workspaceState.root,
    mode: workspaceState.mode,
  });
}

function safeResolveInside(root, target = "") {
  return resolveWorkspacePath(root, target, { allowMissing: true });
}

async function scanTree(root, options = {}) {
  const maxEntries = Math.min(
    Number(options.maxEntries || MAX_TREE_ENTRIES),
    MAX_TREE_ENTRIES,
  );
  const entries = [];
  const queue = [{ absolute: root, relative: "" }];

  while (queue.length > 0 && entries.length < maxEntries) {
    const current = queue.shift();
    let children = [];

    try {
      children = await fs.readdir(resolveWorkspacePath(root, current.relative), { withFileTypes: true });
    } catch (error) {
      entries.push({
        path: current.relative || ".",
        type: "error",
        error: error.message,
      });
      continue;
    }

    for (const child of children) {
      if (entries.length >= maxEntries) break;
      if (DEFAULT_IGNORES.has(child.name)) continue;

      const relative = path.join(current.relative, child.name);
      if (isSensitivePath(relative) || child.isSymbolicLink()) continue;
      let absolute;
      try { absolute = resolveWorkspacePath(root, relative); } catch { continue; }

      if (child.isDirectory()) {
        entries.push({ path: relative, type: "directory" });
        queue.push({ absolute, relative });
      } else if (child.isFile()) {
        const stat = await fs.stat(absolute);
        entries.push({
          path: relative,
          type: "file",
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  return {
    root,
    entries,
    truncated: entries.length >= maxEntries || queue.length > 0,
    ignored: Array.from(DEFAULT_IGNORES),
  };
}

async function readAuditTail(limit = 100) {
  const auditPath = userDataPath("svansai-desktop-audit.jsonl");
  try {
    const content = await fs.readFile(auditPath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.min(Math.max(Number(limit) || 100, 1), 500))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { malformed: true, line };
        }
      });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function searchWorkspace(root, query, options = {}) {
  const needle = String(query || "").trim();
  if (!needle) {
    return { query: needle, results: [], searchedFiles: 0, truncated: false };
  }

  const maxResults = Math.min(
    Math.max(Number(options.maxResults || 100), 1),
    250,
  );
  const maxFiles = Math.min(Math.max(Number(options.maxFiles || 800), 1), 2000);
  const insensitive = options.caseSensitive !== true;
  const normalizedNeedle = insensitive ? needle.toLowerCase() : needle;
  const tree = await scanTree(root, { maxEntries: maxFiles * 3 });
  const results = [];
  let searchedFiles = 0;

  for (const entry of tree.entries) {
    if (results.length >= maxResults || searchedFiles >= maxFiles) break;
    if (entry.type !== "file") continue;
    const extension = path.extname(entry.path).toLowerCase();
    if (!SEARCH_EXTENSIONS.has(extension)) continue;
    if (entry.size && entry.size > MAX_SEARCH_FILE_BYTES) continue;

    try {
      const absolute = safeResolveInside(root, entry.path);
      const content = await fs.readFile(absolute, "utf8");
      searchedFiles += 1;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const haystack = insensitive
          ? lines[index].toLowerCase()
          : lines[index];
        if (haystack.includes(normalizedNeedle)) {
          results.push({
            path: entry.path,
            line: index + 1,
            preview: lines[index].trim().slice(0, 240),
          });
          if (results.length >= maxResults) break;
        }
      }
    } catch {
      // Skip files that cannot be decoded as UTF-8 text.
    }
  }

  return {
    query: needle,
    results,
    searchedFiles,
    truncated: results.length >= maxResults || tree.truncated,
  };
}

function runCommand(payload = {}, action = "command.run") {
  const decision = requireWorkspace(action);
  if (!decision.allowed) return Promise.resolve(decision);

  const args = readOnlyGitArgs(action, payload);
  if (!args) return Promise.resolve(createDecision(action, false, "General commands require an isolated Code Lab runtime. Folder access alone does not authorize host command execution."));
  let command, cwd;
  try {
    cwd = resolveWorkspacePath(workspaceState.root, ".");
    command = resolveGitExecutable(workspaceState.root);
  } catch (error) { return Promise.resolve(createDecision(action, false, error.message)); }
  if (activeCommands.size >= 2) return Promise.resolve(createDecision(action, false, "Wait for an active Git inspection to finish."));

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: gitEnvironment(),
      detached: process.platform !== "win32",
    });
    activeCommands.add(child);
    let stdout = "";
    let stderr = "";
    const limit = 80_000;
    let stopped = false;
    let settled = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid && process.platform === "win32") {
        const killer = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill(); } }
    };
    const timeout = setTimeout(stop, 20_000);
    const revokeCheck = setInterval(() => { if (isExpired() || workspaceState.root !== cwd || workspaceState.mode === "none") stop(); }, 250);
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(revokeCheck);
      activeCommands.delete(child);
      try { await appendAudit({ type: action, decision: { ...decision, allowed: result.allowed }, exitCode: result.exitCode, stopped }); }
      catch { return resolve({ ...result, allowed: false, reason: "Inspection finished but its audit record could not be saved." }); }
      resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > limit) { stdout = stdout.slice(0, limit); stop(); }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > limit) { stderr = stderr.slice(0, limit); stop(); }
    });
    child.once("error", async (error) => {
      const blocked = createDecision(action, false, error.message, {
        command,
        args,
      });
      await finish(blocked);
    });
    child.once("close", async (code) => {
      const result = {
        ...decision,
        allowed: !stopped,
        reason: stopped ? "Git inspection stopped: timeout, revoked access, or output limit. Results are incomplete." : decision.reason,
        command,
        args,
        cwd,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      };
      await finish(result);
    });
  });
}

async function waitForServer(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return true;
    } catch {
      // Server is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startNextServer() {
  if (IS_DEV || nextProcess || !APP_URL.includes(`127.0.0.1:${APP_PORT}`)) return;

  const appRoot = app.getAppPath();
  const nextBin = path.join(
    appRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const fallbackBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const command = fsSync.existsSync(nextBin) ? nextBin : fallbackBin;

  nextProcess = spawn(
    process.execPath,
    [command, "start", "-p", String(APP_PORT)],
    {
      cwd: fsSync.existsSync(nextBin) ? appRoot : process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(APP_PORT),
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );

  nextProcess.once("exit", () => {
    nextProcess = null;
  });
}

async function createWindow() {
  startNextServer();
  if (!IS_DEV && APP_URL.includes(`127.0.0.1:${APP_PORT}`)) {
    await waitForServer(APP_URL);
  }

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "SVANS-AI Desktop",
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contentsId = win.webContents.id;
  trustedWebContents.add(contentsId);
  win.webContents.once("destroyed", () => trustedWebContents.delete(contentsId));
  win.webContents.on("will-navigate", (event, url) => {
    try { if (new URL(url).origin !== new URL(APP_URL).origin) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    try {
      if (!contents || contents.isDestroyed() || !trustedWebContents.has(contents.id) || !details.isMainFrame || new URL(contents.getURL()).origin !== new URL(APP_URL).origin || !["media", "display-capture"].includes(permission)) return callback(false);
      const requestedUrl = contents.getURL();
      const result = await dialog.showMessageBox(win, { type: "question", buttons: ["Deny", "Allow once"], defaultId: 0, cancelId: 0, message: "Allow this live input?", detail: `SVANS-AI requested ${permission}. Only allow it when you started a voice, camera or screen session.` });
      callback(result.response === 1 && !contents.isDestroyed() && contents.getURL() === requestedUrl && trustedWebContents.has(contents.id));
    } catch { callback(false); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(APP_URL);
}

function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event, APP_URL, trustedWebContents)) throw new Error("Untrusted desktop IPC sender.");
    return listener(event, ...args);
  });
}

app.whenReady().then(async () => {
  await appendAudit({
    type: "desktop.started",
    appVersion: app.getVersion(),
    platform: process.platform,
  });
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("before-quit", async () => {
  if (nextProcess) nextProcess.kill();
  await appendAudit({ type: "desktop.stopped" });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

handle("svans:desktop:status", async () => {
  return {
    desktop: true,
    platform: process.platform,
    arch: process.arch,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    homeDir: os.homedir(),
    appPath: app.getAppPath(),
    auditPath: userDataPath("svansai-desktop-audit.jsonl"),
    workspace: { ...workspaceState, expired: isExpired() },
  };
});

handle("svans:capabilities:list", async () => {
  return {
    generatedAt: nowIso(),
    capabilities: DESKTOP_CAPABILITIES,
    counts: DESKTOP_CAPABILITIES.reduce((acc, capability) => {
      acc[capability.status] = (acc[capability.status] || 0) + 1;
      return acc;
    }, {}),
  };
});

handle("svans:audit:read", async (_event, options = {}) => {
  const events = await readAuditTail(options.limit || 100);
  return {
    ...createDecision("audit.read", true, "Audit log read."),
    events,
    auditPath: userDataPath("svansai-desktop-audit.jsonl"),
  };
});

handle("svans:workspace:select", async (_event, options = {}) => {
  const mode = options.mode === "trusted" ? "trusted" : "read";
  const requestedTtl = Number(options.ttlMinutes);
  const ttlMinutes = Math.min(
    Math.max(Number.isFinite(requestedTtl) ? requestedTtl : 120, 5),
    720,
  );
  const result = await dialog.showOpenDialog({
    title: mode === "trusted" ? "Select a workspace: reading plus individually approved writes" : "Select a read-only SVANS-AI workspace",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    const decision = createDecision(
      "workspace.select",
      false,
      "Folder selection was canceled.",
    );
    await appendAudit({ type: "workspace.select.canceled", decision });
    return decision;
  }

  workspaceGeneration += 1;
  workspaceState.root = fsSync.realpathSync(result.filePaths[0]);
  workspaceState.mode = mode;
  workspaceState.expiresAt = Date.now() + ttlMinutes * 60 * 1000;

  const decision = createDecision(
    "workspace.select",
    true,
    `Granted ${mode} access to selected workspace.`,
    { workspaceRoot: workspaceState.root, mode, ttlMinutes },
  );
  await appendAudit({ type: "workspace.select.granted", decision });
  return decision;
});

handle("svans:workspace:clear", async () => {
  workspaceGeneration += 1;
  const previous = { ...workspaceState };
  workspaceState.root = null;
  workspaceState.mode = "none";
  workspaceState.expiresAt = null;
  const decision = createDecision(
    "workspace.clear",
    true,
    "Workspace permission cleared.",
    { previous },
  );
  await appendAudit({ type: "workspace.clear", decision });
  return decision;
});

handle("svans:workspace:tree", async (_event, options = {}) => {
  const decision = requireWorkspace("workspace.tree");
  if (!decision.allowed) return decision;

  const tree = await scanTree(workspaceState.root, options);
  await appendAudit({
    type: "workspace.tree",
    decision,
    entryCount: tree.entries.length,
    truncated: tree.truncated,
  });
  return { ...decision, tree };
});

handle("svans:workspace:summary", async () => {
  const decision = requireWorkspace("workspace.summary");
  if (!decision.allowed) return decision;

  const tree = await scanTree(workspaceState.root, { maxEntries: 1200 });
  const fileCount = tree.entries.filter(
    (entry) => entry.type === "file",
  ).length;
  const directoryCount = tree.entries.filter(
    (entry) => entry.type === "directory",
  ).length;
  const totalBytes = tree.entries.reduce(
    (sum, entry) => sum + (entry.type === "file" ? entry.size || 0 : 0),
    0,
  );
  const extensions = {};
  for (const entry of tree.entries) {
    if (entry.type !== "file") continue;
    const extension = path.extname(entry.path).toLowerCase() || "[none]";
    extensions[extension] = (extensions[extension] || 0) + 1;
  }

  const summary = {
    root: workspaceState.root,
    mode: workspaceState.mode,
    fileCount,
    directoryCount,
    totalBytes,
    topExtensions: Object.entries(extensions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([extension, count]) => ({ extension, count })),
    truncated: tree.truncated,
  };

  await appendAudit({ type: "workspace.summary", decision, summary });
  return { ...decision, summary };
});

handle("svans:workspace:search", async (_event, payload = {}) => {
  const decision = requireWorkspace("workspace.search");
  if (!decision.allowed) return decision;

  const search = await searchWorkspace(
    workspaceState.root,
    payload.query,
    payload,
  );
  await appendAudit({
    type: "workspace.search",
    decision,
    query: search.query,
    resultCount: search.results.length,
    searchedFiles: search.searchedFiles,
  });
  return { ...decision, search };
});

handle("svans:file:read", async (_event, relativePath) => {
  const decision = requireWorkspace("file.read");
  if (!decision.allowed) return decision;

  try {
    const absolute = safeResolveInside(workspaceState.root, relativePath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      return createDecision("file.read", false, "Path is not a file.");
    }
    if (stat.size > MAX_FILE_BYTES) {
      return createDecision(
        "file.read",
        false,
        `File is too large for direct desktop read (${stat.size} bytes).`,
      );
    }
    const content = await fs.readFile(absolute, "utf8");
    await appendAudit({
      type: "file.read",
      decision,
      relativePath,
      size: stat.size,
    });
    return { ...decision, relativePath, content, size: stat.size };
  } catch (error) {
    return createDecision("file.read", false, error.message, { relativePath });
  }
});

handle("svans:file:preview-write", async (_event, payload = {}) => {
  const decision = requireWorkspace("file.previewWrite");
  if (!decision.allowed) return decision;

  try {
    const relativePath = String(payload.relativePath || "");
    const nextContent = String(payload.content ?? "");
    if (Buffer.byteLength(nextContent, "utf8") > MAX_FILE_BYTES) throw new Error("Proposed file exceeds the write size limit.");
    const absolute = safeResolveInside(workspaceState.root, relativePath);
    const exists = fsSync.existsSync(absolute);
    if (exists && (await fs.stat(absolute)).size > MAX_FILE_BYTES) throw new Error("Existing file exceeds the preview size limit.");
    const currentContent = exists ? await fs.readFile(absolute, "utf8") : "";
    const preview = {
      relativePath,
      exists,
      currentBytes: Buffer.byteLength(currentContent, "utf8"),
      nextBytes: Buffer.byteLength(nextContent, "utf8"),
      currentLines: currentContent ? currentContent.split(/\r?\n/).length : 0,
      nextLines: nextContent ? nextContent.split(/\r?\n/).length : 0,
      backupWillBeCreated: exists,
    };
    await appendAudit({ type: "file.previewWrite", decision, preview });
    return { ...decision, preview };
  } catch (error) {
    return createDecision("file.previewWrite", false, error.message, {
      relativePath: payload.relativePath,
    });
  }
});

handle("svans:file:write", async (_event, payload = {}) => {
  const decision = requireWorkspace("file.write", { write: true });
  if (!decision.allowed) return decision;

  try {
    const relativePath = String(payload.relativePath || "");
    const content = String(payload.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("Proposed file exceeds the write size limit.");
    const root = workspaceState.root;
    const generation = workspaceGeneration;
    const absolute = safeResolveInside(workspaceState.root, relativePath);
    const existed = fsSync.existsSync(absolute);
    if (existed && (await fs.stat(absolute)).size > MAX_FILE_BYTES) throw new Error("Existing file exceeds the write size limit.");
    const previous = existed ? await fs.readFile(absolute) : null;
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const approval = await dialog.showMessageBox(BrowserWindow.fromWebContents(_event.sender), {
      type: "warning", buttons: ["Cancel", "Approve this exact write"], defaultId: 0, cancelId: 0,
      message: `${existed ? "Replace" : "Create"} ${relativePath}?`,
      detail: `Workspace: ${root}\nNew bytes: ${Buffer.byteLength(content, "utf8")}\nContent SHA-256: ${hash}\n${existed ? "A backup of the existing file will be saved." : "This creates a new file."}\n\nPreview (first 600 characters):\n${content.slice(0, 600)}`,
    });
    if (approval.response !== 1) return createDecision("file.write", false, "The write was cancelled.");
    if (generation !== workspaceGeneration || workspaceState.root !== root || !requireWorkspace("file.write", { write: true }).allowed) throw new Error("Workspace permission changed; request a fresh approval.");
    resolveWorkspacePath(root, relativePath, { allowMissing: true });
    const existsNow = fsSync.existsSync(absolute);
    if (existsNow !== existed || (previous && !(await fs.readFile(absolute)).equals(previous))) throw new Error("The file changed while approval was open; review a fresh patch.");
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    resolveWorkspacePath(root, relativePath, { allowMissing: true });

    if (fsSync.existsSync(absolute)) {
      const backupPath = `${absolute}.svans-bak-${Date.now()}`;
      await fs.copyFile(absolute, backupPath);
    }

    await fs.writeFile(absolute, content, "utf8");
    await appendAudit({
      type: "file.write",
      decision,
      relativePath,
      bytes: Buffer.byteLength(content, "utf8"),
      approvedContentSha256: hash,
    });
    return {
      ...decision,
      relativePath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  } catch (error) {
    return createDecision("file.write", false, error.message, {
      relativePath: payload.relativePath,
    });
  }
});

handle("svans:command:run", async (_event, payload = {}) =>
  runCommand(payload, "command.run"),
);

handle("svans:git:status", async () =>
  runCommand({ command: "git", args: ["status", "--short"] }, "git.status"),
);

handle("svans:git:branch", async () =>
  runCommand(
    { command: "git", args: ["branch", "--show-current"] },
    "git.branch",
  ),
);

handle("svans:git:diff", async (_event, options = {}) =>
  runCommand(
    {
      command: "git",
      args: options.staged ? ["diff", "--staged"] : ["diff"],
    },
    options.staged ? "git.diff.staged" : "git.diff",
  ),
);

handle("svans:git:log", async (_event, options = {}) =>
  runCommand(
    {
      command: "git",
      args: [
        "log",
        "--oneline",
        `-${Math.min(Math.max(Number(options.limit || 10), 1), 50)}`,
      ],
    },
    "git.log",
  ),
);
