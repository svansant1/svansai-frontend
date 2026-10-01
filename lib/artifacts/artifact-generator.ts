import { randomUUID } from "node:crypto";

import { generateDocx } from "@/lib/artifacts/docx-generator";
import { generatePptx } from "@/lib/artifacts/pptx-generator";
import { generateXlsx } from "@/lib/artifacts/xlsx-generator";
import { safeCsv } from "./tabular-content";

import type {
  ArtifactFormat,
  ArtifactGenerationResult,
  ArtifactKind,
  GeneratedArtifact,
} from "@/lib/artifacts/types";

const MIME_TYPES: Record<ArtifactFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

/**
 * Sanitizes a user/model-generated title before using it as part of a
 * downloadable filename.
 *
 * This prevents path separators, control characters, and Windows-reserved
 * filename characters from becoming part of the generated artifact name.
 */
function safeFilenamePart(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return cleaned || "svans-ai";
}

/**
 * Creates a safe filename for the generated artifact.
 */
function defaultName(title: string, format: ArtifactFormat): string {
  return `${safeFilenamePart(title)}.${format}`;
}

/**
 * Converts a generated binary buffer into the common artifact structure
 * returned by SVANS-AI.
 */
function toArtifact(
  buffer: Buffer,
  title: string,
  format: ArtifactFormat,
  kind: ArtifactKind,
): GeneratedArtifact {
  return {
    id: randomUUID(),
    name: defaultName(title, format),
    format,
    kind,
    mimeType: MIME_TYPES[format],
    base64: buffer.toString("base64"),
    size: buffer.length,
  };
}

/**
 * Generates a downloadable SVANS-AI artifact.
 *
 * Binary formats are delegated to their dedicated generators. Text-based
 * formats are encoded directly as UTF-8 buffers.
 */
export async function generateArtifact(params: {
  title: string;
  content: string;
  format: ArtifactFormat;
  kind: ArtifactKind;
}): Promise<ArtifactGenerationResult> {
  const title = params.title.trim() || "SVANS-AI";
  const content = params.content.trim();
  if (title.length > 200 || content.length > 100_000)
    throw new Error("Document content exceeds its size limit.");

  if (!content) {
    throw new Error("Artifact content cannot be empty.");
  }

  let buffer: Buffer;

  switch (params.format) {
    case "docx":
      buffer = await generateDocx(title, content);
      break;

    case "xlsx":
      buffer = await generateXlsx(title, content);
      break;

    case "pptx":
      buffer = await generatePptx(title, content);
      break;

    case "csv":
      buffer = Buffer.from(safeCsv(content), "utf8");
      break;
    case "txt":
    case "md":
      buffer = Buffer.from(content, "utf8");
      break;

    default:
      throw new Error(`Unsupported artifact format: ${String(params.format)}`);
  }

  if (buffer.length > 8 * 1024 * 1024)
    throw new Error("The generated file exceeds 8 MB.");

  return {
    text: `I created ${defaultName(title, params.format)}.`,
    artifact: toArtifact(buffer, title, params.format, params.kind),
  };
}
