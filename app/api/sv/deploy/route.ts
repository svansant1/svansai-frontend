import { NextResponse } from "next/server";
import { deployCandidate, rejectCandidate } from "@/lib/ai/deployer";

export async function POST(req: Request) {
  try {
    const { candidateId, action, userId } = (await req.json()) as {
      candidateId: string;
      action: "deploy" | "reject";
      userId: string;
    };

    if (userId !== process.env.OWNER_USER_ID) {
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