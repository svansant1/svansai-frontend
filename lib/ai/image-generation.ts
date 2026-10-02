export type GeneratedImageResult = {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  revisedPrompt?: string;
};

const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

export function imageOutputOptions(message: string) {
  const transparent = /\btransparent(?:\s+background)?\b|\bremove\s+(?:the\s+)?background\b/i.test(message);
  const requestedFormat = /\b(?:as|format|file|in)\s+(?:an?\s+)?(png|jpe?g|webp)\b/i.exec(message)?.[1].toLowerCase();
  const configuredFormat = process.env.SVANSAI_IMAGE_FORMAT || "png";
  let outputFormat = (requestedFormat || configuredFormat).replace("jpg", "jpeg");
  if (!["png", "jpeg", "webp"].includes(outputFormat) || (transparent && outputFormat === "jpeg")) outputFormat = "png";
  const size = /\b(?:landscape|horizontal|wide)\b/i.test(message) ? "1536x1024"
    : /\b(?:portrait|vertical|tall)\b/i.test(message) ? "1024x1536"
    : /\bsquare\b/i.test(message) ? "1024x1024" : process.env.SVANSAI_IMAGE_SIZE || "1024x1024";
  const quality = /\bhigh[- ]quality\b/i.test(message) ? "high" : process.env.SVANSAI_IMAGE_QUALITY || "auto";
  return { size: ["1024x1024", "1536x1024", "1024x1536", "auto"].includes(size) ? size : "auto", quality: ["low", "medium", "high", "auto"].includes(quality) ? quality : "auto", output_format: outputFormat, background: transparent ? "transparent" : "auto" };
}

export function isImageEditingRequest(message: string): boolean {
  const text = message.replace(/^(?:(?:can|could|would|will) you\s+|please\s+)*/i, "").trim();
  return /^(?:edit|modify|change|transform|restyle|recolor)\s+(?:this|the|my|these|an?|attached|uploaded)\b[\s\S]*\b(?:image|photo|picture|logo|background)s?\b/i.test(text) || /^remove\s+(?:the\s+)?background\b/i.test(text);
}

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
  const normalized = message.toLowerCase().replace(/[’‘]/g, "'").trim();
  if (
    !normalized ||
    /\b(?:do not|don't|never|stop|avoid)\s+(?:please\s+)?(?:generate|create|make|draw|design|render|produce)\b/.test(
      normalized,
    )
  )
    return false;
  if (
    /\b(?:ability|capable|capabilities|able to)\b/.test(
      normalized.slice(0, 100),
    )
  )
    return false;
  const request = normalized.replace(
    /^(?:(?:can|could|would|will) you\s+|please\s+|i (?:want|need|would like) you to\s+)*/i,
    "",
  );
  const action =
    /^(generate|create|make|draw|design|render|produce|show me|give me)\s+([\s\S]+)$/.exec(
      request,
    );
  if (!action) return false;
  const target = action[2];
  const imageWord =
    /\b(?:photos?|images?|pictures?|artwork|illustrations?|graphics?|logos?|wallpapers?|posters?)\b/;
  const noun = imageWord.exec(target.slice(0, 160));
  if (!noun)
    return (
      action[1] === "draw" &&
      /^(?:me\s+)?(?:an?\s+)?\w+/.test(target) &&
      !/\b(?:conclusion|comparison|attention)\b/.test(target)
    );
  // A polite question needs a subject or concrete style, not just "can you generate images?".
  if (/^(?:can|could|would|will) you\b/.test(normalized)) {
    const detail = target
      .slice(noun.index + noun[0].length)
      .replace(/[?.!]/g, "")
      .trim();
    const beforeNoun = target
      .slice(0, noun.index)
      .replace(/\b(?:me|an?|some|please)\b/g, "")
      .trim();
    if (!detail && !beforeNoun) return false;
    if (
      /^(?:for me|please|at all|or not|too|as well)$/.test(detail) &&
      !beforeNoun
    )
      return false;
  }
  return true;
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_RESPONSE_BYTES || !response.body)
    throw new Error("Invalid image response size");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    // Read a bounded response so malformed provider data cannot consume unlimited memory.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES)
        throw new Error("Image response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function validatedImage(
  base64Value: unknown,
  expectedMime: GeneratedImageResult["mimeType"],
): string | null {
  if (
    typeof base64Value !== "string" ||
    base64Value.length > MAX_RESPONSE_BYTES
  )
    return null;
  const base64 = base64Value.replace(/\s/g, "");
  if (
    !base64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== base64)
    return null;
  const valid =
    expectedMime === "image/png"
      ? bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR"
      : expectedMime === "image/jpeg"
        ? bytes.length >= 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes[bytes.length - 2] === 255 &&
          bytes[bytes.length - 1] === 217
        : bytes.length >= 16 &&
          bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP" &&
          bytes.readUInt32LE(4) + 8 === bytes.length;
  return valid ? base64 : null;
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
  sourceImages: Array<{ name: string; type: string; base64: string }> = [],
): Promise<GeneratedImageResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildImagePrompt(message);
  const model =
    process.env.SVANSAI_IMAGE_MODEL ||
    process.env.OPENAI_IMAGE_MODEL ||
    DEFAULT_IMAGE_MODEL;
  const options = imageOutputOptions(message);
  const outputFormat = options.output_format;
  const mimeType =
    outputFormat === "jpeg"
      ? "image/jpeg"
      : outputFormat === "webp"
        ? "image/webp"
        : "image/png";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (sourceImages.length > 4 || sourceImages.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || Buffer.from(file.base64, "base64").length > MAX_IMAGE_BYTES)) return null;
    if (isImageEditingRequest(message) && !sourceImages.length) return null;
    const fields = { model, prompt, ...options, n: 1 };
    const form = new FormData();
    if (sourceImages.length) {
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      for (const file of sourceImages) form.append("image[]", new Blob([new Uint8Array(Buffer.from(file.base64, "base64"))], { type: file.type }), file.name.split(/[\\/]/).pop() || "source.png");
    }
    const response = await fetch(
      `https://api.openai.com/v1/images/${sourceImages.length ? "edits" : "generations"}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          ...(!sourceImages.length ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${apiKey}`,
        },
        body: sourceImages.length ? form : JSON.stringify(fields),
      },
    );

    if (!response.ok) {
      // Provider bodies can contain prompts or credentials; log only a safe status code.
      console.error("OPENAI_IMAGE_GENERATION_HTTP_ERROR:", response.status);
      await response.body?.cancel();
      return null;
    }

    const data = (await readBoundedResponse(response)) as {
      data?: { b64_json?: unknown; revised_prompt?: unknown }[];
    };
    const image = data?.data?.[0];
    const base64 = validatedImage(image?.b64_json, mimeType);

    if (!base64) return null;

    return {
      base64,
      mimeType,
      fileName: imageFileNameFromPrompt(prompt, mimeType),
      revisedPrompt:
        typeof image?.revised_prompt === "string"
          ? image.revised_prompt
              .slice(0, 4000)
              .replace(/\[\[SVANS_/g, "[SVANS_")
          : undefined,
    };
  } catch {
    console.error(
      "OPENAI_IMAGE_GENERATION_ERROR:",
      controller.signal.aborted
        ? "timeout"
        : "invalid-response-or-network-error",
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatGeneratedImageResponse(result: GeneratedImageResult) {
  const marker = `[[SVANS_IMAGE:${result.mimeType}:${result.fileName}:${result.base64}]]`;
  const note = result.revisedPrompt
    ? `\n\nPrompt used: ${result.revisedPrompt}`
    : "";

  return `Done — I generated the image.${note}\n\n${marker}`;
}
