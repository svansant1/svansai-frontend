import { GoogleGenAI } from "@google/genai";
import type { ChatMessage, ChatContext, QuestionType } from "@/lib/ai/types";
import {
  sanitizeMessages,
  getLatestUserMessage,
  getLastAssistantMessage,
  cleanResponse,
  isUsableResponse,
  normalizeText,
} from "@/lib/ai/cleanup";

import {
  detectResponseStyle,
  detectFollowUpIntent,
  isContextDependentFollowUp,
  type ResponseStyle,
  type FollowUpIntent,
} from "@/lib/ai/router";

import { detectQuestionType } from "@/lib/ai/detectQuestionType";
import { getMemoryContext } from "@/lib/ai/memory";
import { getRetrievedKnowledge } from "@/lib/ai/retrieval";

import {
  buildSystemInstruction,
  buildUserPrompt,
  buildRetryPrompt,
  getTemperature,
} from "@/lib/ai/prompt";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

const MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];

export type AttachedFile = {
  name: string;
  type: string;
  base64: string;
};

type ExtendedChatContext = ChatContext & {
  responseStyle: ResponseStyle;
  followUpIntent: FollowUpIntent;
  lastAssistantMessage: string;
  effectiveMessage: string;
  attachedFile?: AttachedFile;
};

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 400
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < retries) {
        await new Promise((res) =>
          setTimeout(res, delayMs * Math.pow(2, attempt))
        );
      }
    }
  }

  throw lastError;
}

export async function generateChatResponse(
  rawMessages: unknown[],
  attachedFile?: AttachedFile
): Promise<string> {
  if (!apiKey) {
    return "The AI service is not configured yet. Add GEMINI_API_KEY.";
  }

  const messages = sanitizeMessages(rawMessages);

  if (messages.length === 0) {
    return "I'm SVANSAI. Ask me anything.";
  }

  const latestUserMessage = getLatestUserMessage(messages);

  if (!latestUserMessage && !attachedFile) {
    return "Send your question and I'll help.";
  }

  const lastAssistantMessage = getLastAssistantMessage(messages);
  const followUpIntent = detectFollowUpIntent(latestUserMessage);

  let effectiveMessage = latestUserMessage;
  let questionType = await detectQuestionType(latestUserMessage || "general");

  if (attachedFile) {
    const fileContext = `
User attached file: ${attachedFile.name}
${latestUserMessage}
`;

    questionType = await detectQuestionType(fileContext);
  }

  if (isContextDependentFollowUp(latestUserMessage) && lastAssistantMessage) {
    effectiveMessage = `
User follow-up:
${latestUserMessage}

Previous assistant:
${lastAssistantMessage}
`;
  }

  const responseStyle = detectResponseStyle(effectiveMessage, questionType);

  const memory = await getMemoryContext(latestUserMessage, messages);
  const retrieval = await getRetrievedKnowledge(latestUserMessage);

  const context: ExtendedChatContext = {
    messages,
    latestUserMessage,
    questionType,
    responseStyle,
    followUpIntent,
    lastAssistantMessage,
    effectiveMessage,
    memory,
    retrieval,
    attachedFile,
  };

  return generateBestResponse(context);
}

async function generateBestResponse(
  context: ExtendedChatContext
): Promise<string> {
  const contents = context.messages.slice(0, -1).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const basePrompt = buildUserPrompt({
    latestUserMessage: context.latestUserMessage,
    effectiveMessage: context.effectiveMessage,
    questionType: context.questionType,
    responseStyle: context.responseStyle,
    followUpIntent: context.followUpIntent,
    lastAssistantMessage: context.lastAssistantMessage,
    memory: context.memory,
    retrieval: context.retrieval,
    hasFile: !!context.attachedFile,
  });

  const retryPrompt = buildRetryPrompt(basePrompt);

  for (const model of MODELS) {
    const firstAttempt = await tryGenerate({
      model,
      context,
      contents,
      prompt: basePrompt,
      secondPass: false,
    });

    if (firstAttempt) return firstAttempt;

    const secondAttempt = await tryGenerate({
      model,
      context,
      contents,
      prompt: retryPrompt,
      secondPass: true,
    });

    if (secondAttempt) return secondAttempt;
  }

  return finalFallback(context.latestUserMessage, context.questionType);
}

async function tryGenerate(params: {
  model: string;
  context: ExtendedChatContext;
  contents: any[];
  prompt: string;
  secondPass: boolean;
}): Promise<string | null> {
  try {
    const systemInstruction = buildSystemInstruction(
      params.context.questionType,
      params.context.responseStyle
    );

    const result = await withRetry(() =>
      ai.models.generateContent({
        model: params.model,
        contents: [
          ...params.contents,
          {
            role: "user",
            parts: [{ text: params.prompt }],
          },
        ],
        config: {
          systemInstruction,
          temperature: getTemperature(
            params.context.questionType,
            params.context.responseStyle
          ),
          topP: 0.9,
        },
      })
    );

    let text = cleanResponse(result?.text?.trim() || "");

    if (!text) {
      text = "Continuing reasoning...";
    }

    if (
      !isUsableResponse(
        text,
        params.context.messages,
        params.context.latestUserMessage
      )
    ) {
      return null;
    }

    return text;
  } catch (error) {
    console.error("MODEL ERROR:", error);
    return null;
  }
}

function finalFallback(question: string, type: QuestionType): string {
  return `
I'm analyzing your request.

User request:
${question}

Let me reason through this step by step...
`.trim();
}