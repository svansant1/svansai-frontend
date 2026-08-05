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
    target: ["nsis"],
  },
};
