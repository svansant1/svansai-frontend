type OpenAIInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
};

export async function generateWithOpenAI(input: OpenAIInput): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model || "gpt-4o-mini",
        temperature: input.temperature,
        messages: [
          { role: "system", content: input.systemInstruction },
          { role: "user", content: input.prompt },
        ],
      }),
    });

    if (!res.ok) {
      console.error("OPENAI_PROVIDER_HTTP_ERROR:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text || null;
  } catch (error) {
    console.error("OPENAI_PROVIDER_ERROR:", error);
    return null;
  }
}
