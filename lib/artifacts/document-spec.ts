/** Data-only contracts: no executable code, remote assets, arbitrary XML or shape options. */
export type DocumentTheme = {
  accentColor?: string;
  fontFace?: "Aptos" | "Calibri" | "Arial";
};
export type NativeTable = { columns: string[]; rows: string[][] };
export type DocumentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets" | "numbered"; items: string[] }
  | ({ type: "table" } & NativeTable)
  | { type: "pageBreak" };
export type DocumentSpec = {
  version: 1;
  kind: "docx";
  title?: string;
  theme?: DocumentTheme;
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
  blocks: DocumentBlock[];
};
export type DeckSlide = {
  title: string;
  body?: string;
  bullets?: string[];
  table?: NativeTable;
  notes?: string;
};
export type DeckSpec = {
  version: 1;
  kind: "pptx";
  title?: string;
  theme?: DocumentTheme & { backgroundColor?: string; textColor?: string };
  slides: DeckSlide[];
};

export const DOCX_SPEC_INSTRUCTIONS = `Return ONLY one JSON object (no code fences) for a native Word document:
{"version":1,"kind":"docx","title":"Document title","theme":{"accentColor":"234E70","fontFace":"Aptos"},"header":"Optional short running header","footer":"Optional short footer","pageNumbers":true,"blocks":[{"type":"heading","level":1,"text":"Heading"},{"type":"paragraph","text":"Paragraph"},{"type":"bullets","items":["Item"]},{"type":"numbered","items":["Step"]},{"type":"table","columns":["Column 1","Column 2"],"rows":[["Value","Value"]]},{"type":"pageBreak"}]}
Use only these fields. Title/theme/header/footer/pageNumbers are optional. Heading levels are 1, 2, or 3. Use native tables and lists when appropriate. Keep titles <=160 characters and running headers/footers <=90. Tables have 1-8 columns and 1-200 rectangular body rows. At most 500 blocks, 200 items per list, 2000 characters per table cell, 10000 characters per prose block, and 100000 total JSON characters. Text is plain text, not markdown or HTML. Theme colors are six-digit hex without #; fonts are Aptos, Calibri, or Arial. No images, hyperlinks, URLs as asset sources, macros, scripts, raw XML, or unsupported fields. Preserve all requested content; never claim an attachment exists.`;

export const PPTX_SPEC_INSTRUCTIONS = `Return ONLY one JSON object (no code fences) for a native editable PowerPoint:
{"version":1,"kind":"pptx","title":"Deck title","theme":{"accentColor":"236B8E","backgroundColor":"FFFFFF","textColor":"172B4D","fontFace":"Aptos"},"slides":[{"title":"Short slide title","body":"Optional plain-text paragraph","bullets":["Point one","Point two"],"table":{"columns":["Column 1","Column 2"],"rows":[["Value","Value"]]},"notes":"Optional speaker notes"}]}
Use only these fields. Each explicit slide requires a concise title; body/bullets/table/notes and top-level title/theme are optional. Include a title slide explicitly if wanted. Aim for 3-5 concise points per slide; use notes for detail. Tables have 1-6 columns and 1-200 rectangular body rows. Titles <=120 characters (must fit two lines), notes/body <=10000 characters, cells <=2000 characters. At most 100 slides (including automatic overflow continuations), 200 bullets per slide, and 100000 total JSON characters. Text is plain text, not markdown or HTML. Colors are six-digit hex without #; fonts are Aptos, Calibri, or Arial. Text/background contrast must be legible. Content overflow continues on new slides; an unfit table row fails explicitly. No images, hyperlinks, URLs as asset sources, macros, scripts, arbitrary shapes, raw XML, or unsupported fields. Preserve all requested content; never claim an attachment exists.`;

function fail(path: string, detail: string): never {
  throw new Error(`Invalid document/deck specification at ${path}: ${detail}`);
}
function record(value: unknown, path: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unsupported field");
  }
  return result;
}
export function safeDocumentText(value: unknown, path: string, max = 10_000, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) {
    fail(path, `expected ${allowEmpty ? "" : "nonempty "}text of at most ${max} characters`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value as string)) {
    fail(path, "XML control characters are not supported");
  }
  for (const char of value as string) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) fail(path, "invalid Unicode surrogate");
  }
  return (value as string).replace(/\r\n?/g, "\n");
}
function array(value: unknown, path: string, max: number, min = 1): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(path, `expected ${min}-${max} entries`);
  }
  return value as unknown[];
}
function stringArray(value: unknown, path: string, max: number, textMax = 10_000): string[] {
  return array(value, path, max).map((item, i) => safeDocumentText(item, `${path}[${i}]`, textMax));
}
function table(value: unknown, path: string, maxColumns: number): NativeTable {
  const data = record(value, path, ["columns", "rows"]);
  const columns = stringArray(data.columns, `${path}.columns`, maxColumns, 200);
  const rows = array(data.rows, `${path}.rows`, 200).map((row, i) => {
    const cells = array(row, `${path}.rows[${i}]`, columns.length, columns.length);
    return cells.map((cell, j) => safeDocumentText(cell, `${path}.rows[${i}][${j}]`, 2000, true));
  });
  return { columns, rows };
}
function theme(value: unknown, deck: boolean): DeckSpec["theme"] {
  const colors = deck ? ["accentColor", "backgroundColor", "textColor"] : ["accentColor"];
  const data = record(value, "theme", [...colors, "fontFace"]);
  for (const color of colors) {
    if (data[color] !== undefined && (typeof data[color] !== "string" || !/^[0-9a-f]{6}$/i.test(data[color] as string))) {
      fail(`theme.${color}`, "expected six-digit hexadecimal color without #");
    }
  }
  if (data.fontFace !== undefined && !["Aptos", "Calibri", "Arial"].includes(data.fontFace as string)) {
    fail("theme.fontFace", "supported fonts are Aptos, Calibri, and Arial");
  }
  return data as DeckSpec["theme"];
}

/** JSON-looking content must validate; never export broken or unsafe JSON as ordinary prose. */
function structured(content: string): unknown | undefined {
  safeDocumentText(content, "content", 100_000);
  const trimmed = content.trim();
  if (!/^[{\[]|^```(?:json)?\s*[{\[]/i.test(trimmed)) return undefined;
  const source = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  try { return JSON.parse(source); }
  catch { fail("content", "malformed JSON"); }
}
export function parseDocumentSpec(content: string): DocumentSpec | undefined {
  const candidate = structured(content);
  if (candidate === undefined) return undefined;
  const data = record(candidate, "document", ["version", "kind", "title", "theme", "header", "footer", "pageNumbers", "blocks"]);
  if (data.version !== 1 || data.kind !== "docx") fail("document", 'expected version:1 and kind:"docx"');
  const result: DocumentSpec = { version: 1, kind: "docx", blocks: [] };
  if (data.title !== undefined) result.title = safeDocumentText(data.title, "title", 160);
  if (data.theme !== undefined) result.theme = theme(data.theme, false);
  for (const key of ["header", "footer"] as const) {
    if (data[key] !== undefined) {
      result[key] = safeDocumentText(data[key], key, 90);
      if (/\n/.test(result[key]!)) fail(key, "running header/footer must be a single line");
    }
  }
  if (data.pageNumbers !== undefined) {
    if (typeof data.pageNumbers !== "boolean") fail("pageNumbers", "expected a boolean");
    result.pageNumbers = data.pageNumbers as boolean;
  }
  result.blocks = array(data.blocks, "blocks", 500).map((value, i): DocumentBlock => {
    const path = `blocks[${i}]`;
    const block = record(value, path, ["type", "level", "text", "items", "columns", "rows"]);
    switch (block.type) {
      case "heading":
        record(block, path, ["type", "level", "text"]);
        if (![1, 2, 3].includes(block.level as number)) fail(`${path}.level`, "expected 1, 2, or 3");
        return { type: "heading", level: block.level as 1 | 2 | 3, text: safeDocumentText(block.text, `${path}.text`, 300) };
      case "paragraph":
        record(block, path, ["type", "text"]);
        return { type: "paragraph", text: safeDocumentText(block.text, `${path}.text`) };
      case "bullets": case "numbered":
        record(block, path, ["type", "items"]);
        return { type: block.type, items: stringArray(block.items, `${path}.items`, 200) };
      case "table":
        record(block, path, ["type", "columns", "rows"]);
        return { type: "table", ...table({ columns: block.columns, rows: block.rows }, path, 8) };
      case "pageBreak":
        record(block, path, ["type"]);
        return { type: "pageBreak" };
      default: return fail(`${path}.type`, "unsupported block type");
    }
  });
  return result;
}
export function parseDeckSpec(content: string): DeckSpec | undefined {
  const candidate = structured(content);
  if (candidate === undefined) return undefined;
  const data = record(candidate, "deck", ["version", "kind", "title", "theme", "slides"]);
  if (data.version !== 1 || data.kind !== "pptx") fail("deck", 'expected version:1 and kind:"pptx"');
  const result: DeckSpec = { version: 1, kind: "pptx", slides: [] };
  if (data.title !== undefined) result.title = safeDocumentText(data.title, "title", 160);
  if (data.theme !== undefined) result.theme = theme(data.theme, true);
  result.slides = array(data.slides, "slides", 100).map((value, i) => {
    const path = `slides[${i}]`;
    const slide = record(value, path, ["title", "body", "bullets", "table", "notes"]);
    const result: DeckSlide = { title: safeDocumentText(slide.title, `${path}.title`, 120) };
    if (slide.body !== undefined) result.body = safeDocumentText(slide.body, `${path}.body`);
    if (slide.bullets !== undefined) result.bullets = stringArray(slide.bullets, `${path}.bullets`, 200);
    if (slide.table !== undefined) result.table = table(slide.table, `${path}.table`, 6);
    if (slide.notes !== undefined) result.notes = safeDocumentText(slide.notes, `${path}.notes`);
    return result;
  });
  return result;
}
