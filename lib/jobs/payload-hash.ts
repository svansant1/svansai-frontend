import { createHash } from "node:crypto";
/** JSONB may reorder keys; queue bindings must survive a storage round trip. */
export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalPayload).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ":" + canonicalPayload((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
export function hashJobPayload(value: unknown): string { return createHash("sha256").update(canonicalPayload(value)).digest("hex"); }
