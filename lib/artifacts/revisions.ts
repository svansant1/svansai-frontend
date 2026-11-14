import { generateArtifact } from "./artifact-generator";
import { parseDocumentSpec, parseDeckSpec } from "./document-spec";
import { parseWorkbookSpec } from "./workbook-spec";
import { readStoredArtifact, storeArtifact } from "./storage";
import { artifactKind } from "./validation";
import type { ArtifactFormat } from "./types";

type Replacement = { op: "replace"; path: string; value: unknown };
const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Explicit, bounded replacements on a private data recipe, never edits to arbitrary ZIP/XML. */
export function applyRecipeReplacements(source: string, raw: unknown, format: ArtifactFormat): string {
  if (source.length > 100_000 || !Array.isArray(raw) || !raw.length || raw.length > 50) throw new Error("Use 1–50 replacements within the recipe size limit.");
  const recipe = JSON.parse(source);
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid replacement.");
    const operation = candidate as Replacement;
    if (Object.keys(candidate).some((key) => !["op", "path", "value"].includes(key)) || operation.op !== "replace" ||
        !Object.prototype.hasOwnProperty.call(operation, "value") || typeof operation.path !== "string" ||
        !operation.path.startsWith("/") || operation.path.length > 400) throw new Error("Only explicit replace operations are supported.");
    const tokens = operation.path.slice(1).split("/").map((token) => {
      if (/~(?![01])/.test(token)) throw new Error("Invalid JSON pointer.");
      return token.replace(/~1/g, "/").replace(/~0/g, "~");
    });
    if (tokens.length > 12 || tokens.some((key) => !key || blockedKeys.has(key))) throw new Error("Invalid replacement path.");
    let target: Record<string, unknown> = recipe;
    for (const [index, key] of tokens.entries()) {
      if (!target || typeof target !== "object" || (Array.isArray(target) && !/^(?:0|[1-9]\d*)$/.test(key)) ||
          !Object.prototype.hasOwnProperty.call(target, key)) throw new Error("Replacement target does not exist.");
      if (index === tokens.length - 1) target[key] = operation.value;
      else target = target[key] as Record<string, unknown>;
    }
  }
  const content = JSON.stringify(recipe);
  if (content.length > 100_000) throw new Error("Revised recipe exceeds 100,000 characters.");
  if (format === "xlsx") parseWorkbookSpec(content);
  else if (format === "docx" || format === "pdf") {
    if (!parseDocumentSpec(content, format)) throw new Error("Expected a structured document recipe.");
  } else if (format === "pptx") {
    if (!parseDeckSpec(content)) throw new Error("Expected a structured presentation recipe.");
  } else throw new Error("This format does not support recipe revisions. Generate a new file instead.");
  return content;
}

export async function reviseStoredArtifact(userId: string, id: string, expectedHash: string, replacements: unknown) {
  const source = await readStoredArtifact(userId, id);
  if (source.reference.sha256 !== expectedHash) throw new Error("The selected file version has changed. Review the version before editing.");
  if (!source.sourceContent) throw new Error("This file has no editable SVANS recipe. Uploaded Office layouts are not rewritten through this endpoint.");
  const format = source.reference.format as ArtifactFormat;
  const content = applyRecipeReplacements(source.sourceContent, replacements, format);
  const result = await generateArtifact({ title: source.reference.name.replace(/\.[^.]+$/, ""), content, format, kind: artifactKind(format) });
  // Preserve the file name; the new immutable version ID distinguishes revisions.
  result.artifact.name = source.reference.name;
  return storeArtifact(userId, result.artifact, id);
}
