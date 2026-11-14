import type { ArtifactRequest } from "./types";
import { parseWorkbookSpec } from "./workbook-spec";
import { parseDocumentSpec, parseDeckSpec } from "./document-spec";
import { ProviderError } from "@/lib/ai/providers/outcomes";

export function stripArtifactFence(text: string): string {
  return text.trim().replace(/^```(?:json|csv|tsv|markdown|md|text)?\s*\n/i, "").replace(/\n```\s*$/, "");
}

/** Validate the model's data specification before selecting it as the successful draft. */
export function validateArtifactDraft(text: string, request: ArtifactRequest): void {
  const content = stripArtifactFence(text);
  if (!content || content.length > 100_000) throw new Error("Draft is empty or exceeds its content budget.");
  if (/^(?:I(?:'m| am) sorry|I cannot|I can't|Sorry,)/i.test(content)) {
    throw new ProviderError("PROVIDER_POLICY_REFUSAL", "The provider declined the requested content.");
  }
  if (!["xlsx", "docx", "pptx", "pdf"].includes(request.format)) return;
  const spec = JSON.parse(content);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Expected a native artifact specification.");
  if (typeof spec.unsupported === "string") return; // An explicit limitation is a valid response, not a file.
  if (request.format === "docx" && !parseDocumentSpec(content)) throw new Error("Invalid Word specification.");
  if (request.format === "pdf" && !parseDocumentSpec(content, "pdf")) throw new Error("Invalid PDF specification.");
  if (request.format === "pptx" && !parseDeckSpec(content)) throw new Error("Invalid presentation specification.");
  if (request.format === "xlsx") {
    const workbook = parseWorkbookSpec(spec);
    const instructions = request.prompt.split(/\n\s*(?:content|text|data)\s*:/i)[0];
    const requiresFormulas = /\b(interactive|formulas?|automatically|calculat(?:e|ion|ions))\b/i.test(instructions)
      && !/\b(?:without|no)\s+(?:any\s+)?formulas?\b/i.test(instructions);
    if (requiresFormulas && !workbook.sheets.some((sheet) => sheet.cells.some((cell) => cell.formula) || sheet.formulaFills?.length)) {
      throw new Error("The requested calculations were omitted; a static workbook is not a substitute.");
    }
  }
}
