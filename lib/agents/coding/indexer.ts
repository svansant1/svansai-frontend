import { snapshotPath, validateSnapshotText } from "@/lib/execution/scope";

export type RepositoryReader = { read: (path: string) => Promise<string | null> };
export type IndexEntry = { path: string; content: string; sha256: string; reasons: string[]; imports: string[]; pinned: boolean; lastEvidence: number };
export type IndexSnapshot = { entries: IndexEntry[]; missing: string[]; skipped: { path: string; reason: string }[]; reads: number; bytes: number; scope: "selected-files-only" };
export const INDEX_LIMITS = { reads: 80, files: 40, totalBytes: 262144, fileBytes: 32768, batch: 20, importCandidates: 80 };

export async function textHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function relativeImport(from: string, target: string): string | null {
  if (!target.startsWith(".") || target.includes("\\") || target.length > 160) return null;
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  try { return snapshotPath(parts.join("/")); } catch { return null; }
}
/** Static relative imports only; dynamic imports/aliases require explicit evidence paths. */
export function dependencyCandidates(path: string, content: string): string[] {
  const candidates = new Set<string>();
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"'\r\n]+)["']/g;
  for (const match of content.matchAll(pattern)) {
    const relative = relativeImport(path, match[1]);
    if (!relative) continue;
    if (/\.[a-z0-9]+$/i.test(relative)) {
      candidates.add(relative);
      if (/\.(js|mjs)$/.test(relative)) candidates.add(relative.replace(/\.(js|mjs)$/, ".ts"));
    } else for (const suffix of [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"]) candidates.add(relative + suffix);
    if (candidates.size >= INDEX_LIMITS.importCandidates) break;
  }
  return [...candidates].slice(0, INDEX_LIMITS.importCandidates);
}

/** Reads exact paths only. This API cannot walk or scan an entire repository. */
export class SelectiveIndex {
  private entries = new Map<string, IndexEntry>();
  private seen = new Set<string>();
  private missing: string[] = [];
  private skipped: IndexSnapshot["skipped"] = [];
  private reads = 0;
  private bytes = 0;
  constructor(private readonly reader: RepositoryReader) {}
  async expand(paths: string[], evidenceId: string, options: { pin?: boolean } = {}): Promise<IndexSnapshot> {
    if (!evidenceId.trim() || evidenceId.length > 200 || paths.length > INDEX_LIMITS.batch) throw new Error("Expansion needs a bounded path list and evidence reference.");
    for (const input of paths) {
      // A new path requires explicit evidence; read budgets apply to misses as well.
      const path = snapshotPath(input), existing = this.entries.get(path);
      if (existing) {
        if (!existing.reasons.includes(evidenceId)) existing.reasons.push(evidenceId);
        existing.pinned ||= options.pin === true; existing.lastEvidence = Date.now(); continue;
      }
      if (this.seen.has(path)) continue;
      if (this.reads >= INDEX_LIMITS.reads || this.entries.size >= INDEX_LIMITS.files) { this.skipped.push({ path, reason: "Index read/file budget reached." }); continue; }
      this.seen.add(path); this.reads++;
      const content = await this.reader.read(path);
      if (content === null) { this.missing.push(path); continue; }
      try {
        validateSnapshotText(content);
        const bytes = new TextEncoder().encode(content).byteLength;
        if (bytes > INDEX_LIMITS.fileBytes || bytes + this.bytes > INDEX_LIMITS.totalBytes) throw new Error("Index byte limit reached; choose a smaller explicit scope.");
        this.entries.set(path, { path, content, sha256: await textHash(content), reasons: [evidenceId],
          imports: dependencyCandidates(path, content), pinned: options.pin === true, lastEvidence: Date.now() });
        this.bytes += bytes;
      } catch (error) { this.skipped.push({ path, reason: error instanceof Error ? error.message : "File was excluded." }); }
    }
    return this.snapshot();
  }
  async expandDependencies(path: string, evidenceId: string): Promise<IndexSnapshot> {
    const entry = this.entries.get(path);
    if (!entry) throw new Error("Read the evidence file before expanding its dependencies.");
    // Only one explicitly requested hop. No recursive automatic fan-out.
    for (let offset = 0; offset < entry.imports.length; offset += INDEX_LIMITS.batch) {
      await this.expand(entry.imports.slice(offset, offset + INDEX_LIMITS.batch), evidenceId);
    }
    return this.snapshot();
  }
  contract(keepEvidenceIds: string[], reason: string): IndexSnapshot {
    if (!reason.trim()) throw new Error("Contraction requires a recorded reason.");
    const keep = new Set(keepEvidenceIds);
    for (const [path, entry] of this.entries) {
      // Discard stale working copies, not the incident's evidence history.
      if (!entry.pinned && !entry.reasons.some((id) => keep.has(id))) {
        this.entries.delete(path); this.seen.delete(path);
        this.bytes -= new TextEncoder().encode(entry.content).byteLength;
        this.skipped.push({ path, reason: "Contracted working set: " + reason });
      }
    }
    return this.snapshot();
  }
  snapshot(): IndexSnapshot {
    return { entries: [...this.entries.values()].map((entry) => ({ ...entry, reasons: [...entry.reasons], imports: [...entry.imports] })),
      missing: [...this.missing], skipped: this.skipped.slice(-160), reads: this.reads, bytes: this.bytes, scope: "selected-files-only" };
  }
}
