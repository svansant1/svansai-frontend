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

export async function generateWithOpenAI(
  input: OpenAIInput
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const isImage = input.attachedFile?.type?.startsWith("image/");

    if (isImage && input.attachedFile?.base64) {
      console.log("OPENAI IMAGE MODE:", {
        hasFile: !!input.attachedFile,
        type: input.attachedFile?.type,
        name: input.attachedFile?.name,
      });

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
                  text: input.prompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${input.attachedFile.type};base64,${input.attachedFile.base64}`,
                  },
                },
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
      console.log("OPENAI_IMAGE_RAW_RESPONSE:", JSON.stringify(data, null, 2));

      const text = data?.choices?.[0]?.message?.content?.trim() || "";
      console.log("OPENAI_IMAGE_FINAL_TEXT:", text || "[empty]");
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
    console.log("OPENAI_TEXT_RAW_RESPONSE:", JSON.stringify(data, null, 2));

    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    console.log("OPENAI_TEXT_FINAL_TEXT:", text || "[empty]");
    return text || null;
  } catch (error) {
    console.error("OPENAI_PROVIDER_ERROR:", error);
    return null;
  }
}