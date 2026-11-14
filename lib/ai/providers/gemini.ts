import { GoogleGenAI } from "@google/genai";
import { ProviderError, classifyProviderError } from "./outcomes";

type GeminiInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  maxOutputTokens?: number;
  rejectTruncated?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  attachedFiles?: Array<{ name: string; type: string; base64: string }>;
};

export async function generateWithGemini(input: GeminiInput): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });

  try {
    const images = (input.attachedFiles ?? []).filter((file) => file.type.startsWith("image/") && file.base64);
    const result = await ai.models.generateContent({
      model: input.model || "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { text: images.length ? `${input.prompt}\n\nAnalyze the ${images.length} attached images together in their supplied order.` : input.prompt },
          ...images.map((image) => ({ inlineData: { mimeType: image.type, data: image.base64 } })),
        ],
      }],
      config: {
        systemInstruction: input.systemInstruction,
        temperature: input.temperature,
        httpOptions: { timeout: input.timeoutMs || 25_000 },
        abortSignal: input.signal,
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        topP: 0.9,
      },
    });

    const finishReason = String(result.candidates?.[0]?.finishReason || "");
    if (result.promptFeedback?.blockReason || /SAFETY|BLOCKLIST|PROHIBITED|SPII|RECITATION/.test(finishReason)) throw new ProviderError("PROVIDER_POLICY_REFUSAL", "The provider declined this request.");
    if (input.rejectTruncated && finishReason === "MAX_TOKENS") throw new ProviderError("INVALID_OR_TRUNCATED_RESPONSE", "Provider output limit reached.");
    const text = typeof result?.text === "string" ? result.text.trim() : "";
    return text || null;
  } catch (error) {
    console.error("GEMINI_PROVIDER_ERROR:", classifyProviderError(error));
    throw error;
  }
}
