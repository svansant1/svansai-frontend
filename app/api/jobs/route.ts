import { NextResponse } from "next/server";
import { verifyUserRequest, verifyOwnerRequest } from "@/lib/auth/server-owner";
import { requireSameOrigin, OwnerAccessError } from "@/lib/auth/owner-session";
import { buildCyberRequest } from "@/lib/platform/request-context";
import { bindCyberJob, type StoredGenerationPayload } from "@/lib/jobs/cyber-context";
import { redactEvidence } from "@/lib/context/provenance";
import { readBoundedJson } from "@/lib/api/bounded-json";
import { consumeRateLimit } from "@/lib/api/request-guard";
import { enqueueJob, jobsEnabled, listJobs } from "@/lib/jobs/store";
import { JOB_LIMITS, parseJobPayload } from "@/lib/jobs/types";
const headers = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Sign in to view background jobs." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ enabled: false, jobs: [] }, { headers });
  try { return NextResponse.json({ enabled: true, jobs: await listJobs(auth.userId) }, { headers }); }
  catch { return NextResponse.json({ error: "Background job storage is unavailable." }, { status: 503, headers }); }
}
export async function POST(req: Request) {
  const auth = await verifyUserRequest(req);
  if (!auth.authenticated) return NextResponse.json({ error: "Sign in to queue background work." }, { status: 401, headers });
  if (!jobsEnabled()) return NextResponse.json({ error: "Background jobs are not enabled." }, { status: 503, headers });
  if (!consumeRateLimit(`jobs:${auth.userId}`, 5)) return NextResponse.json({ error: "Please wait before queuing more work." }, { status: 429, headers });
  try {
    const raw = await readBoundedJson(req, JOB_LIMITS.requestBytes) as Record<string, unknown>;
    const payload: StoredGenerationPayload = parseJobPayload(raw);
    if (raw.cyberMode === true) {
      requireSameOrigin(req);
      const owner = await verifyOwnerRequest(req);
      if (!owner.authorized || owner.userId !== auth.userId) throw new OwnerAccessError("Cyber jobs require the verified owner.");
      const context = await buildCyberRequest(req, { userId: auth.userId, requestId: crypto.randomUUID(),
        projectId: String(raw.projectId || ""), conversationId: String(raw.conversationId || "") });
      payload._cyber = bindCyberJob(context);
      payload.messages = payload.messages.map(message => ({ ...message, content: redactEvidence(message.content) }));
    }
    const key = req.headers.get("idempotency-key") || "";
    const job = await enqueueJob(auth.userId, payload, key);
    return NextResponse.json({ id: job.id, state: job.state, createdAt: job.created_at }, { status: 202, headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Job was not queued." }, { status: error instanceof OwnerAccessError ? error.status : 400, headers }); }
}
