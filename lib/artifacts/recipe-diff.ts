export type RecipeReplacement = { op: "replace"; path: string; value: unknown };

/** Minimal explicit replacements for the optional editor; untouched recipe fields are preserved. */
export function recipeDifferences(previous: unknown, edited: unknown): RecipeReplacement[] {
  const result: RecipeReplacement[] = [];
  const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
  function visit(before: unknown, after: unknown, path: string, depth: number): void {
    if (depth > 12) throw new Error("The edit is nested too deeply.");
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (!before || !after || typeof before !== "object" || typeof after !== "object" ||
        Array.isArray(before) !== Array.isArray(after) || (Array.isArray(before) && before.length !== (after as unknown[]).length)) {
      if (!path) throw new Error("The recipe must remain an object.");
      result.push({ op: "replace", path, value: after });
    } else {
      const original = before as Record<string, unknown>, modified = after as Record<string, unknown>;
      if (Object.keys(original).length !== Object.keys(modified).length ||
          Object.keys(modified).some((key) => !Object.prototype.hasOwnProperty.call(original, key))) {
        if (!path) throw new Error("Keep the existing top-level fields. This editor replaces existing content.");
        result.push({ op: "replace", path, value: after });
      } else for (const key of Object.keys(original)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Reserved recipe field.");
        visit(original[key], modified[key], path + "/" + escape(key), depth + 1);
      }
    }
    if (result.length > 50) throw new Error("This edit changes too many separate fields. Split it into smaller revisions.");
  }
  visit(previous, edited, "", 0);
  return result;
}
