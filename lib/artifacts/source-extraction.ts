import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { AttachedFile } from "@/lib/ai/file-types";

const MAX_SOURCE_CHARACTERS = 100_000;
const MAX_WORKBOOK_CELLS = 50_000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

type SourceResult = {
  extractedText?: string;
  limitations?: string;
  error?: string;
};

function boundedText(text: string, limitations?: string): SourceResult {
  if (text.length > MAX_SOURCE_CHARACTERS) {
    return { error: "The source exceeds 100,000 text characters. Split it into smaller files; no partial source was exported." };
  }
  if (!text.trim()) return { error: "The source contains no readable text." };
  return { extractedText: text, ...(limitations ? { limitations } : {}) };
}

/** Values are quoted literally; formulas, cached results and links remain source data. */
function workbookCellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  // Retain structured cell content instead of silently dropping formulas or links.
  return JSON.stringify(value);
}

async function extractWorkbook(bytes: Buffer): Promise<SourceResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  let cellCount = 0;
  let characterCount = 0;
  let hasValues = false;
  const chunks: string[] = [];
  const append = (text: string) => {
    characterCount += text.length;
    if (characterCount > MAX_SOURCE_CHARACTERS) {
      throw new Error("The workbook exceeds 100,000 source text characters. Split it into smaller files; no partial source was exported.");
    }
    chunks.push(text);
  };
  for (const sheet of workbook.worksheets) {
    // Use full used dimensions, not actualRowCount (which excludes sparse rows).
    cellCount += sheet.rowCount * sheet.columnCount;
    if (cellCount > MAX_WORKBOOK_CELLS) {
      return { error: "The workbook exceeds 50,000 cells across its used sheet ranges. Split it into smaller files; no partial source was exported." };
    }
    append(`SHEET: ${JSON.stringify(sheet.name)} (${sheet.rowCount} rows, ${sheet.columnCount} columns)\n`);
    for (let row = 1; row <= sheet.rowCount; row++) {
      const values: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = workbookCellText(sheet.getRow(row).getCell(column).value);
        if (value) hasValues = true;
        values.push('"' + value.replace(/"/g, '""') + '"');
      }
      append(values.join(",") + "\n");
    }
    append("\n");
  }
  if (!hasValues) return { error: "The workbook contains no readable cell values." };
  return boundedText(chunks.join(""), "All sheet cell values are supplied as text, including hidden sheets and cells. Workbook styling, charts, images, merged-cell layout and formula recalculation are not preserved.");
}

/**
 * Bounded export input, never an analysis summary or a silently sliced sample.
 * Office/PDF extraction is text-only; no OCR, model request or network call.
 */
export async function extractArtifactSource(file: AttachedFile): Promise<SourceResult> {
  try {
    if (!file.base64 || file.base64.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) {
      return { error: "The source is empty or exceeds the 25 MB attachment limit." };
    }
    const bytes = Buffer.from(file.base64, "base64");
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) {
      return { error: "The source is empty or exceeds the 25 MB attachment limit." };
    }
    if (/\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return await extractWorkbook(bytes);
    }
    if (/\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer: bytes });
      return boundedText(result.value, "Word document body text only. Layout, styling, embedded objects, headers and footers are not preserved.");
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        if (pdf.numPages > 100) return { error: "The PDF exceeds 100 pages. Split it into smaller files; no partial source was exported." };
        const result = await extractText(pdf, { mergePages: false });
        if (result.text.some((page) => !page.trim())) {
          return { error: "At least one PDF page has no readable embedded text. Provide a text-based version; no OCR or partial export was performed." };
        }
        return boundedText(result.text.join("\n\n"), "PDF embedded text only, in extraction order. Images, visual layout and text inside images are not preserved.");
      } finally {
        await pdf.destroy();
      }
    }
    if (file.type.startsWith("text/") || file.type === "application/csv" || file.type === "application/json" || /\.(csv|tsv|txt|md|markdown|json|log|xml|yaml|yml)$/i.test(file.name)) {
      // Fatal decoding rejects binary/mislabelled inputs rather than replacing bytes.
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\u0000")) return { error: "The source is not readable UTF-8 text. Please provide a text-based version." };
      return boundedText(text);
    }
    return { error: "This source type is not supported for file generation. Use UTF-8 text/CSV/TSV, DOCX, XLSX or a text-based PDF." };
  } catch (error) {
    if (error instanceof Error && /exceeds 100,000 source text characters/.test(error.message)) {
      return { error: error.message };
    }
    return { error: "The source could not be fully read. Check that it is a valid, unencrypted file; no partial source was exported." };
  }
}
