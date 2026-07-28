import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage } from "@/lib/ai/types";
import { generateWithGemini } from "@/lib/ai/providers/gemini";
import { generateWithOpenAI } from "@/lib/ai/providers/openai";

type ChecklistItemStatus = "pending" | "completed";

export type ChecklistItem = {
  label: string;
  status: ChecklistItemStatus;
};

type ChecklistState = {
  items: ChecklistItem[];
  source: "image" | "text";
  sourceImage?: {
    type: string;
    base64: string;
  };
  updatedAt: number;
};

const checklistSessions = new Map<string, ChecklistState>();

const LIST_CONTEXT_TERMS =
  /\b(list|checklist|cross|crossed|check off|mark off|completed|complete|finished|done|pending|remaining|numbers?|items?)\b/i;
const COMPLETE_COMMAND =
  /\b(cross\s*(off|out)|check\s*(off)?|mark\s*(as)?\s*(done|complete|completed|finished)|complete|finished|done)\b/i;
const COMPLETED_REQUEST =
  /\b(what('| i)?s|show|send|give|list|which|ones?)\b.*\b(completed|complete|finished|done|crossed)\b|\b(completed|finished|done|crossed)\b.*\b(ones|items|list|already)\b/i;
const PENDING_REQUEST =
  /\b(what('| i)?s|show|send|give|list|which|ones?)\b.*\b(left|remaining|pending|not done|unfinished)\b|\b(left|remaining|pending|unfinished)\b.*\b(ones|items|list)\b/i;
const ACTIVE_LIST_REQUEST =
  /\b(show|send|give|list|display)\b.*\b(list|checklist|updated list)\b|\b(updated list|active list|current list)\b/i;
const VISIBLE_COMPLETED_REQUEST =
  /\b(all|everything|anything|what)\b.*\b(finished|done|completed|crossed|checked)\b/i;
const WRITING_REVIEW_REQUEST =
  /\b(look over|review|revise|rewrite|compare|discussion|post|paragraph|essay|draft|professor|classmates)\b/i;

const SIMPLE_ITEM_PATTERN = /^[a-z0-9][a-z0-9 .#-]{0,40}$/i;

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function dedupeItems(items: ChecklistItem[]) {
  const seen = new Set<string>();
  const result: ChecklistItem[] = [];

  for (const item of items) {
    const label = item.label.trim();
    const key = normalizeLabel(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      label: label.slice(0, 120),
      status: item.status,
    });
  }

  return result.slice(0, 100);
}

function extractJsonArray(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function parseExtractedItems(text: string): ChecklistItem[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  return dedupeItems(
    parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as { label?: unknown; status?: unknown };
        const label = typeof record.label === "string" ? record.label : "";
        const statusText =
          typeof record.status === "string" ? record.status.toLowerCase() : "";
        const status: ChecklistItemStatus =
          statusText.includes("complete") ||
          statusText.includes("done") ||
          statusText.includes("cross")
            ? "completed"
            : "pending";
        return { label, status };
      })
      .filter((item): item is ChecklistItem => Boolean(item?.label?.trim())),
  );
}

function parseChecklistFromText(text: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]?\s*\[(x|X|\s)\]\s*(.+?)\s*$/);
    if (!match) continue;

    const label = (match[2] ?? "")
      .replace(/^~~|~~$/g, "")
      .replace(/~~/g, "")
      .trim();
    if (!label) continue;

    items.push({
      label,
      status: match[1]?.toLowerCase() === "x" ? "completed" : "pending",
    });
  }

  return dedupeItems(items);
}

function parseSimpleTypedList(text: string): ChecklistItem[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("?")) return [];
  if (WRITING_REVIEW_REQUEST.test(trimmed)) return [];
  if (
    /\b(add|sum|multiply|divide|subtract|average|mean|total)\b/i.test(trimmed)
  ) {
    return [];
  }

  const parts = trimmed
    .split(/[\n,;|]+|\s+(?:and)\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length < 2) return [];
  if (!parts.every((part) => SIMPLE_ITEM_PATTERN.test(part))) return [];

  return dedupeItems(parts.map((label) => ({ label, status: "pending" })));
}

function parseInlineListSetup(message: string): {
  items: ChecklistItem[];
  targets: string[];
} | null {
  const listMatch = message.match(
    /\b(?:here is|here's|this is)\s+(?:my\s+)?(?:list|checklist)\s*:\s*([\s\S]+?)(?:\b(?:mark|cross|check|complete|finish)\b|$)/i,
  );
  if (!listMatch?.[1]) return null;

  const items = parseSimpleTypedList(listMatch[1]);
  if (!items.length) return null;

  const commandMatch = message.match(
    /\b(?:mark|cross|check|complete|finish)\b([\s\S]+?)(?:\b(?:completed|complete|done|finished|off|out)\b|$)/i,
  );
  const targets = commandMatch?.[1] ? splitTargets(commandMatch[1]) : [];

  return { items, targets };
}

function looksLikeChecklistSetup(message: string, messages: ChatMessage[]) {
  if (WRITING_REVIEW_REQUEST.test(message)) return false;

  const recentText = messages
    .slice(-6)
    .map((item) => item.content)
    .join(" ");

  if (WRITING_REVIEW_REQUEST.test(recentText)) return false;

  return (
    /\b(list|checklist|cross|crossed|check off|mark off|completed|complete|finished|done|pending|remaining)\b/i.test(
      `${recentText} ${message}`,
    ) && !/\b(discussion|post|paragraph|essay|draft)\b/i.test(recentText)
  );
}

function getState(sessionId: string) {
  return checklistSessions.get(sessionId);
}

function setState(
  sessionId: string,
  items: ChecklistItem[],
  source: ChecklistState["source"],
  sourceImage?: ChecklistState["sourceImage"],
) {
  const deduped = dedupeItems(items);
  if (!deduped.length) return null;
  const state: ChecklistState = {
    items: deduped,
    source,
    sourceImage,
    updatedAt: Date.now(),
  };
  checklistSessions.set(sessionId, state);
  return state;
}

function hydrateStateFromMessages(sessionId: string, messages: ChatMessage[]) {
  if (checklistSessions.has(sessionId))
    return checklistSessions.get(sessionId) ?? null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message?.content.includes("[ ]") &&
      !message?.content.includes("[x]")
    ) {
      continue;
    }

    const items = parseChecklistFromText(message.content);
    if (items.length) return setState(sessionId, items, "text");
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;

    const items = parseSimpleTypedList(message.content);
    if (
      items.length &&
      looksLikeChecklistSetup(message.content, messages.slice(0, index))
    ) {
      return setState(sessionId, items, "text");
    }
  }

  return null;
}

function formatChecklist(items: ChecklistItem[]) {
  return items
    .map((item) =>
      item.status === "completed"
        ? `- [x] ~~${item.label}~~`
        : `- [ ] ${item.label}`,
    )
    .join("\n");
}

function formatCompleted(items: ChecklistItem[]) {
  const completed = items.filter((item) => item.status === "completed");
  if (!completed.length) return "Nothing is marked completed yet.";

  return completed.map((item) => `- ~~${item.label}~~`).join("\n");
}

function formatPending(items: ChecklistItem[]) {
  const pending = items.filter((item) => item.status !== "completed");
  if (!pending.length)
    return "Everything on the active list is marked completed.";

  return pending.map((item) => `- ${item.label}`).join("\n");
}

function imageMarkerForState(state: ChecklistState) {
  if (!state.sourceImage) return "";

  const completedLines = state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "completed")
    .map(({ index }) => {
      const y = Math.round(((index + 1) / (state.items.length + 1)) * 1000);
      return `<line x1="90" y1="${y}" x2="910" y2="${y}" stroke="#ef4444" stroke-width="28" stroke-linecap="round" opacity="0.88" />`;
    })
    .join("");

  if (!completedLines) return "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><image href="data:${state.sourceImage.type};base64,${state.sourceImage.base64}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid meet" />${completedLines}</svg>`;
  const base64 = Buffer.from(svg, "utf-8").toString("base64");

  return `\n\n[[SVANS_IMAGE:image/svg+xml:updated-checklist.svg:${base64}]]`;
}

function extractTargetText(message: string) {
  const cleaned = message
    .replace(COMPLETE_COMMAND, "")
    .replace(
      /\b(the|item|items|number|numbers|from|on|in|my|list|checklist|already)\b/gi,
      " ",
    )
    .replace(/[,:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function splitTargets(targetText: string) {
  if (!targetText) return [];

  const numberTargets = targetText.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const textTargets = targetText
    .split(/\s+(?:and|or)\s+|[,/|]+/i)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set([...numberTargets, ...textTargets])];
}

function allTargetsMatchState(state: ChecklistState, targets: string[]) {
  const itemKeys = state.items.map((item) => normalizeLabel(item.label));
  return targets
    .map(normalizeLabel)
    .filter(Boolean)
    .every((target) =>
      itemKeys.some(
        (itemKey) =>
          itemKey === target ||
          itemKey.includes(target) ||
          target.includes(itemKey),
      ),
    );
}

function markTargetsCompleted(state: ChecklistState, targets: string[]) {
  const normalizedTargets = targets.map(normalizeLabel).filter(Boolean);
  const updatedItems = state.items.map((item) => {
    const itemKey = normalizeLabel(item.label);
    const matched = normalizedTargets.some(
      (target) =>
        itemKey === target ||
        itemKey.includes(target) ||
        target.includes(itemKey),
    );
    return matched ? { ...item, status: "completed" as const } : item;
  });

  const changed = updatedItems.some(
    (item, index) => item.status !== state.items[index]?.status,
  );

  return { changed, updatedItems };
}

export function shouldExtractChecklistFromImages(
  message: string,
  attachedFiles: AttachedFile[],
) {
  return (
    attachedFiles.some((file) => file.type.startsWith("image/")) &&
    LIST_CONTEXT_TERMS.test(message)
  );
}

export async function extractChecklistFromImages(
  sessionId: string,
  message: string,
  attachedFiles: AttachedFile[],
) {
  const images = attachedFiles.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return null;

  const prompt = `
Read the attached image(s) as a possible list or checklist.

Return ONLY valid JSON in this exact shape:
[
  { "label": "visible item text", "status": "pending" }
]

Rules:
- Extract the visible list/checklist items, including short labels like WA or numbers like 1.
- If an item is visibly crossed out, checked, marked done, or clearly finished, use "completed".
- Otherwise use "pending".
- Do not include explanations.

User message:
${message}
`.trim();

  const systemInstruction =
    "You extract checklist/list items from images into strict JSON. Return only JSON.";

  const extracted =
    (await generateWithGemini({
      prompt,
      systemInstruction,
      temperature: 0.1,
      attachedFiles: images,
    })) ??
    (await generateWithOpenAI({
      prompt,
      systemInstruction,
      temperature: 0.1,
      attachedFiles: images,
    }));

  if (!extracted) return null;
  const items = parseExtractedItems(extracted);
  return setState(sessionId, items, "image", {
    type: images[0].type,
    base64: images[0].base64,
  });
}

export function handleChecklistRequest(
  message: string,
  sessionId: string,
  messages: ChatMessage[] = [],
): string | null {
  if (WRITING_REVIEW_REQUEST.test(message)) return null;
  if (
    !/\b(list|checklist|cross|crossed|check off|mark off|completed|complete|finished|done|pending|remaining|left|unfinished|updated list)\b/i.test(
      message,
    )
  ) {
    return null;
  }

  let state =
    getState(sessionId) ?? hydrateStateFromMessages(sessionId, messages);

  if (!state) {
    const inlineSetup = parseInlineListSetup(message);
    if (inlineSetup) {
      state = setState(sessionId, inlineSetup.items, "text");
      if (state && inlineSetup.targets.length) {
        const { updatedItems } = markTargetsCompleted(
          state,
          inlineSetup.targets,
        );
        checklistSessions.set(sessionId, {
          ...state,
          items: updatedItems,
          updatedAt: Date.now(),
        });
        return `Here is the updated active list for this chat:\n\n${formatChecklist(
          updatedItems,
        )}`;
      }

      if (state) {
        return `Here is the active list for this chat:\n\n${formatChecklist(
          state.items,
        )}\n\nSend the completed items, and I’ll cross them off.`;
      }
    }

    const typedItems = parseSimpleTypedList(message);
    if (typedItems.length && looksLikeChecklistSetup(message, messages)) {
      state = setState(sessionId, typedItems, "text");
      if (state) {
        return `Here is the active list for this chat:\n\n${formatChecklist(state.items)}\n\nSend the completed items, and I’ll cross them off.`;
      }
    }
  }

  if (!state) return null;

  if (COMPLETED_REQUEST.test(message)) {
    return `Completed so far:\n\n${formatCompleted(state.items)}`;
  }

  if (PENDING_REQUEST.test(message)) {
    return `Still left:\n\n${formatPending(state.items)}`;
  }

  if (ACTIVE_LIST_REQUEST.test(message)) {
    return `Here’s the current list:\n\n${formatChecklist(state.items)}${imageMarkerForState(state)}`;
  }

  const simpleTargets = parseSimpleTypedList(message).map((item) => item.label);
  if (
    simpleTargets.length &&
    allTargetsMatchState(state, simpleTargets) &&
    !ACTIVE_LIST_REQUEST.test(message) &&
    !PENDING_REQUEST.test(message) &&
    !COMPLETED_REQUEST.test(message)
  ) {
    const { changed, updatedItems } = markTargetsCompleted(
      state,
      simpleTargets,
    );
    if (changed) {
      checklistSessions.set(sessionId, {
        ...state,
        items: updatedItems,
        updatedAt: Date.now(),
      });

      return `Updated active list for this chat:\n\n${formatChecklist(updatedItems)}${imageMarkerForState(
        {
          ...state,
          items: updatedItems,
        },
      )}`;
    }
  }

  if (!COMPLETE_COMMAND.test(message)) return null;

  const targets = splitTargets(extractTargetText(message));
  if (!targets.length && VISIBLE_COMPLETED_REQUEST.test(message)) {
    return `Here’s the current list with completed items crossed out:\n\n${formatChecklist(state.items)}${imageMarkerForState(state)}`;
  }

  if (!targets.length) {
    return `I have the active list, but I need to know which item to cross off.\n\nCurrent list:\n\n${formatChecklist(state.items)}`;
  }

  const { changed, updatedItems } = markTargetsCompleted(state, targets);
  if (!changed) {
    return `I found the active list, but I couldn’t match "${targets.join(", ")}" to an item.\n\nCurrent list:\n\n${formatChecklist(state.items)}`;
  }

  checklistSessions.set(sessionId, {
    ...state,
    items: updatedItems,
    updatedAt: Date.now(),
  });

  return `Updated active list for this chat:\n\n${formatChecklist(updatedItems)}${imageMarkerForState(
    {
      ...state,
      items: updatedItems,
    },
  )}`;
}
