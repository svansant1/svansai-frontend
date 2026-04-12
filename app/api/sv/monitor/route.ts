import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/self-monitor";

const MONITOR_SECRET = process.env.MONITOR_SECRET;

export async function POST(req: Request) {
  const auth = req.headers.get("Authorization");

  if (!MONITOR_SECRET || auth !== `Bearer ${MONITOR_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMonitor("cron");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("MONITOR_ROUTE_ERROR:", error);
    return NextResponse.json({ error: "Monitor failed" }, { status: 500 });
  }
}