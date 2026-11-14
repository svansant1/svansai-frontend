import { randomUUID } from "node:crypto";
import { readStoredArtifact, storeArtifact } from "./storage";
import { artifactKind } from "./validation";
import { parseArtifactReference } from "./references";
import type { ArtifactFormat } from "./types";

/** A restore is an immutable new version; the source bytes and history are untouched. */
export async function restoreArtifactVersion(userId: string, sourceId: string) {
  const { reference, bytes, sourceContent } = await readStoredArtifact(userId, sourceId);
  const validated = parseArtifactReference(reference);
  return storeArtifact(userId, { ...validated, id: randomUUID(), format: validated.format as ArtifactFormat,
    kind: artifactKind(validated.format as ArtifactFormat), base64: bytes.toString("base64"), sourceContent }, sourceId);
}

/** Compare binary identity only. This is not advertised as a semantic document diff. */
export async function compareArtifactVersions(userId: string, leftId: string, rightId: string) {
  const [left, right] = await Promise.all([readStoredArtifact(userId, leftId), readStoredArtifact(userId, rightId)]);
  return { left: left.reference, right: right.reference, identicalBytes: left.reference.sha256 === right.reference.sha256,
    sizeChange: right.reference.size - left.reference.size, comparison: "binary-integrity" as const };
}
