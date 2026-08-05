const { spawn } = require("node:child_process");

const APP_URL = "http://127.0.0.1:3000";

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: options.stdio || "inherit",
    shell: process.platform === "win32",
    windowsHide: false,
    env: { ...process.env, ...options.env },
  });
}

async function waitFor(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return true;
    } catch {
      // Wait for Next.js.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function main() {
  const next = run("npm", ["run", "dev"], {
    env: { SVANSAI_DESKTOP_DEV: "1" },
  });

  const ready = await waitFor(APP_URL);
  if (!ready) {
    next.kill();
    throw new Error("Next.js dev server did not become ready.");
  }

  const electron = run("npx", ["electron", "desktop/main.cjs"], {
    env: {
      SVANSAI_DESKTOP_DEV: "1",
      SVANSAI_DESKTOP_URL: APP_URL,
    },
  });

  electron.once("exit", (code) => {
    next.kill();
    process.exit(code ?? 0);
  });

  process.once("SIGINT", () => {
    electron.kill();
    next.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
