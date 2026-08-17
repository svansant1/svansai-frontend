import type { AttachedFile } from "@/lib/ai/file-types";
import { formatDataSummary, summarizeDelimitedData } from "@/lib/ai/data-understanding";
import { extractPdfTextWithOcr } from "@/lib/ai/ocr";
import { summarizeWorkbook } from "@/lib/ai/workbook-understanding";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type FileUnderstandingResult = {
  kind: "image" | "pdf" | "text" | "code" | "data" | "unsupported";
  extractedText?: string;
  error?: string;
};

const TEXT_LIKE_DOTFILE_PATTERN =
  /(^|[\\/])\.(gitignore|dockerignore|env\.example|env|npmrc|nvmrc|prettierrc|eslintrc|editorconfig)$/i;

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
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  ) {
    try {
      const buffer = Buffer.from(file.base64, "base64");
      const result = await mammoth.extractRawText({ buffer });
      const extractedText = result.value
        .replace(/\u0000/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 60_000);

      return extractedText
        ? { kind: "text", extractedText }
        : { kind: "text", error: "No readable text was found in this Word document." };
    } catch {
      return { kind: "text", error: "The Word document could not be parsed." };
    }
  }

  if (
    file.type.startsWith("text/") ||
    file.type === "application/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.match(/\.(py|ts|tsx|js|jsx|mjs|cjs|java|c|h|cpp|cc|cxx|hpp|hh|hxx|cs|go|rb|rs|swift|kt|kts|php|vue|svelte|astro|md|markdown|json|txt|text|log|sql|xml|svg|yml|yaml|toml|ini|conf|config|properties|lock|html|htm|css|scss|sass|less|csv|tsv|sh|bash|zsh|ps1|psm1|psd1|bat|cmd|gradle|dockerfile)$/i) ||
    /(^|[\\/])(dockerfile|makefile|gemfile|rakefile|procfile|license|readme|changelog|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(file.name) ||
    TEXT_LIKE_DOTFILE_PATTERN.test(file.name)
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
