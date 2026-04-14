import { GoogleGenAI } from "@google/genai";
import type { ChatContext, QuestionType } from "@/lib/ai/types";
import {
  sanitizeMessages,
  getLatestUserMessage,
  getLastAssistantMessage,
  cleanResponse,
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
import { analyzeResponse } from "@/lib/ai/self-analysis";
import { checkThresholdAndRun } from "@/lib/ai/self-monitor";
import {
  parseSVCommand,
  handleSVCommand,
  checkAndSurfaceUpgrades,
  isAwaitingPassword,
} from "@/lib/ai/instruction-handler";
import {
  queueLearningNeed,
  storeLearnedFallback,
} from "@/lib/ai/knowledge-learning";
import { getProviderPlan, type ProviderName } from "@/lib/ai/providers/router";
import { generateWithGemini } from "@/lib/ai/providers/gemini";
import { generateWithOpenAI } from "@/lib/ai/providers/openai";
import { generateWithAnthropic } from "@/lib/ai/providers/anthropic";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

// Keep attachment path minimal to reduce quota pressure
const FILE_MODELS = ["gemini-2.5-flash"];

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
  retries = 1,
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

async function callProvider(
  provider: ProviderName,
  args: { prompt: string; systemInstruction: string; temperature: number }
): Promise<string | null> {
  try {
    switch (provider) {
      case "gemini":
        return generateWithGemini(args);
      case "openai":
        return generateWithOpenAI(args);
      case "anthropic":
        return generateWithAnthropic(args);
      default:
        return null;
    }
  } catch (error) {
    console.error("SVANSAI_PROVIDER_CALL_ERROR:", provider, error);
    return null;
  }
}

export async function generateChatResponse(
  rawMessages: unknown[],
  attachedFile?: AttachedFile,
  sessionId?: string | null
): Promise<string> {
  if (!apiKey) {
    return "The AI service is not configured yet. Add GEMINI_API_KEY to your environment settings.";
  }

  const messages = sanitizeMessages(rawMessages);
  const sid = sessionId || "anonymous";

  if (messages.length === 0) {
    return "I'm SVANSAI. Ask me anything, and I'll help as clearly and directly as I can.";
  }

  const latestUserMessage = getLatestUserMessage(messages);

  if (!latestUserMessage && !attachedFile) {
    return "I'm ready when you are. Send me your question or attach a file, and I'll help.";
  }

  const normalizedLatest = latestUserMessage.toLowerCase().trim();
  if (
    normalizedLatest === "what are you" ||
    normalizedLatest === "what are you?" ||
    normalizedLatest === "who are you" ||
    normalizedLatest === "who are you?" ||
    normalizedLatest.includes("what is svansai") ||
    normalizedLatest.includes("who is svansai") ||
    normalizedLatest.includes("tell me about yourself") ||
    normalizedLatest.includes("what do you do") ||
    normalizedLatest.includes("do you know who you are")
  ) {
    return "I'm SVANSAI, your AI assistant. I help with learning, coding, troubleshooting, writing, strategy, and conversation, and I improve over time through memory, retrieval, and self-analysis.";
  }

  if (
    isAwaitingPassword(sid) ||
    latestUserMessage.toLowerCase().trim().startsWith("sv ")
  ) {
    const command = parseSVCommand(latestUserMessage, sid);
    if (command) {
      const commandResponse = await handleSVCommand(command, sid);
      if (commandResponse) return commandResponse;
    }
  }

  if (messages.length === 1) {
    const upgradeNotice = await checkAndSurfaceUpgrades(sid);
    if (upgradeNotice) return upgradeNotice;
  }

  const lastAssistantMessage = getLastAssistantMessage(messages);
  const followUpIntent = detectFollowUpIntent(latestUserMessage);

  let effectiveMessage = latestUserMessage;
  let questionType = await detectQuestionType(latestUserMessage || "general");

  if (attachedFile) {
    const fileContext = `User attached a file named "${attachedFile.name}" (${attachedFile.type}). ${latestUserMessage}`;
    questionType = await detectQuestionType(fileContext);
  }

  if (isContextDependentFollowUp(latestUserMessage) && lastAssistantMessage) {
    effectiveMessage = `
User follow-up:
${latestUserMessage}

Previous assistant response:
${lastAssistantMessage}
`.trim();

    questionType = await detectQuestionType(
      lastAssistantMessage || latestUserMessage
    );
  }

  const responseStyle = detectResponseStyle(effectiveMessage, questionType);
  const memory = await getMemoryContext(latestUserMessage, messages);
  const retrieval = await getRetrievedKnowledge(latestUserMessage);

  if (retrieval.length === 0 || (retrieval[0]?.score ?? 0) < 0.5) {
    void queueLearningNeed({
      question: latestUserMessage,
      questionType,
      reason: "Retrieved context was weak or missing.",
      priority: 2,
      source: "chat-runtime",
    });
  }

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

  const response = await generateBestResponse(context);

  if (
    response &&
    !isHardStall(response) &&
    !response.toLowerCase().includes("i couldn't generate a strong answer") &&
    response.trim().length > 40
  ) {
    void storeLearnedFallback({
      question: latestUserMessage,
      answer: response,
      questionType,
      source: "sv-runtime-optimizer",
      confidence: 0.78,
      tags: [questionType, "ai-learned"],
    });
  }

  void analyzeResponse({
    input: latestUserMessage,
    output: response,
    questionType,
  });
  void checkThresholdAndRun();

  return response;
}

async function generateBestResponse(
  context: ExtendedChatContext
): Promise<string> {
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

  // Only allow direct local knowledge answer on very high confidence.
  // This avoids dumping raw knowledge for medium-confidence retrieval.
  if (!context.attachedFile) {
    const topResult = context.retrieval[0];
    if (topResult && topResult.score >= 0.9) {
      console.log("[SVANSAI] Serving from local knowledge:", topResult.id);
      return topResult.snippet;
    }
  }

  if (context.attachedFile) {
    for (const model of FILE_MODELS) {
      const firstAttempt = await tryFileGeneration(model, context, basePrompt);
      if (firstAttempt) return firstAttempt;

      const secondAttempt = await tryFileGeneration(model, context, retryPrompt);
      if (secondAttempt) return secondAttempt;
    }

    return finalFallback(
      context.latestUserMessage,
      context.questionType,
      context.responseStyle
    );
  }

  const systemInstruction = buildSystemInstruction(
    context.questionType,
    context.responseStyle
  );
  const temperature = getTemperature(
    context.questionType,
    context.responseStyle
  );
  const plan = getProviderPlan(context.questionType);

 console.log("[SVANSAI] Provider plan:", plan);

for (const provider of plan) {
  console.log("[SVANSAI] Trying provider:", provider);

  try {
    const first = await callProvider(provider, {
      prompt: basePrompt,
      systemInstruction,
      temperature,
    });

    const cleanFirst = cleanResponse(first || "");
    console.log(
      "[SVANSAI] Provider result:",
      provider,
      cleanFirst ? cleanFirst.slice(0, 200) : "[empty]"
    );

    if (
      cleanFirst &&
      !isHardStall(cleanFirst) &&
      cleanFirst.trim().length > 20
    ) {
      return cleanFirst;
    }

    const second = await callProvider(provider, {
      prompt: retryPrompt,
      systemInstruction,
      temperature,
    });

    const cleanSecond = cleanResponse(second || "");
    console.log(
      "[SVANSAI] Provider retry result:",
      provider,
      cleanSecond ? cleanSecond.slice(0, 200) : "[empty]"
    );

    if (
      cleanSecond &&
      !isHardStall(cleanSecond) &&
      cleanSecond.trim().length > 20
    ) {
      return cleanSecond;
    }

  } catch (error) {
    console.error("[SVANSAI] Provider error:", provider, error);
  }
}

  void queueLearningNeed({
    question: context.latestUserMessage,
    questionType: context.questionType,
    reason: "All providers failed to generate a usable response.",
    priority: 3,
    source: "hard-fallback",
  });

  return finalFallback(
    context.latestUserMessage,
    context.questionType,
    context.responseStyle
  );
}

function buildLastUserParts(
  prompt: string,
  attachedFile?: AttachedFile
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  if (!attachedFile) return [{ text: prompt }];

  const isImage = attachedFile.type.startsWith("image/");
  const isPdf = attachedFile.type === "application/pdf";
  const isText =
    attachedFile.type.startsWith("text/") ||
    attachedFile.type === "application/json" ||
    attachedFile.type === "application/x-python";

  if (isImage || isPdf) {
    return [
      {
        inlineData: {
          mimeType: attachedFile.type,
          data: attachedFile.base64,
        },
      },
      { text: prompt },
    ];
  }

  if (isText) {
    try {
      const decoded = Buffer.from(attachedFile.base64, "base64").toString(
        "utf-8"
      );
      return [
        {
          text: `File: ${attachedFile.name}\n\n\`\`\`\n${decoded}\n\`\`\`\n\n${prompt}`,
        },
      ];
    } catch {
      return [{ text: prompt }];
    }
  }

  return [{ text: prompt }];
}

async function tryFileGeneration(
  model: string,
  context: ExtendedChatContext,
  prompt: string
): Promise<string | null> {
  try {
    const systemInstruction = buildSystemInstruction(
      context.questionType,
      context.responseStyle
    );
    const parts = buildLastUserParts(prompt, context.attachedFile);
    const contents = context.messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const result = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents: [...contents, { role: "user", parts }],
        config: {
          systemInstruction,
          temperature: getTemperature(
            context.questionType,
            context.responseStyle
          ),
          topP: 0.9,
        },
      })
    );

    const text = cleanResponse(result?.text?.trim() || "");
    return text && !isHardStall(text) ? text : null;
  } catch (error) {
    console.error("[SVANSAI] File generation error:", model, error);
    return null;
  }
}

function isHardStall(text: string): boolean {
  const normalized = normalizeText(text);
  const hardStalls = [
    "what are you trying to figure out",
    "what have you tried already",
    "where exactly are you getting stuck",
    "where exactly are you stuck",
    "tell me more so i can help",
    "i'm still here with you",
    "im still here with you",
    "even if my live model response is delayed",
    "let's start here",
    "lets start here",
  ];

  return hardStalls.some((p) => normalized.includes(p));
}

function finalFallback(
  question: string,
  type: QuestionType,
  responseStyle: ResponseStyle
): string {
  switch (type) {
    case "coding":
      return 'Here\'s a simple coding example:\n\n```python\nprint("hello world")\n```\n\nIf you want a different language or approach, just say so.';
    case "business":
      return "Tell me the business goal, audience, or offer, and I'll help you shape a clearer strategy.";
    case "writing":
      return "Paste the writing, and I'll rewrite it or make it stronger based on the tone you want.";
    case "tech_support":
      return "Tell me the device, what exactly is happening, and what changed before the issue started.";
    case "learning":
      return "I can explain that step by step. Send the full question or problem and I'll break it down.";
    case "life":
      return "Tell me the situation, and I'll help you sort through your options and next move.";
    default:
      return question.trim()
        ? "I couldn't generate a strong answer just now. My provider fallback chain may not be responding correctly yet."
        : "I couldn't generate a strong answer just now.";
  }
}
