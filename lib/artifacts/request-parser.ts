import type {
  ArtifactFormat,
  ArtifactKind,
  ArtifactRequest,
} from "@/lib/artifacts/types";

const formats: Array<{
  format: ArtifactFormat;
  kind: ArtifactKind;
  pattern: RegExp;
}> = [
  {
    format: "docx",
    kind: "document",
    pattern: /\b(word (?:document|file)|docx|(?:in|into|as|to) (?:a )?word)\b/i,
  },
  {
    format: "xlsx",
    kind: "spreadsheet",
    pattern: /\b(excel|spreadsheet|workbook|xlsx)\b/i,
  },
  {
    format: "pptx",
    kind: "presentation",
    pattern: /\b(powerpoint|power point|presentation|slide deck|pptx)\b/i,
  },
  { format: "csv", kind: "spreadsheet", pattern: /\bcsv\b/i },
  { format: "md", kind: "text", pattern: /\b(markdown|md file)\b/i },
  { format: "txt", kind: "text", pattern: /\b(text file|txt file)\b/i },
];

/** Only explicit file-making commands route to generation; questions and refusals stay chat. */
export function detectArtifactRequest(message: string): ArtifactRequest | null {
  const instruction = message.split(/\n\s*(?:\n|(?:content|text|data)\s*:)/i)[0].trim();
  if (!instruction || /^(how|why|what|when|where)\b/i.test(instruction))
    return null;
  if (
    /\b(don't|do not|never|cannot|can't)\s+(?:\w+\s+){0,2}(create|make|generate|build|produce|turn|convert|export|put|save)\b/i.test(
      instruction,
    )
  )
    return null;
  if (
    !/\b(create|make|generate|build|produce|turn|convert|export|put|save|give|prepare|write)\b/i.test(
      instruction,
    )
  )
    return null;
  // A bare capability question has no subject matter or previous-content instruction.
  if (
    /^(can|could|do|are)\s+you\s+(?:able to\s+)?(?:create|make|generate|produce|export|write)\s+(?:(?:a|an|some)\s+)?(?:word documents?|excel (?:files?|spreadsheets?)|powerpoint(?: presentations?)?|documents?|spreadsheets?|presentations?)\s*\??$/i.test(
      instruction,
    )
  )
    return null;
  // A conversion names the input as well as the output: prefer an explicit
  // destination ("Word to PowerPoint"), otherwise the first format after the verb.
  const command = instruction.replace(
    /^[\s\S]*?\b(?:create|make|generate|build|produce|turn|convert|export|put|save|give|prepare|write)\b\s*/i,
    "",
  );
  const destination = command.match(
    /\b(?:to|into|as|in)\s+(?:(?:a|an|the|new|downloadable|editable|microsoft)\s+){0,3}(word(?:\s+(?:document|file))?|docx|excel|spreadsheet|workbook|xlsx|powerpoint|power point|presentation|slide deck|pptx|csv|markdown|md file|text file|txt file)\b/i,
  );
  const target = destination
    ? destination[1].replace(/^word$/i, "word document")
    : command.split(/\b(?:from|using|based on)\b/i)[0];
  const match = formats
    .map((item) => ({ item, index: target.search(item.pattern) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.item;
  if (!match) return null;
  return { format: match.format, kind: match.kind, prompt: message.trim() };
}
