import type { RepositoryReader } from "./indexer";
import { snapshotPath } from "@/lib/execution/scope";

/** Local read permission is not permission to upload files; the Lab review remains separate. */
export async function desktopRepositoryReader(): Promise<RepositoryReader> {
  const bridge = typeof window !== "undefined" ? window.svansDesktop : undefined;
  if (!bridge) throw new Error("Select a folder in the desktop app first.");
  const initial = (await bridge.status()).workspace;
  if (!initial.root || initial.expired || initial.mode === "none") throw new Error("No active workspace permission.");
  const check = async () => {
    const current = (await bridge.status()).workspace;
    if (current.expired || current.mode === "none" || current.root !== initial.root ||
        current.mode !== initial.mode || current.expiresAt !== initial.expiresAt) throw new Error("Workspace permission changed. Start a new selective read.");
  };
  return { read: async (value) => {
    const path = snapshotPath(value); await check();
    const result = await bridge.readFile(path); await check();
    if (!result.allowed) {
      if (/ENOENT|not found|does not exist/i.test(result.reason)) return null;
      throw new Error(result.reason || "Workspace read denied.");
    }
    return typeof result.content === "string" ? result.content : null;
  } };
}
