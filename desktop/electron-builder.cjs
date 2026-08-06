module.exports = {
  appId: "com.vansantplatform.svansai",
  productName: "SVANS-AI Desktop",
  asar: true,
  directories: {
    app: ".desktop-app",
    output: "dist-desktop",
  },
  files: ["!node_modules/**/*", "desktop/**/*", "package.json"],
  win: {
    icon: "desktop/assets/svans-ai.ico",
    target: ["nsis"],
  },
  nsis: {
    installerIcon: "desktop/assets/svans-ai.ico",
    uninstallerIcon: "desktop/assets/svans-ai.ico",
  },
};
