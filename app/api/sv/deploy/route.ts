import { NextResponse } from "next/server";
import { deployCandidate, rejectCandidate } from "@/lib/ai/deployer";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";

export async function POST(req: Request) {
  try {
    const { candidateId, action } = (await req.json()) as {
      candidateId: string;
      action: "deploy" | "reject";
    };

    const auth = await verifyOwnerRequest(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (action === "deploy") {
      const result = await deployCandidate(candidateId);
      return NextResponse.json(result);
    }

    if (action === "reject") {
      const result = await rejectCandidate(candidateId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("DEPLOY_ROUTE_ERROR:", error);
    return NextResponse.json({ error: "Deploy failed" }, { status: 500 });
  }
}
