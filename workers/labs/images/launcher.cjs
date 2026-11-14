"use strict";
// This launcher is part of the immutable image, not supplied by generated code.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const chunks = [];
let inputBytes = 0;
process.stdin.on("data", (chunk) => {
  inputBytes += chunk.length;
  if (inputBytes > 196608) { process.stderr.write("Input limit exceeded"); process.exit(1); }
  chunks.push(chunk);
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(request.files) || request.files.length < 1 || request.files.length > 50) throw new Error("Invalid file count");
    const names = new Set();
    let total = 0;
    for (const file of request.files) {
      // Write a fresh temporary snapshot; host files are never mounted here.
      if (typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("\\") ||
          file.path.split("/").some((part) => !part || part === "." || part === "..") || names.has(file.path.toLowerCase())) throw new Error("Invalid path");
      names.add(file.path.toLowerCase());
      if (typeof file.content !== "string") throw new Error("Invalid content");
      const size = Buffer.byteLength(file.content); total += size;
      if (size > 32768 || total > 131072) throw new Error("Snapshot exceeds byte limit");
      const destination = path.join("/workspace", file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, file.content, { flag: "wx", mode: 0o600 });
    }
    if (!request.files.some((file) => file.path === request.entrypoint) || !/\.(js|mjs|cjs)$/.test(request.entrypoint)) throw new Error("Invalid entrypoint");
    if (!["script", "tests"].includes(request.mode)) throw new Error("Invalid mode");
    const entry = "./" + request.entrypoint;
    const args = request.mode === "tests" ? ["--test", entry] : [entry];
    const result = spawnSync("/usr/local/bin/node", args, { cwd: "/workspace", stdio: ["ignore", "inherit", "inherit"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", TZ: "UTC" } });
    process.exit(result.error || result.status === null ? 1 : result.status);
  } catch {
    process.stderr.write("Lab snapshot or launcher failed.\n");
    process.exit(1);
  }
});
