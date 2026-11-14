import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { listJobEvents, jobsEnabled } from "@/lib/jobs/store";
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ error: "Background jobs are disabled." }, { status: 503, headers });
  try {
    const result = await listJobEvents(auth.userId, (await context.params).id, new URL(req.url).searchParams.get("after") || "0");
    return NextResponse.json(result, { headers });
  } catch { return NextResponse.json({ error: "Events are unavailable or this job is not accessible to your account." }, { status: 404, headers }); }
}
