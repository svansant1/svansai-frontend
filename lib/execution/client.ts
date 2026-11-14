import { createHash } from "node:crypto";
import { LAB_LIMITS, parseLabRequest, type LabEnvelope, type LabPolicy, type LabProfile, type LabReport } from "./contracts";

export interface LabClient {
  run(envelope: LabEnvelope, expectedHash: string, signal: AbortSignal): Promise<LabReport>;
}
/** JSONB may reorder object keys; approval hashes must survive storage round trips. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function pinnedImage(profile: LabProfile, env = process.env): string {
  const image = env[profile === "python" ? "SVANSAI_LAB_PYTHON_IMAGE" : "SVANSAI_LAB_NODE_IMAGE"] || "";
  if (!/^(?:[a-z0-9][a-z0-9./:_-]{0,200}@)?sha256:[0-9a-f]{64}$/.test(image)) throw new Error("Lab images must be configured by immutable digest or full image content ID.");
  return image;
}
export function labPolicy(profile: LabProfile): LabPolicy {
  return { version: 1, image: pinnedImage(profile), network: "none", hostWrites: false, runtime: "runsc",
    wallTimeMs: LAB_LIMITS.wallTimeMs, outputBytes: LAB_LIMITS.outputBytes, memoryMb: LAB_LIMITS.memoryMb,
    cpus: LAB_LIMITS.cpus, pids: LAB_LIMITS.pids, workspaceMb: LAB_LIMITS.workspaceMb };
}
export function prepareLab(value: unknown): LabEnvelope {
  const request = parseLabRequest(value);
  return { request, policy: labPolicy(request.profile) };
}
export function labHash(envelope: LabEnvelope): string {
  return createHash("sha256").update(canonical(envelope)).digest("hex");
}
/** Reconstruct trusted policy on the execution host; a configuration change voids approval. */
export function validateApprovedLab(value: LabEnvelope, expectedHash: string): LabEnvelope {
  if (!value || typeof value !== "object") throw new Error("Invalid lab envelope.");
  const current = prepareLab(value.request);
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || canonical(value) !== canonical(current) || labHash(current) !== expectedHash) {
    throw new Error("Code, files, or runtime policy changed after approval. Request a fresh approval.");
  }
  return current;
}
