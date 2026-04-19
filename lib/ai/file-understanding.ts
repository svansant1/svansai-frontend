import type { AttachedFile } from "@/lib/ai/file-types";

export type FileUnderstandingResult = {
  kind: "image" | "pdf" | "text" | "code" | "unsupported";
  extractedText?: string;
  error?: string;
};

export async function understandAttachedFile(file: AttachedFile): Promise<FileUnderstandingResult> {
  if (file.type.startsWith("image/")) {
    return { kind: "image" };
  }

  if (file.type === "application/pdf") {
    // extract text here
    return { kind: "pdf", extractedText: "..." };
  }

  if (
    file.type.startsWith("text/") ||
    file.name.match(/\.(py|ts|tsx|js|jsx|java|c|cpp|cs|go|rb|rs|swift|kt|md|json)$/i)
  ) {
    const extractedText = Buffer.from(file.base64, "base64").toString("utf-8");
    return { kind: "text", extractedText };
  }

  return {
    kind: "unsupported",
    error: "Unsupported file type.",
  };
}