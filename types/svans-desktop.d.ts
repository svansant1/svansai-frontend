export type DesktopWorkspaceMode = "none" | "read" | "trusted";

export type DesktopDecision = {
  id: string;
  at: string;
  action: string;
  allowed: boolean;
  reason: string;
  workspaceRoot?: string;
  mode?: DesktopWorkspaceMode;
  [key: string]: unknown;
};

export type DesktopCapability = {
  id: string;
  category: string;
  name: string;
  status: "available" | "configured" | "partial" | "planned";
  permission: string;
  description: string;
};

export type DesktopCapabilityList = {
  generatedAt: string;
  capabilities: DesktopCapability[];
  counts: Record<string, number>;
};

export type DesktopTreeEntry = {
  path: string;
  type: "directory" | "file" | "error";
  size?: number;
  modifiedAt?: string;
  error?: string;
};

export type DesktopTreeResult = DesktopDecision & {
  tree?: {
    root: string;
    entries: DesktopTreeEntry[];
    truncated: boolean;
    ignored: string[];
  };
};

export type DesktopStatus = {
  desktop: boolean;
  platform: string;
  arch: string;
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
  homeDir: string;
  appPath: string;
  auditPath: string;
  workspace: {
    root: string | null;
    mode: DesktopWorkspaceMode;
    expiresAt: number | null;
    expired: boolean;
  };
};

export type DesktopWorkspaceSummary = DesktopDecision & {
  summary?: {
    root: string;
    mode: DesktopWorkspaceMode;
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    topExtensions: Array<{ extension: string; count: number }>;
    truncated: boolean;
  };
};

export type DesktopWorkspaceSearchResult = DesktopDecision & {
  search?: {
    query: string;
    results: Array<{ path: string; line: number; preview: string }>;
    searchedFiles: number;
    truncated: boolean;
  };
};

export type DesktopReadFileResult = DesktopDecision & {
  relativePath?: string;
  content?: string;
  size?: number;
};

export type DesktopWriteFilePayload = {
  relativePath: string;
  content: string;
};

export type DesktopPreviewWriteResult = DesktopDecision & {
  preview?: {
    relativePath: string;
    exists: boolean;
    currentBytes: number;
    nextBytes: number;
    currentLines: number;
    nextLines: number;
    backupWillBeCreated: boolean;
  };
};

export type DesktopCommandPayload = {
  command: string;
  args?: string[];
  cwd?: string;
};

export type DesktopCommandResult = DesktopDecision & {
  command?: string;
  args?: string[];
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
};

declare global {
  interface Window {
    svansDesktop?: {
      status: () => Promise<DesktopStatus>;
      listCapabilities: () => Promise<DesktopCapabilityList>;
      readAudit: (options?: {
        limit?: number;
      }) => Promise<
        DesktopDecision & { events?: unknown[]; auditPath?: string }
      >;
      selectWorkspace: (options?: {
        mode?: "read" | "trusted";
        ttlMinutes?: number;
      }) => Promise<DesktopDecision>;
      clearWorkspace: () => Promise<DesktopDecision>;
      getWorkspaceTree: (options?: {
        maxEntries?: number;
      }) => Promise<DesktopTreeResult>;
      getWorkspaceSummary: () => Promise<DesktopWorkspaceSummary>;
      searchWorkspace: (payload: {
        query: string;
        maxResults?: number;
        maxFiles?: number;
        caseSensitive?: boolean;
      }) => Promise<DesktopWorkspaceSearchResult>;
      readFile: (relativePath: string) => Promise<DesktopReadFileResult>;
      previewWriteFile: (
        payload: DesktopWriteFilePayload,
      ) => Promise<DesktopPreviewWriteResult>;
      writeFile: (payload: DesktopWriteFilePayload) => Promise<DesktopDecision>;
      runCommand: (
        payload: DesktopCommandPayload,
      ) => Promise<DesktopCommandResult>;
      gitStatus: () => Promise<DesktopCommandResult>;
      gitBranch: () => Promise<DesktopCommandResult>;
      gitDiff: (options?: {
        staged?: boolean;
      }) => Promise<DesktopCommandResult>;
      gitLog: (options?: { limit?: number }) => Promise<DesktopCommandResult>;
    };
  }
}

export {};
