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
import { type ProviderName } from "@/lib/ai/providers/router";
import { generateWithOpenAI } from "@/lib/ai/providers/openai";
import { generateWithAnthropic } from "@/lib/ai/providers/anthropic";

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

function isImageAttachment(file?: AttachedFile) {
  return !!file && file.type.startsWith("image/");
}

function isPdfAttachment(file?: AttachedFile) {
  return !!file && file.type === "application/pdf";
}

async function callProvider(
  provider: ProviderName,
  args: { prompt: string; systemInstruction: string; temperature: number; attachedFile?: AttachedFile; }
): Promise<string | null> {
  try {
    switch (provider) {
      case "openai":
        return await generateWithOpenAI(args);
      case "anthropic":
        return await generateWithAnthropic(args);
      default:
        return null;
    }
  } catch (error) {
    console.error("[SVANSAI] Provider call error:", provider, error);
    return null;
  }
}

export async function generateChatResponse(
  rawMessages: unknown[],
  attachedFile?: AttachedFile,
  sessionId?: string | null
): Promise<string> {
  const messages = sanitizeMessages(rawMessages);
  const sid = sessionId || "anonymous";

  if (messages.length === 0) {
    return "I'm SVANSAI. Ask me anything, and I'll answer as clearly and directly as I can.";
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
    return "I'm SVANSAI, your AI assistant. I help with learning, coding, troubleshooting, writing, strategy, and conversation, and I improve over time through memory and retrieval.";
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
    response.trim().length > 25
  ) {
    void storeLearnedFallback({
      question: latestUserMessage,
      answer: response,
      questionType,
      source: "sv-runtime-optimizer",
      confidence: 0.82,
      tags: [questionType, "ai-learned", attachedFile ? "file-assisted" : "text"],
    });
  }

  return response;
}

async function generateBestResponse(
  context: ExtendedChatContext
): Promise<string> {
  let basePrompt = buildUserPrompt({
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

  // Add cleaner response rules and file guidance
  basePrompt = `
Answer cleanly and directly.
- Lead with the answer.
- Avoid filler and generic disclaimers.
- Use the user's project context when relevant.
- If coding is requested, prefer practical production-style code.
- If an image is attached, analyze the image and answer what is visible.
- If a PDF or document is attached, answer based on its content as best you can.
- Keep answers fast and useful.

${basePrompt}
`.trim();

  const retryPrompt = buildRetryPrompt(basePrompt);

  const topResult = context.retrieval[0];

  // Use strong local knowledge immediately for speed
  if (
    !context.attachedFile &&
    topResult &&
    topResult.score >= 0.95 &&
    topResult.snippet.length > 40 &&
    topResult.id !== "sv-self-improvement"
  ) {
    console.log("[SVANSAI] Serving strong local knowledge:", topResult.id);
    return topResult.snippet.trim();
  }

  const systemInstruction = buildSystemInstruction(
    context.questionType,
    context.responseStyle
  );
  const temperature = Math.min(
    getTemperature(context.questionType, context.responseStyle),
    0.45
  );

  const plan: ProviderName[] = ["openai", "anthropic"];
  console.log("[SVANSAI] Provider plan:", plan);

  for (const provider of plan) {
    console.log("[SVANSAI] Trying provider:", provider);

    try {
      const first = await callProvider(provider, {
        prompt: basePrompt,
        systemInstruction,
        temperature,
        attachedFile: context.attachedFile,
      });

      const cleanFirst = normalizeProviderText(cleanResponse(first || ""));
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
        attachedFile: context.attachedFile, 
      });

      const cleanSecond = normalizeProviderText(cleanResponse(second || ""));
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
      console.error("[SVANSAI] Provider loop error:", provider, error);
    }
  }

  void queueLearningNeed({
    question: context.latestUserMessage,
    questionType: context.questionType,
    reason: "OpenAI and Anthropic both failed to generate a usable response.",
    priority: 3,
    source: "hard-fallback",
  });

  return finalFallback(
    context.latestUserMessage,
    context.questionType,
    context.responseStyle,
    context.attachedFile
  );
}

function normalizeProviderText(text: string): string {
  return text
    .replace(/^here'?s a basic outline of.*$/im, "")
    .replace(/^here'?s a simple example.*$/im, "")
    .replace(/^feel free to modify.*$/im, "")
    .trim();
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

  return hardStalls.some((pattern) => normalized.includes(pattern));
}

function finalFallback(
  question: string,
  type: QuestionType,
  _responseStyle: ResponseStyle,
  attachedFile?: AttachedFile
): string {
  if (attachedFile) {
    if (isPdfAttachment(attachedFile)) {
      return "I received your file, but I couldn't confidently read it just now. Try sending it again or tell me exactly what you want extracted.";
    }
    return "I received your file, but I couldn't confidently process it just now. Try sending it again with a short note about what you want.";
  }

  switch (type) {
    case "coding":
      return "I couldn't generate the full coding answer I wanted just now. Send the language, file name, or goal, and I'll answer more directly.";
    case "business":
      return "Tell me the business goal, audience, or offer, and I'll help shape a sharper answer.";
    case "writing":
      return "Paste the writing and tell me the tone you want, and I'll clean it up.";
    case "tech_support":
      return "Tell me the device, exact issue, and what changed right before it started.";
    case "learning":
      return "Send the specific topic or question and I'll break it down clearly.";
    case "life":
      return "Tell me the situation and I'll help you think through the next move.";
    default:
      return question.trim()
        ? "I couldn't generate a strong answer just now."
        : "I couldn't generate a strong answer just now.";
  }
}