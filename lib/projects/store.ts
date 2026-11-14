import { ownerDatabase, OwnerAccessError } from "@/lib/auth/owner-session";
import type { Project } from "./types";
export async function listProjects(userId: string): Promise<Project[]> {
  const { data, error } = await ownerDatabase().from("sv_projects").select("id,user_id,name,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new OwnerAccessError("Project storage is unavailable.", 503);
  return data || [];
}
export async function createProject(userId: string, name: string): Promise<Project> {
  if (!name.trim() || name.length > 120) throw new OwnerAccessError("Use a project name of 1–120 characters.", 400);
  const { data, error } = await ownerDatabase().from("sv_projects").insert({ user_id: userId, name: name.trim() }).select("id,user_id,name,created_at").single();
  if (error || !data) throw new OwnerAccessError("Project could not be created.", 503);
  return data;
}
