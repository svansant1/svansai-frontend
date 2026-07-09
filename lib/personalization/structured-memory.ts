import { createClient } from "@supabase/supabase-js";

export type MemoryCategory = "writing_preference" | "learning_progress" | "personal_preference" | "project_context";
export type UserMemory = {
  id: string;
  category: MemoryCategory;
  summary: string;
  source: "user" | "approved_feedback" | "system_suggestion";
  confirmed: boolean;
  createdAt: string;
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
    .select("id,category,summary,source,confirmed,created_at")
    .eq("user_id", userId)
    .eq("confirmed", true)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    category: row.category,
    summary: row.summary,
    source: row.source,
    confirmed: row.confirmed,
    createdAt: row.created_at,
  }));
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
    .map((memory) => `- [${memory.category}] ${memory.summary}`)
    .join("\n")}\nUse these for personalization only. They are not factual evidence about the outside world.`;
}
