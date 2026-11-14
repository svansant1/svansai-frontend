import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { labsEnabled, getLabJob, decideLab } from "@/lib/execution/store";
import { cancelJob } from "@/lib/jobs/store";
import { readBoundedObject, RequestBodyError } from "@/lib/api/bounded-json";
import { consumeRateLimit } from "@/lib/api/request-guard";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  try {
    const job = await getLabJob(auth.userId, (await context.params).id);
    return NextResponse.json(job ?? { error: "Lab request not found." }, { status: job ? 200 : 404, headers });
  } catch { return NextResponse.json({ error: "Lab storage unavailable." }, { status: 503, headers }); }
}
export async function POST(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  if (!labsEnabled()) return NextResponse.json({ error: "Labs are disabled." }, { status: 503, headers });
  if (!consumeRateLimit(`lab-approval:${auth.userId}`, 10)) return NextResponse.json({ error: "Please wait." }, { status: 429, headers });
  try {
    const body = await readBoundedObject(req, 2048);
    if (typeof body.expectedHash !== "string" || (body.decision !== "approve" && body.decision !== "reject")) throw new Error("Select approve or reject for the displayed snapshot.");
    await decideLab(auth.userId, (await context.params).id, body.expectedHash, body.decision);
    return NextResponse.json({ decision: body.decision }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed." }, { status: error instanceof RequestBodyError ? error.status : 409, headers }); }
}
export async function DELETE(req: Request, context: Context) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  try {
    const id = (await context.params).id;
    if (!await getLabJob(auth.userId, id)) return NextResponse.json({ error: "Lab request not found." }, { status: 404, headers });
    await cancelJob(auth.userId, id);
    return NextResponse.json({ cancellationRequested: true }, { headers });
  } catch { return NextResponse.json({ error: "Cancellation could not be saved." }, { status: 503, headers }); }
}
