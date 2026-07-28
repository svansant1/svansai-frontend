export type GeneratedImageResult = {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  revisedPrompt?: string;
};

const DEFAULT_IMAGE_MODEL = "gpt-image-1";

function normalizePrompt(message: string) {
  return message
    .replace(
      /^\s*(please\s+)?(generate|create|make|draw|design|render|produce)\s+(me\s+)?/i,
      "",
    )
    .replace(/^\s*(an?|some)\s+/i, "")
    .trim();
}

function imageFileNameFromPrompt(prompt: string, mimeType: string) {
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "png";
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "generated-image";

  return `${slug}.${extension}`;
}

export function isImageGenerationRequest(message: string): boolean {
  const normalized = message.toLowerCase().trim();

  if (/^\s*(can|could|would|will|do|does|is|are)\b/i.test(message)) {
    return false;
  }

  return (
    /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/i.test(
      message,
    ) ||
    /\b(show me|give me)\b.{0,40}\b(photo|image|picture|illustration)\b/i.test(
      normalized,
    )
  );
}

export function buildImagePrompt(message: string): string {
  const prompt = normalizePrompt(message);

  return `
${prompt}

Create a high-quality image that follows the user's request. If the user asks for a photo, make it photorealistic. Do not add text, captions, watermarks, or logos unless the user explicitly asks for them.
`.trim();
}

export async function generateImageWithOpenAI(
  message: string,
): Promise<GeneratedImageResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildImagePrompt(message);
  const model =
    process.env.SVANSAI_IMAGE_MODEL ||
    process.env.OPENAI_IMAGE_MODEL ||
    DEFAULT_IMAGE_MODEL;
  const outputFormat =
    process.env.SVANSAI_IMAGE_FORMAT === "jpeg" ||
    process.env.SVANSAI_IMAGE_FORMAT === "webp"
      ? process.env.SVANSAI_IMAGE_FORMAT
      : "png";
  const mimeType =
    outputFormat === "jpeg"
      ? "image/jpeg"
      : outputFormat === "webp"
        ? "image/webp"
        : "image/png";

  try {
    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          size: process.env.SVANSAI_IMAGE_SIZE || "1024x1024",
          quality: process.env.SVANSAI_IMAGE_QUALITY || "auto",
          output_format: outputFormat,
          n: 1,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "OPENAI_IMAGE_GENERATION_HTTP_ERROR:",
        response.status,
        await response.text(),
      );
      return null;
    }

    const data = await response.json();
    const image = data?.data?.[0];
    const base64 =
      typeof image?.b64_json === "string"
        ? image.b64_json.replace(/\s/g, "")
        : "";

    if (!base64) return null;

    return {
      base64,
      mimeType,
      fileName: imageFileNameFromPrompt(prompt, mimeType),
      revisedPrompt:
        typeof image?.revised_prompt === "string"
          ? image.revised_prompt
          : undefined,
    };
  } catch (error) {
    console.error("OPENAI_IMAGE_GENERATION_ERROR:", error);
    return null;
  }
}

export function formatGeneratedImageResponse(result: GeneratedImageResult) {
  const marker = `[[SVANS_IMAGE:${result.mimeType}:${result.fileName}:${result.base64}]]`;
  const note = result.revisedPrompt
    ? `\n\nPrompt used: ${result.revisedPrompt}`
    : "";

  return `Done — I generated the image.${note}\n\n${marker}`;
}
