type OpenAIInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  attachedFile?: {
    name: string;
    type: string;
    base64: string;
  };
};

export async function generateWithOpenAI(input: OpenAIInput): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const isImage = input.attachedFile?.type?.startsWith("image/");

    const content: any[] = [
      {
        type: "input_text",
        text: `${input.systemInstruction}\n\n${input.prompt}`,
      },
    ];

    // 🔥 Attach image if present
    if (isImage && input.attachedFile?.base64) {
      content.push({
        type: "input_image",
        image_base64: input.attachedFile.base64,
      });
    }

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model || "gpt-4o-mini",
        temperature: input.temperature,
        input: [
          {
            role: "user",
            content,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error("OPENAI_PROVIDER_HTTP_ERROR:", res.status, await res.text());
      return null;
    }

    const data = await res.json();

    const text =
      data?.output?.[0]?.content?.find((c: any) => c.type === "output_text")?.text ||
      "";

    return text.trim() || null;
  } catch (error) {
    console.error("OPENAI_PROVIDER_ERROR:", error);
    return null;
  }
}