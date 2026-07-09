import type { AttachedFile } from "@/lib/ai/file-types";

type OcrSpaceParsedResult = {
  ParsedText?: string;
};

type OcrSpaceResponse = {
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ParsedResults?: OcrSpaceParsedResult[];
};

function formatOcrError(error: unknown): string {
  if (Array.isArray(error)) return error.join(" ");
  if (typeof error === "string") return error;
  return "OCR provider returned an error.";
}

export async function extractPdfTextWithOcr(file: AttachedFile): Promise<{
  text?: string;
  error?: string;
}> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    return {
      error:
        "No embedded text was found. OCR is not configured yet; set OCR_SPACE_API_KEY or upload the relevant PDF pages as images.",
    };
  }

  try {
    const form = new FormData();
    form.append("apikey", apiKey);
    form.append("language", "eng");
    form.append("OCREngine", "2");
    form.append("isOverlayRequired", "false");
    form.append("scale", "true");
    form.append("base64Image", `data:application/pdf;base64,${file.base64}`);

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      return { error: `OCR provider request failed with HTTP ${response.status}.` };
    }

    const data = (await response.json()) as OcrSpaceResponse;
    if (data.IsErroredOnProcessing) {
      return { error: formatOcrError(data.ErrorMessage) };
    }

    const text = (data.ParsedResults ?? [])
      .map((result) => result.ParsedText ?? "")
      .join("\n\n")
      .replace(/\u0000/g, "")
      .trim()
      .slice(0, 60_000);

    return text ? { text } : { error: "OCR completed but no readable text was returned." };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "OCR failed unexpectedly.",
    };
  }
}
