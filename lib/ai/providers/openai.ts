import { ProviderError, providerHttpError, classifyProviderError } from "./outcomes";

type OpenAIInput = {
  prompt: string;
  systemInstruction: string;
  temperature: number;
  model?: string;
  maxOutputTokens?: number;
  rejectTruncated?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
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
        signal: input.signal ?? AbortSignal.timeout(input.timeoutMs || 25_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.model || "gpt-4o-mini",
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
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
        throw await providerHttpError(res, "OpenAI");
      }

      const data = await res.json();
      if (data?.choices?.[0]?.message?.refusal || data?.choices?.[0]?.finish_reason === "content_filter") throw new ProviderError("PROVIDER_POLICY_REFUSAL", "The provider declined this request.");
      if (input.rejectTruncated && data?.choices?.[0]?.finish_reason === "length") throw new ProviderError("INVALID_OR_TRUNCATED_RESPONSE", "Provider output limit reached.");
      const text = data?.choices?.[0]?.message?.content?.trim() || "";
      return text || null;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: input.signal ?? AbortSignal.timeout(input.timeoutMs || 25_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model || "gpt-4o-mini",
        ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
        temperature: input.temperature,
        messages: [
          { role: "system", content: input.systemInstruction },
          { role: "user", content: input.prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw await providerHttpError(res, "OpenAI");
    }

    const data = await res.json();
    if (data?.choices?.[0]?.message?.refusal || data?.choices?.[0]?.finish_reason === "content_filter") throw new ProviderError("PROVIDER_POLICY_REFUSAL", "The provider declined this request.");
    if (input.rejectTruncated && data?.choices?.[0]?.finish_reason === "length") throw new ProviderError("INVALID_OR_TRUNCATED_RESPONSE", "Provider output limit reached.");
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text || null;
  } catch (error) {
    console.error("OPENAI_PROVIDER_ERROR:", classifyProviderError(error));
    throw error;
  }
}
