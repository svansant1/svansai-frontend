import { parseArtifactReference } from "./references";
import type { StoredArtifactReference } from "@/lib/jobs/types";
type StoredMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  filePreview?: string;
  fileName?: string;
  fileType?: string;
  artifactReference?: StoredArtifactReference;
};
const PREFIX = "[[SVANS_SAVED_ATTACHMENT_V1]]\n";
const REFERENCE_PREFIX = "[[SVANS_SAVED_ARTIFACT_V2]]\n";
const MESSAGE_PREFIX = "[[SVANS_MESSAGE_V3]]\n";
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const MAX_ENCODED = 14 * 1024 * 1024;
const mimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
function validFile(value: Partial<StoredMessage>) {
  if (
    typeof value.fileType !== "string" ||
    !mimeTypes.has(value.fileType) ||
    typeof value.fileName !== "string" ||
    value.fileName.length > 200 ||
    typeof value.filePreview !== "string" ||
    value.filePreview.length > MAX_ENCODED
  )
    return false;
  const prefix = `data:${value.fileType};base64,`;
  const payload = value.filePreview.slice(prefix.length);
  return (
    value.filePreview.startsWith(prefix) &&
    payload.length > 0 &&
    payload.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  );
}
/** Preserve downloads in the existing private conversation content column; no schema migration. */
export function encodeStoredMessage(message: StoredMessage): string {
  if (message.role === "assistant" && message.artifactReference) {
    const reference = parseArtifactReference(message.artifactReference);
    return REFERENCE_PREFIX + JSON.stringify({ content: message.content, artifactReference: reference, ...(validId(message.id) ? { id: message.id } : {}) });
  }
  if (message.role !== "assistant" || !validFile(message))
    return validId(message.id) ? MESSAGE_PREFIX + JSON.stringify({ id: message.id, content: message.content }) : message.content;
  return (
    PREFIX +
    JSON.stringify({
      content: message.content,
      filePreview: message.filePreview,
      fileName: message.fileName,
      fileType: message.fileType,
    })
  );
}
/** Decode before building prompts, speaking text or displaying conversation history. */
export function decodeStoredMessage(message: {
  role: string;
  content: string;
}): StoredMessage {
  const base: StoredMessage = {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  };
  if (base.content.startsWith(MESSAGE_PREFIX)) {
    try {
      if (base.content.length > 200_000) throw new Error("Saved message exceeds its limit.");
      const value = JSON.parse(base.content.slice(MESSAGE_PREFIX.length));
      if (!validId(value.id) || typeof value.content !== "string") throw new Error("Invalid saved message.");
      return { ...base, id: value.id, content: value.content };
    } catch { return { ...base, content: "This saved message could not be decoded. Its original database record has not been deleted." }; }
  }
  if (base.role === "assistant" && base.content.startsWith(REFERENCE_PREFIX)) {
    try {
      if (base.content.length > 102_000) throw new Error("Saved reference is too large.");
      const value = JSON.parse(base.content.slice(REFERENCE_PREFIX.length));
      if (typeof value.content !== "string" || value.content.length > 100_000) throw new Error("Invalid saved content.");
      return { role: "assistant", content: value.content, artifactReference: parseArtifactReference(value.artifactReference), ...(validId(value.id) ? { id: value.id } : {}) };
    } catch { return { role: "assistant", content: "This saved file reference could not be restored. The original private file has not been deleted." }; }
  }
  if (base.role !== "assistant" || !base.content.startsWith(PREFIX))
    return base;
  try {
    if (base.content.length > MAX_ENCODED + 100_000)
      throw new Error("Saved attachment too large.");
    const value = JSON.parse(base.content.slice(PREFIX.length));
    if (typeof value.content !== "string" || !validFile(value))
      throw new Error("Invalid saved attachment.");
    return {
      role: "assistant",
      content: value.content,
      filePreview: value.filePreview,
      fileName: value.fileName,
      fileType: value.fileType,
    };
  } catch {
    return {
      role: "assistant",
      content:
        "This saved attachment could not be restored. Please regenerate the file.",
    };
  }
}
