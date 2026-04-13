import { supabase } from "@/lib/supabase";
import type { ChatMessage } from "@/components/AIHelper";

export type ConversationRecord = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRecord = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export async function listConversations(userId: string): Promise<ConversationRecord[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id,user_id,title,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("LIST_CONVERSATIONS_ERROR:", error);
    return [];
  }

  return (data ?? []) as ConversationRecord[];
}

export async function createConversation(
  userId: string,
  firstMessage?: string
): Promise<ConversationRecord | null> {
  const title = buildConversationTitle(firstMessage);

  const { data, error } = await supabase
    .from("conversations")
    .insert([{ user_id: userId, title }])
    .select("id,user_id,title,created_at,updated_at")
    .single();

  if (error) {
    console.error("CREATE_CONVERSATION_ERROR:", error);
    return null;
  }

  return data as ConversationRecord;
}

export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (error) {
    console.error("UPDATE_CONVERSATION_TITLE_ERROR:", error);
  }
}

export async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (error) {
    console.error("TOUCH_CONVERSATION_ERROR:", error);
  }
}

export async function getConversationMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("role,content,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("GET_MESSAGES_ERROR:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as string,
  }));
}

export async function appendMessages(
  conversationId: string,
  messages: ChatMessage[]
): Promise<void> {
  if (!messages.length) return;

  const rows = messages.map((m) => ({
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
  }));

  const { error } = await supabase.from("conversation_messages").insert(rows);

  if (error) {
    console.error("APPEND_MESSAGES_ERROR:", error);
    return;
  }

  await touchConversation(conversationId);
}

export async function replaceConversationMessages(
  conversationId: string,
  messages: ChatMessage[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("conversation_messages")
    .delete()
    .eq("conversation_id", conversationId);

  if (deleteError) {
    console.error("REPLACE_MESSAGES_DELETE_ERROR:", deleteError);
    return;
  }

  await appendMessages(conversationId, messages);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) {
    console.error("DELETE_CONVERSATION_ERROR:", error);
  }
}

export function buildConversationTitle(firstMessage?: string): string {
  const fallback = "New Chat";
  if (!firstMessage?.trim()) return fallback;
  const clean = firstMessage.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}
