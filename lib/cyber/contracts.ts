import { LAB_LIMITS } from "@/lib/execution/contracts";
import type { CyberJobBinding } from "@/lib/jobs/cyber-context";
import type { JobRecord, JobResult } from "@/lib/jobs/types";
export const CYBER_LIMITS = LAB_LIMITS;
export type CyberRunRequest = { targetId: string; exerciseId: string; projectId: string; conversationId: string; contextRevision: number };
export type CyberPolicy = {
  version: 1; scannerImage: string; fixtureImage: string; network: "fixture-loopback-only";
  runtime: "runsc"; hostWrites: false; wallTimeMs: number; outputBytes: number;
  memoryMb: number; cpus: number; pids: number;
};
export type CyberEnvelope = { request: CyberRunRequest; policy: CyberPolicy; binding: CyberJobBinding };
export type CyberRunReport = {
  runId: string; requestHash: string; exerciseId: string; targetId: string;
  targetDescription: string; status: "exited" | "cancelled" | "timed_out" | "output_limit" | "infrastructure_error";
  stdout: string; stderr: string; exitCode: number | null; durationMs: number;
  outputTruncated: boolean; cleanupConfirmed: boolean;
};
export type CyberJob = Omit<JobRecord, "payload" | "result" | "kind"> & {
  kind: "cyber"; payload: CyberEnvelope; approval_expires_at: string; approved_at: string | null;
  result: (JobResult & { cyber: CyberRunReport }) | null;
};
export function parseCyberRunRequest(value: unknown): CyberRunRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a catalog run request.");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !["targetId", "exerciseId", "projectId", "conversationId", "contextRevision"].includes(k))) throw new Error("Catalog runs cannot accept commands, addresses, images, environment variables, mounts, or authorization fields.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (r.targetId !== "training-http-fixture-v1" || r.exerciseId !== "http-headers-v1" ||
    typeof r.projectId !== "string" || !uuid.test(r.projectId) || typeof r.conversationId !== "string" || !uuid.test(r.conversationId) ||
    !Number.isSafeInteger(r.contextRevision) || Number(r.contextRevision) < 0) throw new Error("Unknown catalog exercise or invalid investigation revision.");
  return { targetId: r.targetId, exerciseId: r.exerciseId, projectId: r.projectId, conversationId: r.conversationId, contextRevision: Number(r.contextRevision) };
}
