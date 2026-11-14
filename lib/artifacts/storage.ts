import { createHash, randomUUID } from "node:crypto";
import { runtimeDatabase, isUuid } from "@/lib/jobs/store";
import type { StoredArtifactReference } from "@/lib/jobs/types";
import type { GeneratedArtifact } from "./types";
import { validateGeneratedArtifact } from "./validation";
const BUCKET = "svans-artifacts";
const MAX_BYTES = 8 * 1024 * 1024;
const MIME: Record<string, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown" };
type ArtifactRow = { id: string; user_id: string; root_id: string; parent_id: string | null; object_path: string; name: string; format: string; mime_type: string; size: number; sha256: string; created_at: string; source_content: string | null };
export type ArtifactInsert = Omit<ArtifactRow, "created_at">;
export type ArtifactPublication = {
  assertAuthorized: () => Promise<void>;
  publishMetadata: (row: ArtifactInsert) => Promise<ArtifactRow>;
};
export class ArtifactPublicationFailure extends Error {
  constructor(message: string, public readonly outcome: "rejected" | "unknown") { super(message); this.name = "ArtifactPublicationFailure"; }
}
/** Only definite SQL rejections prove that an insert cannot commit later. */
export function publicationFailureOutcome(code?: string): "rejected" | "unknown" {
  return /^(?:22|23|42)[A-Z0-9]{3}$/.test(code || "") || ["P0001", "40001", "40P01"].includes(code || "") ? "rejected" : "unknown";
}
async function privateBucket() {
  const database = runtimeDatabase();
  const { data, error } = await database.storage.getBucket(BUCKET);
  if (error || !data || data.public) throw new Error("Private artifact storage is not configured.");
  return database;
}
async function ownArtifact(userId: string, id: string): Promise<ArtifactRow> {
  if (!isUuid(userId) || !isUuid(id)) throw new Error("Artifact not found.");
  const { data, error } = await runtimeDatabase().from("svans_artifacts").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Artifact not found.");
  return data as ArtifactRow;
}
const reference = (row: ArtifactRow): StoredArtifactReference => ({ id: row.id, name: row.name, mimeType: row.mime_type, format: row.format, size: row.size, sha256: row.sha256 });
export async function storeArtifact(userId: string, artifact: GeneratedArtifact, parentId?: string, publication?: ArtifactPublication): Promise<StoredArtifactReference> {
  await publication?.assertAuthorized();
  if (!isUuid(userId) || MIME[artifact.format] !== artifact.mimeType || artifact.base64.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("Invalid artifact.");
  const bytes = validateGeneratedArtifact(artifact);
  if (!bytes.length || bytes.length !== artifact.size || bytes.length > MAX_BYTES) throw new Error("Artifact size mismatch.");
  const parent = parentId ? await ownArtifact(userId, parentId) : null;
  const id = randomUUID();
  const path = `${userId}/${id}.${artifact.format}`;
  if (artifact.sourceContent && artifact.sourceContent.length > 100_000) throw new Error("Artifact recipe exceeds its limit.");
  const row = { id, user_id: userId, root_id: parent?.root_id ?? id, parent_id: parent?.id ?? null, object_path: path, name: artifact.name.replace(/[\r\n\\/]/g, "_").slice(0, 150), format: artifact.format, mime_type: artifact.mimeType, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), source_content: artifact.sourceContent ?? null };
  const database = await privateBucket();
  await publication?.assertAuthorized();
  const { error: uploadError } = await database.storage.from(BUCKET).upload(path, bytes, { contentType: artifact.mimeType, upsert: false });
  if (uploadError) throw new Error("Artifact storage upload failed.");
  let metadataDispatched = false;
  try {
    await publication?.assertAuthorized();
    if (publication) { metadataDispatched = true; return reference(await publication.publishMetadata(row)); }
    metadataDispatched = true;
    const { data, error } = await database.from("svans_artifacts").insert(row).select("*").single();
    if (error || !data) throw new ArtifactPublicationFailure("Artifact metadata publication was not confirmed.", publicationFailureOutcome(error?.code));
    return reference(data as ArtifactRow);
  } catch (error) {
    // Only remove this newly allocated, unpublished object, never an existing version.
    // If the server committed metadata but its response was lost, retain the valid file.
    const persisted = await database.from("svans_artifacts").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (persisted.error) throw new Error("Artifact publication outcome is unknown; reconcile this request before retrying.");
    if (persisted.data) {
      if (persisted.data.sha256 !== row.sha256 || persisted.data.object_path !== path) throw new Error("Artifact publication identity mismatch; operator reconciliation is required.");
      return reference(persisted.data as ArtifactRow);
    }
    // A negative read does NOT prove a timed-out transaction cannot commit later.
    // Retain the object on ambiguous dispatched writes for operator reconciliation.
    if (metadataDispatched && (!(error instanceof ArtifactPublicationFailure) || error.outcome !== "rejected")) {
      throw new ArtifactPublicationFailure("Artifact publication outcome is unknown; retain the upload and reconcile before retrying.", "unknown");
    }
    if (!persisted.data) {
      const cleanup = await database.storage.from(BUCKET).remove([path]);
      if (cleanup.error) throw new Error("Unpublished artifact cleanup could not be confirmed; operator reconciliation is required.");
    }
    throw error;
  }
}
export async function readStoredArtifact(userId: string, id: string): Promise<{ reference: StoredArtifactReference; bytes: Buffer; sourceContent?: string }> {
  const row = await ownArtifact(userId, id);
  if (!row.object_path.startsWith(`${userId}/`)) throw new Error("Invalid storage scope.");
  const database = await privateBucket();
  const { data, error } = await database.storage.from(BUCKET).download(row.object_path);
  if (error || !data || data.size > MAX_BYTES) throw new Error("Artifact download failed.");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== row.size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("Artifact integrity check failed.");
  return { reference: reference(row), bytes, ...(row.source_content ? { sourceContent: row.source_content } : {}) };
}
export async function listArtifactVersions(userId: string, id: string, beforeId?: string): Promise<{ versions: StoredArtifactReference[]; nextCursor: string | null }> {
  const row = await ownArtifact(userId, id);
  let query = runtimeDatabase().from("svans_artifacts").select("*").eq("user_id", userId).eq("root_id", row.root_id).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (beforeId) {
    const cursor = await ownArtifact(userId, beforeId);
    if (cursor.root_id !== row.root_id || !/^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]+$/.test(cursor.created_at)) throw new Error("Invalid version cursor.");
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  }
  const { data, error } = await query.limit(51);
  if (error) throw new Error("Version history unavailable.");
  const rows = data as ArtifactRow[];
  return { versions: rows.slice(0, 50).map(reference), nextCursor: rows.length > 50 ? rows[49].id : null };
}
