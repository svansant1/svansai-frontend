import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { claimCyber, finishCyber } from "@/lib/cyber/store";
import { cyberRuntimeConfigured } from "@/lib/cyber/catalog";
import { validateApprovedCyber } from "@/lib/cyber/approvals";
import { resolveCyberJobContext } from "@/lib/jobs/cyber-context";
import { heartbeatJob, appendJobEvent } from "@/lib/jobs/store";
import type { JobRecord } from "@/lib/jobs/types";
import { assertCyberRequestCurrent } from "@/lib/platform/request-context";
import { CyberDockerClient } from "./docker-client";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort()); process.once("SIGTERM", () => shutdown.abort());
async function main() {
  if (!cyberRuntimeConfigured()) throw new Error("Cyber execution is not configured.");
  const lock = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => { lock.once("error", reject); lock.listen(47840, "127.0.0.1", resolve); });
  try {
    const client = new CyberDockerClient(), worker = randomUUID(); await client.initialize();
    while (!shutdown.signal.aborted) {
      const job = await claimCyber(worker);
      if (!job) { try { await delay(3000, undefined, { signal: shutdown.signal }); } catch { break; } continue; }
      const controller = new AbortController(), abort = () => controller.abort(), lease = job as unknown as JobRecord;
      shutdown.signal.addEventListener("abort", abort, { once: true }); if (shutdown.signal.aborted) abort();
      let timer: ReturnType<typeof setInterval> | undefined, busy = false, started = false, reconciled = false;
      try {
        const approved = validateApprovedCyber(job.payload, job.payload_hash);
        const context = await resolveCyberJobContext(job, approved.binding, controller.signal);
        const authorize = async () => {
          if (!cyberRuntimeConfigured() || controller.signal.aborted) throw new Error("Run cancelled or disabled.");
          await assertCyberRequestCurrent(context);
        };
        timer = setInterval(async () => {
          if (busy) return; busy = true;
          try { await authorize(); if (!await heartbeatJob(lease)) abort(); } catch { abort(); } finally { busy = false; }
        }, 5000); // Never records owner activity.
        await authorize();
        await appendJobEvent(lease, { sequence: 1, requestId: job.id, capabilityId: "cyber.exercise", name: "Isolated Cyber fixture",
          state: "started", at: new Date().toISOString(), detail: "Exact catalog approval verified. No real device or external network is used." });
        started = true;
        const report = await client.run(approved, job.payload_hash, job.id, controller.signal, authorize);
        const success = report.status === "exited" && report.exitCode === 0 && report.cleanupConfirmed;
        await finishCyber(job, report, success ? null : "CYBER_FIXTURE_NOT_PASSED", !report.cleanupConfirmed);
        reconciled = report.cleanupConfirmed;
        if (!reconciled) throw new Error("Cleanup unknown.");
      } catch {
        if (!reconciled) await finishCyber(job, null, started ? "CYBER_OUTCOME_UNKNOWN" : "AUTHORIZATION_OR_APPROVAL_INVALID", started).catch(() => undefined);
        if (started && !reconciled) throw new Error("Stop after uncertain outcome. Operator reconciliation required.");
      } finally { if (timer) clearInterval(timer); shutdown.signal.removeEventListener("abort", abort); }
    }
  } finally { lock.close(); }
}
void main().catch(() => { console.error("Cyber supervisor stopped. Review authorization, queue leases and fixture cleanup before restarting."); process.exitCode = 1; });
