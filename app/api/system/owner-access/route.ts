import { NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { isAdminCyberModeEnabled } from "@/lib/ai/cyber-mode";
import { isOwnerSession } from "@/lib/ai/instruction-handler";

export async function GET(req: Request) {
  const owner = await verifyOwnerRequest(req);
  const featureEnabled = isAdminCyberModeEnabled();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  const ownerSessionUnlocked =
    Boolean(sessionId) && isOwnerSession(sessionId);

  return NextResponse.json(
    {
      owner: owner.authorized,
      ownerSessionUnlocked,
      featureEnabled,
      cyberModeAvailable:
        owner.authorized && ownerSessionUnlocked && featureEnabled,
      scope: "owner_authorized",
      depth: "expert",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
