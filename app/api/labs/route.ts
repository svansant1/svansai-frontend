import { NextResponse } from "next/server";
import { verifyUserRequest } from "@/lib/auth/server-owner";
import { readBoundedJson, RequestBodyError } from "@/lib/api/bounded-json";
import { consumeRateLimit } from "@/lib/api/request-guard";
import { labsEnabled, listLabJobs, proposeLab } from "@/lib/execution/store";
import { LAB_LIMITS } from "@/lib/execution/contracts";
import { jobsEnabled } from "@/lib/jobs/store";
const headers = { "Cache-Control": "no-store" };
export const runtime = "nodejs";
export async function GET(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Sign in to access your labs." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ enabled: false, jobs: [] }, { headers });
  try { return NextResponse.json({ enabled: labsEnabled(), jobs: await listLabJobs(auth.userId), limits: LAB_LIMITS }, { headers }); }
  catch { return NextResponse.json({ error: "Lab storage unavailable." }, { status: 503, headers }); }
}
export async function POST(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Sign in to propose a lab run." }, { status: 401, headers });
  if (!labsEnabled()) return NextResponse.json({ error: "Isolated labs are not enabled." }, { status: 503, headers });
  if (!consumeRateLimit(`labs:${auth.userId}`, 5)) return NextResponse.json({ error: "Wait before submitting more lab requests." }, { status: 429, headers });
  try {
    const job = await proposeLab(auth.userId, await readBoundedJson(req, LAB_LIMITS.requestBytes), req.headers.get("idempotency-key") ?? "");
    return NextResponse.json({ id: job.id, state: job.state }, { status: 202, headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Lab request was not saved." }, { status: error instanceof RequestBodyError ? error.status : 400, headers }); }
}
