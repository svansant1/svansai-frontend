import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { readStoredArtifact, listArtifactVersions } from "@/lib/artifacts/storage";
import { restoreArtifactVersion, compareArtifactVersions } from "@/lib/artifacts/versions";
import { readBoundedJson } from "@/lib/api/bounded-json";
import { consumeRateLimit } from "@/lib/api/request-guard";
import { reviseStoredArtifact } from "@/lib/artifacts/revisions";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const { id } = await context.params;
    const query = new URL(req.url).searchParams;
    if (query.get("versions") === "1") return NextResponse.json(await listArtifactVersions(auth.userId, id, query.get("before") || undefined), { headers: { "Cache-Control": "no-store" } });
    if (query.has("compare")) return NextResponse.json(await compareArtifactVersions(auth.userId, id, query.get("compare")!), { headers: { "Cache-Control": "no-store" } });
    const { reference, bytes, sourceContent } = await readStoredArtifact(auth.userId, id);
    if (query.get("recipe") === "1") {
      if (!sourceContent) return NextResponse.json({ error: "This file has no structured SVANS recipe. The original remains downloadable." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ reference, recipe: JSON.parse(sourceContent) }, { headers: { "Cache-Control": "no-store" } });
    }
    const filename = reference.name.replace(/[^\x20-\x7e]|["\\/]/g, "_");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": reference.mimeType, "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Artifact is unavailable or not accessible to this account." }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}

export async function POST(req: Request, context: Context) {
  const headers = { "Cache-Control": "no-store" };
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!consumeRateLimit("artifact-restore:" + auth.userId, 5)) return NextResponse.json({ error: "Please wait before restoring more versions." }, { status: 429, headers });
  try {
    const body = await readBoundedJson(req, 1024) as Record<string, unknown>;
    if (!body || body.action !== "restore") return NextResponse.json({ error: "Expected a restore action." }, { status: 400, headers });
    const { id } = await context.params;
    return NextResponse.json({ artifactReference: await restoreArtifactVersion(auth.userId, id) }, { status: 201, headers });
  } catch { return NextResponse.json({ error: "The version could not be restored. No existing file was overwritten." }, { status: 400, headers }); }
}

export async function PATCH(req: Request, context: Context) {
  const headers = { "Cache-Control": "no-store" };
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!consumeRateLimit("artifact-revise:" + auth.userId, 5)) return NextResponse.json({ error: "Please wait before revising more files." }, { status: 429, headers });
  try {
    const body = await readBoundedJson(req, 256 * 1024) as Record<string, unknown>;
    if (!body || typeof body.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedSha256)) throw new Error("Select the exact file version to revise.");
    const { id } = await context.params;
    return NextResponse.json({ artifactReference: await reviseStoredArtifact(auth.userId, id, body.expectedSha256, body.replacements) }, { status: 201, headers });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "The file could not be revised." }, { status: 400, headers }); }
}
