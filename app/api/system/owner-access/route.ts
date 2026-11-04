import { NextResponse } from "next/server";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";
import { isAdminCyberModeEnabled } from "@/lib/ai/cyber-mode";

export async function GET(req: Request) {
  const owner = await verifyOwnerRequest(req);
  const featureEnabled = isAdminCyberModeEnabled();

  return NextResponse.json(
    {
      owner: owner.authorized,
      cyberModeAvailable: owner.authorized && featureEnabled,
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
