import { NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { OwnerAccessError, requireSameOrigin } from "@/lib/auth/owner-session";
import { readBoundedObject } from "@/lib/api/bounded-json";
import { buildCyberRequest } from "@/lib/platform/request-context";
import { getCyber, approveCyber } from "@/lib/cyber/store";
import { cancelJob } from "@/lib/jobs/store";
const headers = { "Cache-Control": "no-store" };
type Params = { params: Promise<{ id: string }> };
async function owned(req: Request, params: Params) {
  const auth = await verifyOwnerRequest(req);
  if (!auth.authorized) throw new OwnerAccessError("Verified owner required.");
  const run = await getCyber(auth.userId, (await params.params).id);
  if (!run) throw new OwnerAccessError("Run not found.", 404);
  return run;
}
function failure(e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "Run unavailable." }, { status: e instanceof OwnerAccessError ? e.status : 400, headers }); }
export async function GET(req: Request, params: Params) {
  try {
    const run = await owned(req, params);
    return NextResponse.json({ id: run.id, state: run.state, hash: run.payload_hash, request: run.payload.request, policy: run.payload.policy,
      expiresAt: run.approval_expires_at, result: run.result, error: run.error_code }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(req: Request, params: Params) {
  try {
    requireSameOrigin(req);
    const run = await owned(req, params), body = await readBoundedObject(req, 1024);
    if (Object.keys(body).some(k => k !== "hash") || typeof body.hash !== "string") throw new Error("Approve the exact displayed payload hash.");
    const context = await buildCyberRequest(req, { userId: run.user_id, requestId: crypto.randomUUID(),
      projectId: run.payload.request.projectId, conversationId: run.payload.request.conversationId });
    await approveCyber(run, body.hash, context);
    return NextResponse.json({ approved: true }, { headers });
  } catch (e) { return failure(e); }
}
export async function DELETE(req: Request, params: Params) {
  try { requireSameOrigin(req); const run = await owned(req, params); await cancelJob(run.user_id, run.id); return NextResponse.json({ cancellationRequested: true }, { headers }); }
  catch (e) { return failure(e); }
}
