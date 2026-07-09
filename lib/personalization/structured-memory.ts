import { createClient } from "@supabase/supabase-js";

export type MemoryCategory = "writing_preference" | "learning_progress" | "personal_preference" | "project_context";
export type UserMemory = {
  id: string;
  category: MemoryCategory;
  summary: string;
  source: "user" | "approved_feedback" | "system_suggestion";
  confirmed: boolean;
  createdAt: string;
  updatedAt?: string;
  relevanceScore?: number;
};

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadUserMemories(userId: string): Promise<UserMemory[]> {
  const supabase = serverClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("user_memories")
    .select("id,category,summary,source,confirmed,created_at,updated_at")
    .eq("user_id", userId)
    .eq("confirmed", true)
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error || !data) return [];
  return data
    .map((row) => {
      const memory = {
        id: row.id,
        category: row.category,
        summary: row.summary,
        source: row.source,
        confirmed: row.confirmed,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      return { ...memory, relevanceScore: rankMemory(memory) };
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 30);
}

function rankMemory(memory: Pick<UserMemory, "summary" | "source" | "confirmed" | "createdAt" | "updatedAt" | "category">): number {
  const updated = new Date(memory.updatedAt ?? memory.createdAt).getTime();
  const ageDays = Number.isFinite(updated) ? Math.max(0, (Date.now() - updated) / 86_400_000) : 365;
  const recency = Math.max(0, 1 - ageDays / 120);
  const approval = memory.confirmed ? 1 : 0.25;
  const sourceWeight = memory.source === "user" ? 1 : memory.source === "approved_feedback" ? 0.8 : 0.55;
  const importanceSignals = /\b(always|never|prefer|important|remember|project|voice|style|goal|deadline|class|course)\b/i.test(memory.summary)
    ? 1
    : 0.45;
  const categoryWeight = memory.category === "project_context" || memory.category === "writing_preference" ? 0.85 : 0.65;

  return Number(
    (recency * 0.3 + approval * 0.25 + sourceWeight * 0.15 + importanceSignals * 0.2 + categoryWeight * 0.1).toFixed(4),
  );
}

export async function addUserMemory(
  userId: string,
  input: Pick<UserMemory, "category" | "summary">,
): Promise<void> {
  const supabase = serverClient();
  if (!supabase) throw new Error("Memory storage is not configured.");
  const summary = input.summary.trim().slice(0, 1200);
  if (summary.length < 3) throw new Error("Memory is too short.");
  const { error } = await supabase.from("user_memories").insert({
    user_id: userId,
    category: input.category,
    summary,
    source: "user",
    confirmed: true,
  });
  if (error) throw new Error("Unable to save memory.");
}

export async function deleteUserMemory(userId: string, id?: string): Promise<void> {
  const supabase = serverClient();
  if (!supabase) throw new Error("Memory storage is not configured.");
  let query = supabase.from("user_memories").delete().eq("user_id", userId);
  if (id) query = query.eq("id", id);
  const { error } = await query;
  if (error) throw new Error("Unable to delete memory.");
}

export function formatUserMemories(memories: UserMemory[]): string {
  if (!memories.length) return "No confirmed persistent user memories are loaded.";
  return `Confirmed user-controlled memories:\n${memories
    .slice(0, 20)
    .map((memory) => `- [${memory.category}; relevance ${memory.relevanceScore ?? "n/a"}] ${memory.summary}`)
    .join("\n")}\nUse these for personalization only. They are not factual evidence about the outside world.`;
}
