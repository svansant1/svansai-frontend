import { GoogleGenAI } from "@google/genai";

type GeminiInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
};

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export async function generateWithGemini(input: GeminiInput): Promise<string | null> {
  if (!apiKey) return null;

  try {
    const result = await ai.models.generateContent({
      model: input.model || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      config: {
        systemInstruction: input.systemInstruction,
        temperature: input.temperature,
        topP: 0.9,
      },
    });

    const text = typeof result?.text === "string" ? result.text.trim() : "";
    return text || null;
  } catch (error) {
    console.error("GEMINI_PROVIDER_ERROR:", error);
    return null;
  }
}
