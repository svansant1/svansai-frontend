import { supabase } from "@/lib/supabase";

// ─── Log a page view — unique per visitor ─────────────────────────────────────
// visitorId comes from localStorage (persists forever across sessions)
// Only logs if this visitor has never been counted before
export async function logPageView(params: {
  path: string;
  visitorId: string;
  sessionId: string;
  userId?: string | null;
  userAgent?: string;
}): Promise<void> {
  // Try with visitor_id first (after SQL migration is run)
  const { error } = await supabase.from("page_views").insert([
    {
      path: params.path,
      visitor_id: params.visitorId,
      session_id: params.sessionId,
      user_id: params.userId ?? null,
      user_agent: params.userAgent ?? null,
    },
  ]);

  if (error) {
    // If visitor_id column doesn't exist yet, fall back to session_id only
    if (error.message?.includes("visitor_id")) {
      const { error: fallbackError } = await supabase.from("page_views").insert([
        {
          path: params.path,
          session_id: params.sessionId,
          user_id: params.userId ?? null,
          user_agent: params.userAgent ?? null,
        },
      ]);
      if (fallbackError) {
        console.error("LOG_PAGE_VIEW_FALLBACK_ERROR:", fallbackError);
      }
    } else {
      console.error("LOG_PAGE_VIEW_ERROR:", error);
    }
  }
}

// ─── Check if this visitor has been counted before ───────────────────────────
export async function hasVisitorBeenCounted(visitorId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("page_views")
      .select("id")
      .eq("visitor_id", visitorId)
      .limit(1);

    if (error) return false; // column missing — treat as not counted
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── Get total unique visitor count ──────────────────────────────────────────
export async function getTotalViews(): Promise<number> {
  // Try unique visitor count first
  try {
    const { data, error } = await supabase
      .from("page_views")
      .select("visitor_id")
      .not("visitor_id", "is", null);

    if (!error && data) {
      // Count unique visitor_ids
      const unique = new Set(data.map((r) => r.visitor_id)).size;
      return unique;
    }
  } catch {
    // fall through
  }

  // Fallback — just count total rows if visitor_id not available
  const { count, error } = await supabase
    .from("page_views")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("GET_TOTAL_VIEWS_ERROR:", error);
    return 0;
  }

  return count ?? 0;
}

// ─── Submit per-message feedback ─────────────────────────────────────────────
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

// ─── Get feedback summary for a conversation ──────────────────────────────────
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
    if (!summary[idx]) summary[idx] = { up: 0, down: 0 };
    if (row.vote === "up") summary[idx].up += 1;
    if (row.vote === "down") summary[idx].down += 1;
  }

  return summary;
}
