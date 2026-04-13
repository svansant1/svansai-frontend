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
import { analyzeResponse } from "@/lib/ai/self-analysis";
import { checkThresholdAndRun } from "@/lib/ai/self-monitor";
import {
  parseSVCommand,
  handleSVCommand,
  checkAndSurfaceUpgrades,
  isAwaitingPassword,
} from "@/lib/ai/instruction-handler";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];

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

// ─── Retry with exponential backoff ──────────────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, delayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

// ─── Main entry ───────────────────────────────────────────────────────────────
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

  // ─── Phase 3: Handle sv commands and password flow ────────────────────────
  if (isAwaitingPassword(sid) || latestUserMessage.toLowerCase().trim().startsWith("sv ")) {
    const command = parseSVCommand(latestUserMessage, sid);
    if (command) {
      const commandResponse = await handleSVCommand(command, sid);
      if (commandResponse) return commandResponse;
    }
  }

  // ─── Phase 3: Surface unnotified upgrades on first message of session ──────
  if (messages.length === 1) {
    const upgradeNotice = await checkAndSurfaceUpgrades(sid);
    if (upgradeNotice) return upgradeNotice;
  }

  // ─── Normal chat flow ─────────────────────────────────────────────────────
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
    questionType = await detectQuestionType(lastAssistantMessage || latestUserMessage);
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

  const response = await generateBestResponse(context);

  // Phase 3: Silent scoring + threshold — fire and forget
  void analyzeResponse({ input: latestUserMessage, output: response, questionType });
  void checkThresholdAndRun();

  return response;
}

// ─── Generation loop ──────────────────────────────────────────────────────────
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
    hasFile: !!context.attachedFile,
  });

  const retryPrompt = buildRetryPrompt(basePrompt);

  for (const model of MODELS) {
    const firstAttempt = await tryGenerate({ model, context, contents, prompt: basePrompt, secondPass: false });
    if (firstAttempt) return firstAttempt;

    const secondAttempt = await tryGenerate({ model, context, contents, prompt: retryPrompt, secondPass: true });
    if (secondAttempt) return secondAttempt;
  }

  return finalFallback(context.latestUserMessage, context.questionType, context.responseStyle);
}

// ─── Build last user turn with optional file parts ────────────────────────────
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
      { inlineData: { mimeType: attachedFile.type, data: attachedFile.base64 } },
      { text: prompt },
    ];
  }

  if (isText) {
    const decoded = Buffer.from(attachedFile.base64, "base64").toString("utf-8");
    return [{ text: `The user attached a file named "${attachedFile.name}".\n\nFile contents:\n\`\`\`\n${decoded}\n\`\`\`\n\n${prompt}` }];
  }

  return [{ text: `The user attached a file named "${attachedFile.name}" (type: ${attachedFile.type}).\n\n${prompt}` }];
}

// ─── Single generation attempt ────────────────────────────────────────────────
async function tryGenerate(params: {
  model: string;
  context: ExtendedChatContext;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  prompt: string;
  secondPass: boolean;
}): Promise<string | null> {
  try {
    const systemInstruction = buildSystemInstruction(params.context.questionType, params.context.responseStyle);
    const lastUserParts = buildLastUserParts(params.prompt, params.context.attachedFile);

    const result = await withRetry(() =>
      ai.models.generateContent({
        model: params.model,
        contents: [...params.contents, { role: "user", parts: lastUserParts }],
        config: {
          systemInstruction,
          temperature: getTemperature(params.context.questionType, params.context.responseStyle),
          topP: 0.9,
        },
      })
    );

    const text = cleanResponse(result?.text?.trim() || "");
    if (!text || text.trim().length === 0) return null;

    // Only reject exact duplicates of the last assistant message
    if (!isUsableResponse(text, params.context.messages, params.context.latestUserMessage)) return null;

    // Only block hard stall phrases — no length-based rejection
    if (isHardStall(text)) return null;

    return text;
  } catch (error) {
    console.error(`MODEL_FAILED_${params.model}_${params.secondPass ? "SECOND" : "FIRST"}:`, error);
    return null;
  }
}

// ─── Only block confirmed stall phrases ──────────────────────────────────────
// Removed the "short response = bad" rule — it was blocking valid answers
// like "Yes.", "No, because...", or short factual replies.
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

// ─── Final fallback ───────────────────────────────────────────────────────────
function finalFallback(question: string, type: QuestionType, responseStyle: ResponseStyle): string {
  switch (type) {
    case "coding": return "Here's a simple coding example:\n\n```python\nprint(\"hello world\")\n```\n\nIf you want a different language or approach, just say so.";
    case "business": return "Tell me the business goal, audience, or offer, and I'll help you shape a clearer strategy.";
    case "writing": return "Paste the writing, and I'll rewrite it or make it stronger based on the tone you want.";
    case "tech_support": return "Tell me the device, what exactly is happening, and what changed before the issue started.";
    case "learning": return "I can explain that step by step. Send the full question or problem and I'll break it down.";
    case "life": return "Tell me the situation, and I'll help you sort through your options and next move.";
    default:
      if (responseStyle === "brainstorm") return "Give me the topic or goal, and I'll generate ideas and directions to build from.";
      if (responseStyle === "guide") return "Tell me what you're trying to do, and I'll walk you through it step by step.";
      return question.trim() ? "I'm here and ready. Send the full question and I'll answer it directly." : "I'm here and ready. Ask me anything.";
  }
}
