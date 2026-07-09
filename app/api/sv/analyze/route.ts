import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/self-monitor";
import { verifyOwnerRequest } from "@/lib/auth/server-owner";

export async function POST(req: Request) {
  try {
    const auth = await verifyOwnerRequest(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runMonitor("manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("ANALYZE_ROUTE_ERROR:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
