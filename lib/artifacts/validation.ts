import { ARTIFACT_MIME_TYPES } from "./references";
import type { GeneratedArtifact, ArtifactFormat, ArtifactKind } from "./types";
export function artifactKind(format: ArtifactFormat): ArtifactKind {
  return format === "docx" || format === "pdf" ? "document" : format === "xlsx" || format === "csv" ? "spreadsheet" : format === "pptx" ? "presentation" : "text";
}
export function validateGeneratedArtifact(artifact: GeneratedArtifact): Buffer {
  if (!Object.prototype.hasOwnProperty.call(ARTIFACT_MIME_TYPES, artifact.format) ||
      artifact.mimeType !== ARTIFACT_MIME_TYPES[artifact.format] || artifact.kind !== artifactKind(artifact.format) ||
      typeof artifact.name !== "string" || !artifact.name || artifact.name.length > 200 ||
      /[\u0000-\u001f\u007f\\/]/.test(artifact.name) || !artifact.name.toLowerCase().endsWith("." + artifact.format) ||
      typeof artifact.base64 !== "string" || artifact.base64.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.base64)) throw new Error("Invalid generated artifact.");
  const bytes = Buffer.from(artifact.base64, "base64");
  if (!bytes.length || bytes.length !== artifact.size || bytes.length > 8 * 1024 * 1024) throw new Error("Invalid artifact size.");
  if (["docx", "xlsx", "pptx"].includes(artifact.format) && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) throw new Error("Artifact is not a native Office package.");
  if (artifact.format === "pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Artifact is not a native PDF.");
  return bytes;
}
