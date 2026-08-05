const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("svansDesktop", {
  status: () => invoke("svans:desktop:status"),
  listCapabilities: () => invoke("svans:capabilities:list"),
  readAudit: (options) => invoke("svans:audit:read", options),
  selectWorkspace: (options) => invoke("svans:workspace:select", options),
  clearWorkspace: () => invoke("svans:workspace:clear"),
  getWorkspaceTree: (options) => invoke("svans:workspace:tree", options),
  getWorkspaceSummary: () => invoke("svans:workspace:summary"),
  searchWorkspace: (payload) => invoke("svans:workspace:search", payload),
  readFile: (relativePath) => invoke("svans:file:read", relativePath),
  previewWriteFile: (payload) => invoke("svans:file:preview-write", payload),
  writeFile: (payload) => invoke("svans:file:write", payload),
  runCommand: (payload) => invoke("svans:command:run", payload),
  gitStatus: () => invoke("svans:git:status"),
  gitBranch: () => invoke("svans:git:branch"),
  gitDiff: (options) => invoke("svans:git:diff", options),
  gitLog: (options) => invoke("svans:git:log", options),
});
