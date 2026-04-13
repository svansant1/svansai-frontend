export async function generateWithAnthropic(input: {
  prompt: string;
  systemInstruction: string;
  temperature: number;
}): Promise<string | null> {
  try {
    const text = "example";
    return text || null;
  } catch (error) {
    console.error("ANTHROPIC_PROVIDER_ERROR:", error);
    return null;
  }
}