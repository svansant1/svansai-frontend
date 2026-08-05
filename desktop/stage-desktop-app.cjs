const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceDesktop = path.join(root, "desktop");
const stagedRoot = path.join(root, ".desktop-app");
const stagedDesktop = path.join(stagedRoot, "desktop");

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copyFile(name) {
  fs.copyFileSync(path.join(sourceDesktop, name), path.join(stagedDesktop, name));
}

resetDirectory(stagedRoot);
fs.mkdirSync(stagedDesktop, { recursive: true });

copyFile("main.cjs");
copyFile("preload.cjs");
copyFile("capabilities.cjs");

fs.writeFileSync(
  path.join(stagedRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "svans-ai-desktop",
      version: "0.1.0",
      description: "SVANS-AI desktop shell and local workspace bridge.",
      author: "Shawn Vansant",
      main: "desktop/main.cjs",
      private: true,
      dependencies: {},
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Staged desktop app at ${stagedRoot}`);
