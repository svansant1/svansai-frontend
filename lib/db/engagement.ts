import { supabase } from "@/lib/supabase";

export async function logPageView(params: {
  path: string;
  sessionId: string;
  userId?: string | null;
  userAgent?: string;
}): Promise<void> {
  const { error } = await supabase.from("page_views").insert([
    {
      path: params.path,
      session_id: params.sessionId,
      user_id: params.userId ?? null,
      user_agent: params.userAgent ?? null,
    },
  ]);

  if (error) {
    console.error("LOG_PAGE_VIEW_ERROR:", error);
  }
}

export async function getTotalViews(): Promise<number> {
  const { count, error } = await supabase
    .from("page_views")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("GET_TOTAL_VIEWS_ERROR:", error);
    return 0;
  }

  return count ?? 0;
}

export async function submitMessageFeedback(params: {
  conversationId: string;
  messageIndex: number;
  vote: "up" | "down";
  userId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("message_feedback").insert([
    {
      conversation_id: params.conversationId,
      message_index: params.messageIndex,
      vote: params.vote,
      user_id: params.userId ?? null,
    },
  ]);

  if (error) {
    console.error("SUBMIT_MESSAGE_FEEDBACK_ERROR:", error);
  }
}

export async function getFeedbackSummary(
  conversationId: string
): Promise<Record<number, { up: number; down: number }>> {
  const { data, error } = await supabase
    .from("message_feedback")
    .select("message_index,vote")
    .eq("conversation_id", conversationId);

  if (error) {
    console.error("GET_FEEDBACK_SUMMARY_ERROR:", error);
    return {};
  }

  const summary: Record<number, { up: number; down: number }> = {};

  for (const row of data ?? []) {
    const idx = Number(row.message_index);
    if (!summary[idx]) {
      summary[idx] = { up: 0, down: 0 };
    }

    if (row.vote === "up") summary[idx].up += 1;
    if (row.vote === "down") summary[idx].down += 1;
  }

  return summary;
}