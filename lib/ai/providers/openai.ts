export async function generateWithOpenAI(input: {
  prompt: string;
  systemInstruction: string;
  temperature: number;
}): Promise<string | null> {
  try {
    const text = "example";
    return text || null;
  } catch (error) {
    console.error("OPENAI_PROVIDER_ERROR:", error);
    return null;
  }
}