import { NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { readBoundedObject, RequestBodyError } from "@/lib/api/bounded-json";
import { OWNER_COOKIE, OwnerAccessError, cyberEnabled, recordOwnerActivity, requireSameOrigin, resolveOwnerGrant, revokeOwnerGrants, unlockOwner } from "@/lib/auth/owner-session";
import type { OwnerGrant } from "@/lib/auth/owner-grant";
import { setCyberSelection } from "@/lib/platform/request-context";

export const runtime = "nodejs";
function reply(owner: boolean, grant: OwnerGrant | null) {
  return NextResponse.json({ owner, unlocked: Boolean(grant), featureEnabled: cyberEnabled(), idleLocksAt: grant?.idleLocksAt ?? null, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
function failure(error: unknown) {
  const known = error instanceof OwnerAccessError || error instanceof RequestBodyError;
  return NextResponse.json({ error: known ? error.message : "Owner controls are unavailable; access remains locked." }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
export async function GET(req: Request) {
  try {
    const auth = await verifyOwnerRequest(req);
    if (!auth.authorized) return reply(false, null);
    return reply(true, await resolveOwnerGrant(req, auth.userId));
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    requireSameOrigin(req);
    const auth = await verifyOwnerRequest(req);
    if (!auth.authorized) throw new OwnerAccessError("Sign in as the verified owner.");
    const body = await readBoundedObject(req, 4096);
    if (body.action === "mode") {
      if (!cyberEnabled()) throw new OwnerAccessError("Cyber Lab is disabled.");
      const grant = await recordOwnerActivity(req, auth.userId);
      if (!grant) throw new OwnerAccessError("Cyber Lab is locked. Use sv unlock again.");
      if (typeof body.enabled !== "boolean" || typeof body.projectId !== "string" || typeof body.conversationId !== "string") throw new OwnerAccessError("Select a project and conversation.", 400);
      await setCyberSelection(grant, { userId: auth.userId, projectId: body.projectId, conversationId: body.conversationId }, body.enabled);
      return reply(true, grant);
    }
    if (body.action === "lock") {
      await revokeOwnerGrants(auth.userId);
      const response = reply(true, null);
      response.cookies.set(OWNER_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    }
    if (body.action === "activity") {
      const grant = await recordOwnerActivity(req, auth.userId);
      if (!grant) throw new OwnerAccessError("Cyber Lab is locked. Use sv unlock again.");
      return reply(true, grant);
    }
    if (body.action !== "unlock" || typeof body.password !== "string") throw new OwnerAccessError("Invalid owner control request.", 400);
    const { token, grant } = await unlockOwner(req, auth.userId, body.password);
    const response = reply(true, grant);
    response.cookies.set(OWNER_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
    return response;
  } catch (error) { return failure(error); }
}
