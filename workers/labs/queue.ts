import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { claimLab, finishLab, labsEnabled } from "@/lib/execution/store";
import { heartbeatJob, appendJobEvent } from "@/lib/jobs/store";
import type { JobRecord } from "@/lib/jobs/types";
import { validateApprovedLab } from "@/lib/execution/client";
import { DockerLabClient } from "./docker-client";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
async function main() {
  if (!labsEnabled()) throw new Error("Labs are disabled or images are not pinned.");
  // OS-owned socket lock releases on crashes; one lab supervisor per dedicated host.
  const lock = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    lock.once("error", reject); lock.listen(47839, "127.0.0.1", resolve);
  });
  try {
    const client = new DockerLabClient(), workerId = randomUUID();
    await client.initialize();
    while (!shutdown.signal.aborted) {
      // Only this separate worker claims lab jobs; ordinary chat workers cannot.
      const job = await claimLab(workerId);
      if (!job) { try { await delay(3000, undefined, { signal: shutdown.signal }); } catch { break; } continue; }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      shutdown.signal.addEventListener("abort", cancel, { once: true });
      if (shutdown.signal.aborted) cancel();
      let heartbeatBusy = false, startedExecution = false;
      const leaseJob = job as unknown as JobRecord;
      const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try { if (!await heartbeatJob(leaseJob)) cancel(); } catch { cancel(); }
        finally { heartbeatBusy = false; }
      }, 5000);
      try {
        const approved = validateApprovedLab(job.payload, job.payload_hash);
        await appendJobEvent(leaseJob, { sequence: 1, requestId: job.id, capabilityId: "lab.execute", name: "Isolated lab",
          state: "started", at: new Date().toISOString(), detail: "Approved snapshot verified. Network and host writes are disabled." });
        if (controller.signal.aborted) { await finishLab(job, null, "CANCELLED_BEFORE_START"); continue; }
        startedExecution = true;
        const report = await client.run(approved, job.payload_hash, controller.signal);
        const success = report.status === "exited" && report.exitCode === 0 && !report.oomKilled && report.cleanupConfirmed;
        const result = { text: `Lab ${report.status}; exit code ${report.exitCode ?? "unavailable"}. Cleanup ${report.cleanupConfirmed ? "confirmed" : "unconfirmed"}. No original project files were changed.`,
          executionEvents: [], lab: report };
        await finishLab(job, result, success ? null : "LAB_RUN_NOT_PASSED", !report.cleanupConfirmed);
        if (!report.cleanupConfirmed) throw new Error("Cleanup unknown; worker must stop.");
      } catch {
        // We cannot infer a passing run from missing output or restart after uncertainty.
        await finishLab(job, null, startedExecution ? "LAB_EXECUTION_UNKNOWN" : "LAB_POLICY_OR_APPROVAL_INVALID", startedExecution).catch(() => undefined);
        if (startedExecution) throw new Error("Lab worker stopped after an uncertain outcome; operator reconciliation required.");
      } finally {
        clearInterval(heartbeat);
        shutdown.signal.removeEventListener("abort", cancel);
      }
    }
  } finally { lock.close(); }
}
void main().catch(() => { console.error("Isolated lab worker stopped. Review configuration, queue state, and container cleanup before restarting."); process.exitCode = 1; });
