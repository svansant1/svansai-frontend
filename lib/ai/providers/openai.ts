type OpenAIInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  attachedFiles?: Array<{
    name: string;
    type: string;
    base64: string;
  }>;
};

export async function generateWithOpenAI(
  input: OpenAIInput
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const images = (input.attachedFiles ?? []).filter(
      (file) => file.type.startsWith("image/") && file.base64,
    );

    if (images.length) {

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
            {
              role: "system",
              content: input.systemInstruction,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${input.prompt}\n\nThe attached images are ordered Image 1 through Image ${images.length}. Analyze them together and refer to their numbers when comparing them.`,
                },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${image.type};base64,${image.base64}`,
                  },
                })),
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        console.error("OPENAI_IMAGE_HTTP_ERROR:", res.status, await res.text());
        return null;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim() || "";
      return text || null;
    }

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
