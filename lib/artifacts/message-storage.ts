type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  filePreview?: string;
  fileName?: string;
  fileType?: string;
};
const PREFIX = "[[SVANS_SAVED_ATTACHMENT_V1]]\n";
const MAX_ENCODED = 14 * 1024 * 1024;
const mimeTypes = new Set([
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
  if (message.role !== "assistant" || !validFile(message))
    return message.content;
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
