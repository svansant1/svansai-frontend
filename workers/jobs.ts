import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { runNextJob } from "@/lib/jobs/runner";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
async function main() {
  const worker = randomUUID();
  while (!shutdown.signal.aborted) {
    let busy = false;
    try { busy = await runNextJob(worker, shutdown.signal); }
    catch { console.error("Background worker storage or execution unavailable; retrying after backoff."); }
    if (!busy) { try { await delay(5_000, undefined, { signal: shutdown.signal }); } catch { break; } }
  }
}
void main().catch(() => { process.exitCode = 1; });
