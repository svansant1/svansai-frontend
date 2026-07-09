import { NextResponse } from "next/server";
import { buildReadinessReport } from "@/lib/platform/readiness";

export async function GET() {
  const report = await buildReadinessReport();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
