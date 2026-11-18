import test from "node:test";
import assert from "node:assert/strict";
import type { AttachedFile } from "../lib/ai/file-types";

// This test process uses fake credentials and intercepts every HTTP request.
// It verifies routing and image payloads, not a model's visual accuracy.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://photo-tests.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
process.env.OPENAI_API_KEY = "test-only";
process.env.ANTHROPIC_API_KEY = "test-only";
process.env.GEMINI_API_KEY = "test-only";

const providerRequests: Array<{ url: string; body: any }> = [];
const unexpectedRequests: string[] = [];
const answer = "I examined the currently attached images in their supplied order. Image 1 contains the new material for this request. The visible details should be checked directly against this attachment, not inferred from a previous image or its filename. Here is the requested analysis of the current attachment.";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const rawBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  const body = typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : {};
  if (new URL(url).hostname === "photo-tests.supabase.co") return Response.json([]);
  if (url.startsWith("https://api.openai.com/")) {
    providerRequests.push({ url, body });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: answer } }] });
  }
  if (url.startsWith("https://api.anthropic.com/")) {
    providerRequests.push({ url, body });
    return Response.json({ content: [{ type: "text", text: answer }], stop_reason: "end_turn" });
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    const hasImages = body.contents?.some((item: any) => item.parts?.some((part: any) => part.inlineData));
    if (hasImages) providerRequests.push({ url, body });
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: hasImages ? answer : "general" }] }, finishReason: "STOP" }] });
  }
  unexpectedRequests.push(url);
  throw new Error(`Unexpected network request blocked: ${new URL(url).hostname}`);
};

function image(name: string, fixture: string, type = "image/png"): AttachedFile {
  // Opaque synthetic bytes allow exact payload comparisons without real photos.
  return { name, type, base64: Buffer.from(fixture).toString("base64") };
}
const first = image("pasted-image.png", "first-photo-payload");
const second = image("pasted-image.png", "different-photo-payload");
const caption = "Please analyze this image. [Attached: pasted-image.png]";
const history = [
  { role: "assistant", content: "What would you like help with today?" },
  { role: "user", content: caption },
  { role: "assistant", content: "The previous image presents a question about ethical speaking." },
  { role: "user", content: caption },
];

function sentImages(body: any): string[] {
  return (body.messages?.findLast((message: any) => message.role === "user")?.content ?? [])
    .filter((part: any) => part.type === "image_url")
    .map((part: any) => part.image_url.url);
}

test("attachment turns reach image analysis despite repeated captions and filenames", async (t) => {
  const { generateChatResponse } = await import("../lib/ai/chat-engine");
  const { resetProviderCooldowns } = await import("../lib/ai/providers/executor");
  for (const [name, files] of [
    ["a different photo with the same pasted-image filename", [second]],
    ["an explicitly reuploaded identical photo", [first]],
    ["a batch of distinct photos sharing one filename", [first, second]],
    ["a mixed PNG/JPEG/WebP/GIF batch", [first, image("photo.jpg", "jpeg", "image/jpeg"), image("photo.webp", "webp", "image/webp"), image("photo.gif", "gif", "image/gif")]],
  ] as Array<[string, AttachedFile[]]>) {
    await t.test(name, async () => {
      providerRequests.length = 0;
      resetProviderCooldowns();
      const response = await generateChatResponse(history, { attachedFiles: files, responseMode: "direct", sessionId: "photo-regression" });
      assert.doesNotMatch(response, /same question again|expand on my last answer/i);
      assert.equal(response, answer);
      const calls = providerRequests.filter(request => request.url.startsWith("https://api.openai.com/"));
      assert.ok(calls.length > 0, "The current images must reach the vision provider");
      for (const call of calls) {
        assert.deepEqual(sentImages(call.body), files.map(file => `data:${file.type};base64,${file.base64}`));
      }
    });
  }
  await t.test("new text attachments also bypass the text-only duplicate guard", async () => {
    providerRequests.length = 0;
    const response = await generateChatResponse(history, { attachedFiles: [{ name: "notes.txt", type: "text/plain", base64: Buffer.from("Fresh document contents.").toString("base64") }], responseMode: "direct" });
    assert.doesNotMatch(response, /same question again/i);
    assert.ok(providerRequests.length > 0);
  });
  await t.test("text-only duplicate behavior stays unchanged", async () => {
    providerRequests.length = 0;
    const response = await generateChatResponse(history, { attachedFiles: [], responseMode: "direct" });
    assert.match(response, /same question again/i);
    assert.equal(providerRequests.length, 0);
  });
  assert.deepEqual(unexpectedRequests, []);
});
