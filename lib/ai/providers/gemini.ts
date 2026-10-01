import { GoogleGenAI } from "@google/genai";

type GeminiInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  maxOutputTokens?: number;
  rejectTruncated?: boolean;
  attachedFiles?: Array<{ name: string; type: string; base64: string }>;
};

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function generateWithGemini(input: GeminiInput): Promise<string | null> {
  if (!apiKey) return null;

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
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        topP: 0.9,
      },
    });

    if (input.rejectTruncated && result.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Document content exceeded the provider output limit.");
    const text = typeof result?.text === "string" ? result.text.trim() : "";
    return text || null;
  } catch (error) {
    console.error("GEMINI_PROVIDER_ERROR:", error);
    throw error;
  }
}
