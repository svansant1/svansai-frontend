import type { ChatMessage, ChatRequestContext } from "@/lib/ai/types";

const LEGACY_BROWSER_MARKER =
  /you are svans(?:-|)ai assisting with highlighted text inside sv browser/i;
const MAX_CONTEXT_TEXT = 30_000;
const MAX_PAGE_TITLE = 500;
const MAX_PAGE_URL = 4_000;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\r\n/g, "\n").trim().slice(0, maxLength)
    : "";
}

function parseLegacyBrowserMessage(content: string): ChatRequestContext | null {
  if (!LEGACY_BROWSER_MARKER.test(content)) return null;

  const pageTitle =
    content.match(/\bPage title:\s*([^\n]*)/i)?.[1]?.trim() ?? "";
  const pageUrl =
    content.match(/\bPage address:\s*([^\n]*)/i)?.[1]?.trim() ?? "";
  const task =
    content.match(
      /\bUser task:\s*([\s\S]*?)(?=\n\s*Highlighted text:\s*)/i,
    )?.[1]?.trim() ?? "";
  const selectedText =
    content.match(
      /\bHighlighted text:\s*\n\s*---\s*\n([\s\S]*?)\n\s*---\s*$/i,
    )?.[1]?.trim() ?? "";

  if (!task && !selectedText) return null;

  return {
    source: "sv-browser-selection",
    pageTitle: clean(pageTitle, MAX_PAGE_TITLE),
    pageUrl: clean(pageUrl, MAX_PAGE_URL),
    task: clean(task, MAX_CONTEXT_TEXT),
    selectedText: clean(selectedText, MAX_CONTEXT_TEXT),
  };
}

export function sanitizeChatRequestContext(
  raw: unknown,
): ChatRequestContext | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ChatRequestContext>;
  if (
    candidate.source !== "web" &&
    candidate.source !== "sv-browser-selection"
  ) {
    return null;
  }

  return {
    source: candidate.source,
    pageTitle: clean(candidate.pageTitle, MAX_PAGE_TITLE),
    pageUrl: clean(candidate.pageUrl, MAX_PAGE_URL),
    selectedText: clean(candidate.selectedText, MAX_CONTEXT_TEXT),
    task: clean(candidate.task, MAX_CONTEXT_TEXT),
  };
}

function semanticBrowserMessage(context: ChatRequestContext): string {
  const task = clean(context.task, MAX_CONTEXT_TEXT);
  const selectedText = clean(context.selectedText, MAX_CONTEXT_TEXT);
  const parts: string[] = [];

  if (task) parts.push(`User task:\n${task}`);
  if (selectedText) parts.push(`Selected text:\n${selectedText}`);

  return parts.join("\n\n").trim();
}

export function normalizeChatRequest(
  messages: ChatMessage[],
  rawContext?: unknown,
): {
  messages: ChatMessage[];
  context: ChatRequestContext | null;
  legacyBrowserRequest: boolean;
} {
  const context = sanitizeChatRequestContext(rawContext);
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  if (latestUserIndex < 0) {
    return { messages, context, legacyBrowserRequest: false };
  }

  const legacyContext = parseLegacyBrowserMessage(
    messages[latestUserIndex].content,
  );
  const effectiveContext = context ?? legacyContext;
  if (effectiveContext?.source !== "sv-browser-selection") {
    return {
      messages,
      context: effectiveContext,
      legacyBrowserRequest: false,
    };
  }

  const semanticContent = semanticBrowserMessage(effectiveContext);
  if (!semanticContent) {
    return {
      messages,
      context: effectiveContext,
      legacyBrowserRequest: Boolean(legacyContext),
    };
  }

  const normalizedMessages = [...messages];
  normalizedMessages[latestUserIndex] = {
    role: "user",
    content: semanticContent,
  };

  return {
    messages: normalizedMessages,
    context: effectiveContext,
    legacyBrowserRequest: Boolean(legacyContext),
  };
}
