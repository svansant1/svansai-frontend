import { NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { requireSameOrigin, OwnerAccessError } from "@/lib/auth/owner-session";
import { buildCyberRequest } from "@/lib/platform/request-context";
import { readBoundedObject } from "@/lib/api/bounded-json";
import { CYBER_CATALOG, cyberRuntimeConfigured } from "@/lib/cyber/catalog";
import { parseCyberRunRequest } from "@/lib/cyber/contracts";
import { listCyber, proposeCyber } from "@/lib/cyber/store";
import { assertContextScope } from "@/lib/projects/permissions";
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  const owner = await verifyOwnerRequest(req);
  if (!owner.authorized) return NextResponse.json({ error: "Verified owner required." }, { status: 403, headers });
  try {
    const params = new URL(req.url).searchParams;
    const scope = params.has("projectId") || params.has("conversationId") ? { userId: owner.userId, projectId: params.get("projectId") || "", conversationId: params.get("conversationId") || "" } : undefined;
    if (scope) await assertContextScope(scope);
    return NextResponse.json({ configured: cyberRuntimeConfigured(), runtimeVerified: false, catalog: CYBER_CATALOG, runs: await listCyber(owner.userId, scope) }, { headers });
  }
  catch { return NextResponse.json({ error: "Cyber storage is not configured." }, { status: 503, headers }); }
}
export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const owner = await verifyOwnerRequest(req);
    if (!owner.authorized) throw new OwnerAccessError("Verified owner required.");
    const input = parseCyberRunRequest(await readBoundedObject(req, 4096));
    const context = await buildCyberRequest(req, { userId: owner.userId, requestId: crypto.randomUUID(), projectId: input.projectId, conversationId: input.conversationId });
    const run = await proposeCyber(context, input, req.headers.get("idempotency-key") || "");
    return NextResponse.json({ id: run.id, state: run.state, hash: run.payload_hash, expiresAt: run.approval_expires_at }, { status: 202, headers });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Proposal failed." }, { status: e instanceof OwnerAccessError ? e.status : 400, headers }); }
}
