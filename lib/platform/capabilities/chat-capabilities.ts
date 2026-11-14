import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import type { AttachedFile } from "@/lib/ai/file-types";
import { generateChatResponse } from "@/lib/ai/chat-engine";
import { generateImageWithOpenAI, formatGeneratedImageResponse } from "@/lib/ai/image-generation";
import { generateChatArtifact } from "@/lib/artifacts/chat-artifacts";
import { validateGeneratedArtifact } from "@/lib/artifacts/validation";
import type { ArtifactRequest, GeneratedArtifact } from "@/lib/artifacts/types";
import type { WritingProfile } from "@/lib/personalization/writing-profile";
import type { UserMemory } from "@/lib/personalization/structured-memory";
import type { RuntimeTelemetry } from "@/lib/platform/telemetry";
import { CapabilityRegistry } from "./registry";
import { CapabilityError } from "./contracts";
import type { TrustedRequestContext } from "@/lib/platform/request-context";
import { redactStructuredContent } from "@/lib/context/provenance";

export type ChatCapabilityInput = { prompt: string; messages: ChatMessage[]; files: AttachedFile[]; artifactRequest: ArtifactRequest | null };
export type ChatCapabilityOutput = { text: string; artifact?: GeneratedArtifact };
type Options = {
  trustedContext?: TrustedRequestContext;
  sessionId?: string | null; responseMode: ResponseMode; isVerifiedOwner: boolean;
  writingProfile?: WritingProfile | null; userMemories: UserMemory[]; telemetry: RuntimeTelemetry;
  mindInstructions: string; artifactMessages: ChatMessage[];
};
function parseInput(raw: unknown): ChatCapabilityInput {
  if (!raw || typeof raw !== "object") throw new CapabilityError("failed", "Invalid capability request.");
  const input = raw as ChatCapabilityInput;
  if (typeof input.prompt !== "string" || !input.prompt.trim() || !Array.isArray(input.messages) || !Array.isArray(input.files)) throw new CapabilityError("failed", "The request needs a message and valid attachments.");
  return input;
}
function validateText(output: ChatCapabilityOutput): void {
  if (typeof output.text !== "string" || !output.text.trim()) throw new CapabilityError("failed", "No response was produced.");
}

export function createChatCapabilities(options: Options): CapabilityRegistry<ChatCapabilityInput, ChatCapabilityOutput> {
  const registry = new CapabilityRegistry<ChatCapabilityInput, ChatCapabilityOutput>();
  registry.register({
    id: "conversation.respond", version: 1, name: "Conversation", inputs: ["text", "attachments"], outputs: ["text"], permissions: ["chat.respond"], sideEffects: "none",
    validation: "Response text checked; independent factual verification is not implied.", available: () => ({ available: true }), parse: parseInput,
    execute: async (input, context) => ({ text: await generateChatResponse(input.messages, { attachedFiles: input.files, sessionId: options.sessionId, responseMode: options.responseMode, isVerifiedOwner: options.isVerifiedOwner, writingProfile: options.writingProfile, userMemories: options.userMemories, runtimeTelemetry: options.telemetry, mindContext: options.mindInstructions, signal: context.signal, trustedContext: options.trustedContext }) }),
    validate: validateText,
  });
  registry.register({
    id: "artifacts.generate", version: 1, name: "Native file generation", inputs: ["text", "source files"], outputs: ["docx", "xlsx", "pptx", "pdf", "csv", "txt", "md"], permissions: ["artifact.create"], sideEffects: "artifact",
    validation: "File size and signature checked; Office opening and recalculation are separate checks.", available: () => ({ available: true }), parse: parseInput,
    execute: async (input, context) => {
      if (!input.artifactRequest) throw new CapabilityError("failed", "A file format is required.");
      const result = await generateChatArtifact({ request: input.artifactRequest, messages: options.artifactMessages, files: input.files, telemetry: options.telemetry, signal: context.signal, assertAuthorized: context.assertAuthorized,
        redactSource: options.trustedContext ? redactStructuredContent : undefined });
      if (!("artifact" in result)) throw new CapabilityError("failed", result.text);
      return result;
    },
    validate: (output) => {
      validateText(output);
      const artifact = output.artifact;
      if (!artifact) throw new CapabilityError("failed", "No file was created.");
      validateGeneratedArtifact(artifact);
    },
  });
  registry.register({
    id: "images.generate", version: 1, name: "Image generation / editing", inputs: ["text", "images"], outputs: ["png", "jpeg", "webp"], permissions: ["image.create"], sideEffects: "artifact",
    validation: "Image provider output received; visual quality has not been independently reviewed.",
    available: () => ({ available: Boolean(process.env.OPENAI_API_KEY), reason: "Image generation requires configured provider access." }), parse: parseInput,
    execute: async (input, context) => {
      const image = await generateImageWithOpenAI(input.prompt, input.files.filter((file) => file.type.startsWith("image/")), context.signal);
      if (!image) throw new CapabilityError("failed", "The image request did not complete. For edits, attach the original image in this message.");
      options.telemetry.providerSelected = "openai";
      options.telemetry.providerPlan = ["openai"];
      return { text: formatGeneratedImageResponse(image) };
    }, validate: validateText,
  });
  return registry;
}
