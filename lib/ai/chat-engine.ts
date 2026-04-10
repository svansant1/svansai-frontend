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
  detectQuestionType,
  detectResponseStyle,
  detectFollowUpIntent,
  isContextDependentFollowUp,
  type ResponseStyle,
  type FollowUpIntent,
} from "@/lib/ai/router";
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

type ExtendedChatContext = ChatContext & {
  responseStyle: ResponseStyle;
  followUpIntent: FollowUpIntent;
  lastAssistantMessage: string;
  effectiveMessage: string;
};

export async function generateChatResponse(rawMessages: unknown[]): Promise<string> {
  if (!apiKey) {
    return "The AI service is not configured yet. Add GEMINI_API_KEY to your environment settings.";
  }

  const messages = sanitizeMessages(rawMessages);

  if (messages.length === 0) {
    return "I’m SVANSAI. Ask me anything, and I’ll help as clearly and directly as I can.";
  }

  const latestUserMessage = getLatestUserMessage(messages);

  if (!latestUserMessage) {
    return "I’m ready when you are. Send me your question, and I’ll help.";
  }

  const lastAssistantMessage = getLastAssistantMessage(messages);
  const followUpIntent = detectFollowUpIntent(latestUserMessage);

  let effectiveMessage = latestUserMessage;
  let questionType = detectQuestionType(latestUserMessage);

  if (isContextDependentFollowUp(latestUserMessage) && lastAssistantMessage) {
    effectiveMessage = `
User follow-up:
${latestUserMessage}

Previous assistant response:
${lastAssistantMessage}
`.trim();

    questionType = detectQuestionType(lastAssistantMessage || latestUserMessage);
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
  };

  return generateBestResponse(context);
}

async function generateBestResponse(context: ExtendedChatContext): Promise<string> {
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

  return finalFallback(
    context.latestUserMessage,
    context.questionType,
    context.responseStyle
  );
}

async function tryGenerate(params: {
  model: string;
  context: ExtendedChatContext;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  prompt: string;
  secondPass: boolean;
}): Promise<string | null> {
  try {
    const systemInstruction = buildSystemInstruction(
      params.context.questionType,
      params.context.responseStyle
    );

    const result = await ai.models.generateContent({
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
    });

    const text = cleanResponse(result?.text?.trim() || "");

    if (!text) return null;

    if (!isUsableResponse(text, params.context.messages, params.context.latestUserMessage)) {
      return null;
    }

    if (looksTooGeneric(text, params.context.latestUserMessage)) {
      return null;
    }

    return text;
  } catch (error) {
    console.error(
      `MODEL_FAILED_${params.model}_${params.secondPass ? "SECOND" : "FIRST"}:`,
      error
    );
    return null;
  }
}

function looksTooGeneric(text: string, latestUserMessage: string): boolean {
  const normalized = normalizeText(text);

  const bannedPatterns = [
    "what are you trying to figure out",
    "what have you tried already",
    "where exactly are you getting stuck",
    "where exactly are you stuck",
    "tell me more so i can help",
    "give me more detail",
    "i can help with that",
    "could you rephrase",
    "i’m still here with you",
    "im still here with you",
    "even if my live model response is delayed",
    "let’s start here",
    "lets start here",
  ];

  if (bannedPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  if (latestUserMessage.trim().length > 20 && text.trim().length < 60) {
    return true;
  }

  return false;
}

function finalFallback(
  question: string,
  type: QuestionType,
  responseStyle: ResponseStyle
): string {
  switch (type) {
    case "coding":
      return `Here’s a simple coding example:

\`\`\`python
print("hello world")
\`\`\`

If you want a smaller, longer, or different language version, say "shorter", "more", or name the language.`;

    case "business":
      return "Tell me the business goal, audience, or offer, and I’ll help you shape a clearer strategy with suggestions and next steps.";

    case "writing":
      return "Paste the writing, and I’ll rewrite it, clean it up, or make it sound stronger based on the tone you want.";

    case "tech_support":
      return "Tell me the device, what exactly is happening, and what changed before the issue started. I’ll guide you through the best checks first.";

    case "learning":
      return "This looks like a learning or math question. If you want, I can explain what the expression means, simplify it, or solve it step by step depending on the exact problem.";

    case "life":
      return "Tell me the situation, and I’ll help you sort through your options, pros and cons, and the best next move.";

    default:
      if (responseStyle === "brainstorm") {
        return "Give me the topic or goal, and I’ll generate ideas, directions, and suggestions to build from.";
      }

      if (responseStyle === "guide") {
        return "Tell me what you’re trying to do, and I’ll walk you through it step by step.";
      }

      return question.trim()
        ? `Here’s a direct start based on what you asked: ${question}`
        : "I’m here and ready. Ask me anything.";
  }
}