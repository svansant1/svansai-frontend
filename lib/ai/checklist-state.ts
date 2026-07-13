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

function getState(sessionId: string) {
  return checklistSessions.get(sessionId);
}

function setState(
  sessionId: string,
  items: ChecklistItem[],
  source: ChecklistState["source"],
) {
  const deduped = dedupeItems(items);
  if (!deduped.length) return null;
  const state: ChecklistState = {
    items: deduped,
    source,
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
  return setState(sessionId, items, "image");
}

export function handleChecklistRequest(
  message: string,
  sessionId: string,
  messages: ChatMessage[] = [],
): string | null {
  const state =
    getState(sessionId) ?? hydrateStateFromMessages(sessionId, messages);
  if (!state) return null;

  if (COMPLETED_REQUEST.test(message)) {
    return `Completed so far:\n\n${formatCompleted(state.items)}`;
  }

  if (PENDING_REQUEST.test(message)) {
    return `Still left:\n\n${formatPending(state.items)}`;
  }

  if (ACTIVE_LIST_REQUEST.test(message)) {
    return `Here’s the current list:\n\n${formatChecklist(state.items)}`;
  }

  if (!COMPLETE_COMMAND.test(message)) return null;

  const targets = splitTargets(extractTargetText(message));
  if (!targets.length && VISIBLE_COMPLETED_REQUEST.test(message)) {
    return `Here’s the current list with completed items crossed out:\n\n${formatChecklist(state.items)}`;
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

  return `Done — I crossed that off.\n\nUpdated list:\n\n${formatChecklist(updatedItems)}`;
}
