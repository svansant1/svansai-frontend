import type {
  ArtifactFormat,
  ArtifactKind,
  ArtifactRequest,
} from "@/lib/artifacts/types";

const CREATE_VERB = 
  /\b(create|make|generate|build|produce|turn|convert|export)\b/i;

const FORMAT_PATTERNS: Array<{
  format: ArtifactFormat;
  kind: ArtifactKind;
  pattern: RegExp;  
}> = [
  {
    format: "docx",
    kind: "document",
    pattern: /\b(word document|word file|docx)\b/i,
  },
  {
    format: "xlsx",
    kind: "spreadsheet",
    pattern: /\b(excel|excel worksheet|xlsx)\b/i,
  },
  {
    format: "pptx",
    kind: "presentation",
    pattern: /\b(powerpoint|power point|presentation|slide deck|pptx)\b/i,
  },
  {
    format: "csv",
    kind: "presentation",
    pattern: /\bcsv\b/i,
  },
  {
    format: "md",
    kind: "text",
    pattern: /\b(markdown|md file)\b/i,
  },
  {
    format: "txt",
    kind: "text",
    pattern: /\b(text file|txt file)\b/i,
  },
];

export function detectArtifactRequest(
  message: string,  
): ArtifactRequest | null {
  if (!message || !CREATE_VERB.test(message)) {
    return null;
  }

  const match = FORMAT_PATTERNS.find(({ pattern }) =>
    pattern.test(message),
  );

  if (!match) {
    return null;
  }

  return {
    format: match.format,
    kind: match.kind,
    prompt: message.trim(),
  };
}