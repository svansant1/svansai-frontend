import { randomUUID } from "node:crypto";
import { orchestrateChat } from "@/lib/platform/orchestrator";
import { storeArtifact } from "@/lib/artifacts/storage";
import { isImageGenerationRequest, isImageEditingRequest } from "@/lib/ai/image-generation";
import { detectArtifactRequest } from "@/lib/artifacts/request-parser";
import { claimJob, heartbeatJob, finishJob, jobsEnabled, appendJobEvent } from "./store";
import { JOB_LIMITS, parseJobPayload } from "./types";
import { parseCyberBinding, resolveCyberJobContext, type StoredGenerationPayload } from "./cyber-context";
import { assertCyberRequestCurrent, type TrustedRequestContext } from "@/lib/platform/request-context";
import { watchOwnerGrant, OwnerAccessError } from "@/lib/auth/owner-session";
import { hashJobPayload } from "./payload-hash";
import { storeContextArtifact } from "@/lib/artifacts/context-publication";

/** This worker can generate replies/files only. External actions are deliberately not installed. */
export async function runNextJob(workerId = randomUUID(), shutdown?: AbortSignal): Promise<boolean> {
  if (!jobsEnabled()) throw new Error("Background jobs are disabled.");
  const job = await claimJob(workerId);
  if (!job) return false;
  const controller = new AbortController();
  let heartbeatBusy = false;
  let disposeOwnerWatch: (() => void) | undefined;
  const cancel = () => controller.abort();
  shutdown?.addEventListener("abort", cancel, { once: true });
  if (shutdown?.aborted) cancel();
  const deadline = setTimeout(cancel, JOB_LIMITS.taskMs);
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try { if (!await heartbeatJob(job)) cancel(); } catch { cancel(); }
    finally { heartbeatBusy = false; }
  }, 10_000);
  try {
    const { _cyber, ...unprivileged } = job.payload as StoredGenerationPayload;
    const payload = parseJobPayload(unprivileged);
    let trustedContext: TrustedRequestContext | undefined;
    if (_cyber) {
      if (hashJobPayload(job.payload) !== job.payload_hash) throw new OwnerAccessError("Queued payload changed. Submit a new task.");
      trustedContext = await resolveCyberJobContext(job, parseCyberBinding(_cyber, "generation"), controller.signal);
      const currentContext = trustedContext;
      const watch = watchOwnerGrant(currentContext.ownerGrant, controller.signal, () => assertCyberRequestCurrent(currentContext));
      disposeOwnerWatch = watch.dispose;
      trustedContext.signal = watch.signal;
    }
    const latest = [...payload.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (!detectArtifactRequest(latest) && (isImageGenerationRequest(latest) || isImageEditingRequest(latest))) {
      await finishJob(job, null, "BACKGROUND_IMAGE_STORAGE_NOT_ENABLED"); return true;
    }
    const result = await orchestrateChat({ ...payload, userId: job.user_id, sessionId: `job:${job.id}`, requestId: job.id, isVerifiedOwner: Boolean(trustedContext), trustedContext, signal: trustedContext?.signal ?? controller.signal,
      onExecutionEvent: (event) => appendJobEvent(job, event) });
    if (controller.signal.aborted) { await finishJob(job, null, "CANCELLED_OR_DEADLINE"); return true; }
    if (result.executionEvents.some((event) => ["failed", "blocked", "cancelled"].includes(event.state))) { await finishJob(job, null, "CAPABILITY_FAILED"); return true; }
    if (trustedContext) await assertCyberRequestCurrent(trustedContext);
    const artifact = result.artifact ? trustedContext
      ? await storeContextArtifact(trustedContext, result.artifact, job)
      : await storeArtifact(job.user_id, result.artifact) : undefined;
    if (trustedContext) await assertCyberRequestCurrent(trustedContext);
    if (controller.signal.aborted) await finishJob(job, null, "CANCELLED_OR_DEADLINE");
    else await finishJob(job, { text: result.text, ...(artifact ? { artifact } : {}), executionEvents: result.executionEvents }, null);
  } catch (error) {
    await finishJob(job, null, error instanceof OwnerAccessError ? "OWNER_LOCKED_OR_CONTEXT_CHANGED" : controller.signal.aborted ? "CANCELLED_OR_DEADLINE" : "GENERATION_FAILED");
  } finally {
    clearInterval(heartbeat); clearTimeout(deadline);
    disposeOwnerWatch?.();
    shutdown?.removeEventListener("abort", cancel);
  }
  return true;
}
