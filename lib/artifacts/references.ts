import type { StoredArtifactReference } from "@/lib/jobs/types";

export const ARTIFACT_MIME_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown",
} as const;

/** Metadata is untrusted even when restored from chat history; access still needs server auth. */
export function parseArtifactReference(value: unknown): StoredArtifactReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved-file reference.");
  const ref = value as Record<string, unknown>;
  const format = ref.format as keyof typeof ARTIFACT_MIME_TYPES;
  if (typeof ref.id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ref.id) ||
      !Object.prototype.hasOwnProperty.call(ARTIFACT_MIME_TYPES, format) || ref.mimeType !== ARTIFACT_MIME_TYPES[format] ||
      typeof ref.name !== "string" || !ref.name || ref.name.length > 200 || /[\u0000-\u001f\u007f\\/]/.test(ref.name) ||
      typeof ref.size !== "number" || !Number.isInteger(ref.size) || ref.size < 1 || ref.size > 8 * 1024 * 1024 ||
      typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(ref.sha256)) throw new Error("Invalid saved-file reference.");
  return { id: ref.id, name: ref.name, format, mimeType: ARTIFACT_MIME_TYPES[format], size: ref.size, sha256: ref.sha256.toLowerCase() };
}
