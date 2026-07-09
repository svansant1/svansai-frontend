import type { AttachedFile } from "@/lib/ai/file-types";
import { formatDataSummary, summarizeDelimitedData } from "@/lib/ai/data-understanding";
import { extractPdfTextWithOcr } from "@/lib/ai/ocr";
import { summarizeWorkbook } from "@/lib/ai/workbook-understanding";
import { extractText, getDocumentProxy } from "unpdf";

export type FileUnderstandingResult = {
  kind: "image" | "pdf" | "text" | "code" | "data" | "unsupported";
  extractedText?: string;
  error?: string;
};

export async function understandAttachedFile(file: AttachedFile): Promise<FileUnderstandingResult> {
  if (file.type.startsWith("image/")) {
    return { kind: "image" };
  }

  if (file.type === "application/pdf") {
    try {
      const bytes = Uint8Array.from(Buffer.from(file.base64, "base64"));
      const pdf = await getDocumentProxy(bytes);
      if (pdf.numPages > 100) {
        return { kind: "pdf", error: "PDFs are limited to 100 pages per attachment." };
      }
      const result = await extractText(pdf, { mergePages: true });
      const extractedText = String(result.text).replace(/\u0000/g, "").trim().slice(0, 60_000);
      if (extractedText) return { kind: "pdf", extractedText };

      const ocr = await extractPdfTextWithOcr(file);
      return ocr.text
        ? { kind: "pdf", extractedText: `OCR text extracted from scanned PDF:\n\n${ocr.text}` }
        : { kind: "pdf", error: ocr.error ?? "No embedded text was found. This PDF may require OCR." };
    } catch {
      return { kind: "pdf", error: "The PDF could not be parsed." };
    }
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.xlsx$/i.test(file.name)
  ) {
    try {
      return { kind: "data", extractedText: await summarizeWorkbook(file.base64) };
    } catch {
      return { kind: "data", error: "The Excel workbook could not be parsed." };
    }
  }

  if (
    file.type.startsWith("text/") ||
    file.type === "application/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.match(/\.(py|ts|tsx|js|jsx|java|c|cpp|cs|go|rb|rs|swift|kt|md|json|csv|tsv)$/i)
  ) {
    const extractedText = Buffer.from(file.base64, "base64").toString("utf-8");
    if (
      file.type === "text/csv" ||
      file.type === "application/csv" ||
      file.type === "text/tab-separated-values" ||
      /\.(csv|tsv)$/i.test(file.name)
    ) {
      const summary = summarizeDelimitedData(extractedText, `${file.type} ${file.name}`);
      return summary
        ? { kind: "data", extractedText: formatDataSummary(summary) }
        : { kind: "data", extractedText: extractedText.slice(0, 20_000) };
    }
    return { kind: "text", extractedText };
  }

  return {
    kind: "unsupported",
    error: "Unsupported file type.",
  };
}
