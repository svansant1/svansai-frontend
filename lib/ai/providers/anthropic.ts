type AnthropicInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  attachedFiles?: Array<{ name: string; type: string; base64: string }>;
};

export async function generateWithAnthropic(input: AnthropicInput): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const images = (input.attachedFiles ?? []).filter((file) => file.type.startsWith("image/") && file.base64);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.model || "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        temperature: input.temperature,
        system: input.systemInstruction,
        messages: [{
          role: "user",
          content: images.length
            ? [
                { type: "text", text: `${input.prompt}\n\nAnalyze the ${images.length} attached images together in their supplied order.` },
                ...images.map((image) => ({
                  type: "image",
                  source: { type: "base64", media_type: image.type, data: image.base64 },
                })),
              ]
            : input.prompt,
        }],
      }),
    });

    if (!res.ok) {
      console.error("ANTHROPIC_PROVIDER_HTTP_ERROR:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content.map((c: { text?: string }) => c.text || "").join("").trim()
      : "";

    return text || null;
  } catch (error) {
    console.error("ANTHROPIC_PROVIDER_ERROR:", error);
    return null;
  }
}
