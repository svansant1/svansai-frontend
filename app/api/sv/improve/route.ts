import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/self-monitor";

export async function POST(req: Request) {
  try {
    const { userId } = (await req.json()) as { userId?: string };

    if (userId !== process.env.OWNER_USER_ID) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runMonitor("manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("IMPROVE_ROUTE_ERROR:", error);
    return NextResponse.json({ error: "Improve failed" }, { status: 500 });
  }
}