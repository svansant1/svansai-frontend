export async function generateWithGemini(input: {
  prompt: string;
  systemInstruction: string;
  temperature: number;
}): Promise<string | null> {
  try {
    // your API call here
    const text = "example";
    return text || null;
  } catch (error) {
    console.error("GEMINI_PROVIDER_ERROR:", error);
    return null;
  }
}