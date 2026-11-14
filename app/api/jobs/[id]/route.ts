import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { cancelJob, getJob, jobsEnabled } from "@/lib/jobs/store";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ error: "Background jobs are not enabled." }, { status: 503, headers });
  try {
    const job = await getJob(auth.userId, (await context.params).id);
    return NextResponse.json(job || { error: "Job not found." }, { status: job ? 200 : 404, headers });
  } catch { return NextResponse.json({ error: "Job storage unavailable." }, { status: 503, headers }); }
}
export async function DELETE(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ error: "Background jobs are not enabled." }, { status: 503, headers });
  try {
    const { id } = await context.params;
    if (!await getJob(auth.userId, id)) return NextResponse.json({ error: "Job not found." }, { status: 404, headers });
    await cancelJob(auth.userId, id);
    return NextResponse.json({ cancellationRequested: true }, { headers });
  } catch { return NextResponse.json({ error: "Cancellation could not be persisted." }, { status: 503, headers }); }
}
