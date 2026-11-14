import { snapshotPath, validateSnapshotText } from "./scope";

export const LAB_LIMITS = {
  requestBytes: 196_608, files: 50, fileBytes: 32_768, totalBytes: 131_072,
  wallTimeMs: 60_000, outputBytes: 65_536, memoryMb: 512, cpus: 1, pids: 64,
  workspaceMb: 64, approvalsMinutes: 15, activePerUser: 3, runsPerDay: 20,
} as const;
export type LabProfile = "python" | "node";
export type SnapshotFile = { path: string; content: string };
export type LabRequest = { profile: LabProfile; mode: "script" | "tests"; purpose: string; entrypoint: string; files: SnapshotFile[] };
export type LabPolicy = {
  version: 1; image: string; network: "none"; hostWrites: false; runtime: "runsc";
  wallTimeMs: number; outputBytes: number; memoryMb: number; cpus: number; pids: number; workspaceMb: number;
};
export type LabEnvelope = { request: LabRequest; policy: LabPolicy };
export type LabReport = {
  requestHash: string; image: string; profile: LabProfile;
  status: "exited" | "timed_out" | "cancelled" | "output_limit" | "infrastructure_error";
  exitCode: number | null; stdout: string; stderr: string; outputTruncated: boolean;
  durationMs: number; cleanupConfirmed: boolean; oomKilled: boolean;
};

export function parseLabRequest(value: unknown): LabRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a lab request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["profile", "mode", "purpose", "entrypoint", "files"].includes(key))) throw new Error("Lab requests cannot add commands, environment variables, mounts, or network settings.");
  if (input.profile !== "python" && input.profile !== "node") throw new Error("Select Python Data Lab or JavaScript Code Lab.");
  if (input.mode !== "script" && input.mode !== "tests") throw new Error("Select script or tests mode.");
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  if (!purpose || purpose.length > 1000) throw new Error("Describe the run in 1–1000 characters.");
  const entrypoint = snapshotPath(input.entrypoint);
  if (input.profile === "python" ? !entrypoint.endsWith(".py") : !/\.(js|mjs|cjs)$/.test(entrypoint)) throw new Error("Entrypoint must match the selected runtime.");
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > LAB_LIMITS.files) throw new Error("Submit 1–50 selected text files.");
  const seen = new Set<string>();
  let bytes = 0;
  const files = input.files.map((item): SnapshotFile => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid snapshot file.");
    if (Object.keys(item).some((key) => !["path", "content"].includes(key))) throw new Error("Only file path and text are accepted.");
    const path = snapshotPath(item.path), content = validateSnapshotText(item.content);
    if (seen.has(path.toLowerCase())) throw new Error("Duplicate or case-ambiguous snapshot path.");
    seen.add(path.toLowerCase());
    const size = new TextEncoder().encode(content).byteLength;
    bytes += size;
    if (size > LAB_LIMITS.fileBytes || bytes > LAB_LIMITS.totalBytes) throw new Error("Snapshot exceeds the per-file or combined byte limit.");
    return { path, content };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const file of files) {
    if (files.some((other) => other.path !== file.path && other.path.toLowerCase().startsWith(file.path.toLowerCase() + "/"))) throw new Error("A snapshot path cannot be both a file and a directory.");
  }
  if (!files.some((file) => file.path === entrypoint)) throw new Error("Entrypoint is missing from the snapshot.");
  return { profile: input.profile, mode: input.mode, purpose, entrypoint, files };
}
