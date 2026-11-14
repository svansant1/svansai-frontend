import { createHash } from "node:crypto";
import { parseCyberBinding, type CyberJobBinding } from "@/lib/jobs/cyber-context";
import { cyberPolicy } from "./catalog";
import { parseCyberRunRequest, type CyberEnvelope } from "./contracts";
export function canonicalCyber(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalCyber).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalCyber((value as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(value);
}
export function cyberHash(envelope: CyberEnvelope) { return createHash("sha256").update(canonicalCyber(envelope)).digest("hex"); }
export function prepareCyber(value: unknown, rawBinding: CyberJobBinding): CyberEnvelope {
  const request = parseCyberRunRequest(value), binding = parseCyberBinding(rawBinding, "cyber.exercise");
  if (request.projectId !== binding.context.projectId || request.conversationId !== binding.context.conversationId || request.contextRevision !== binding.context.revision) throw new Error("Investigation changed. Refresh and request approval again.");
  return { request, binding, policy: cyberPolicy() };
}
export function validateApprovedCyber(value: CyberEnvelope, expectedHash: string): CyberEnvelope {
  const current = prepareCyber(value.request, value.binding);
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || canonicalCyber(value) !== canonicalCyber(current) || cyberHash(current) !== expectedHash) throw new Error("Catalog, images, grant, or payload changed. Fresh approval required.");
  return current;
}
