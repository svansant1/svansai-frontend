import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
export type JobState = "waiting_approval" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "indeterminate";
export type JobPayload = { messages: ChatMessage[]; responseMode: ResponseMode };
export type StoredArtifactReference = { id: string; name: string; mimeType: string; format: string; size: number; sha256: string };
export type JobResult = { text: string; artifact?: StoredArtifactReference; executionEvents: unknown[] };
export type JobRecord = {
  kind?: "generation" | "lab" | "cyber";
  id: string; user_id: string; payload: JobPayload; payload_hash: string;
  state: JobState; attempts: number; max_attempts: number; cancel_requested: boolean;
  lease_token: string | null; lease_until: string | null;
  result: JobResult | null; error_code: string | null;
  created_at: string; updated_at: string;
};
export const JOB_LIMITS = { requestBytes: 256 * 1024, messages: 50, messageCharacters: 30_000, totalCharacters: 120_000, taskMs: 180_000, attempts: 2, activePerUser: 5 } as const;
export function parseJobPayload(value: unknown): JobPayload {
  if (!value || typeof value !== "object") throw new Error("Expected a job request.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["messages", "responseMode", "files", "cyberMode", "projectId", "conversationId"].includes(key))) throw new Error("Client job requests cannot supply authorization, grant, or runtime metadata.");
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > JOB_LIMITS.messages) throw new Error("Use between 1 and 50 messages per background request.");
  let characters = 0;
  const messages = input.messages.map((entry: unknown): ChatMessage => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid message.");
    const message = entry as Record<string, unknown>;
    if (message.isPassword) throw new Error("Passwords cannot be queued.");
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || message.content.length > JOB_LIMITS.messageCharacters) throw new Error("Invalid message role or length.");
    characters += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (messages.some(message => /enter owner password\s*:/i.test(message.content) || /^sv\s+(unlock|lock)$/i.test(message.content.trim()))) throw new Error("Owner controls belong in the secure control form, not background jobs.");
  if (characters > JOB_LIMITS.totalCharacters || !messages.some((m) => m.role === "user" && m.content.trim())) throw new Error("The job needs a user request within the context limit.");
  if (input.files !== undefined) throw new Error("Background attachments require stored-file references; use ordinary chat for uploads until that connection is enabled.");
  const modes: ResponseMode[] = ["auto", "direct", "guide", "tutor", "build", "debug"];
  return { messages, responseMode: modes.includes(input.responseMode as ResponseMode) ? input.responseMode as ResponseMode : "auto" };
}
