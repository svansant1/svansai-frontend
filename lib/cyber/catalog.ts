import { CYBER_LIMITS, type CyberPolicy } from "./contracts";
export const CYBER_CATALOG = [{
  targetId: "training-http-fixture-v1", exerciseId: "http-headers-v1",
  title: "HTTP security-header comparison",
  description: "Compare intentionally weak and hardened responses inside a disposable fixture. This does not scan your real device or any external site.",
}] as const;
export function cyberImage(role: "scanner" | "fixture", env = process.env) {
  const image = env[role === "scanner" ? "SVANSAI_CYBER_SCANNER_IMAGE" : "SVANSAI_CYBER_FIXTURE_IMAGE"] || "";
  if (!/^(?:[a-z0-9][a-z0-9./:_-]{0,200}@)?sha256:[0-9a-f]{64}$/.test(image)) throw new Error("Cyber fixture images require immutable digests.");
  return image;
}
export function cyberPolicy(): CyberPolicy {
  return { version: 1, scannerImage: cyberImage("scanner"), fixtureImage: cyberImage("fixture"), network: "fixture-loopback-only",
    runtime: "runsc", hostWrites: false, wallTimeMs: CYBER_LIMITS.wallTimeMs, outputBytes: CYBER_LIMITS.outputBytes,
    memoryMb: CYBER_LIMITS.memoryMb, cpus: CYBER_LIMITS.cpus, pids: CYBER_LIMITS.pids };
}
export function cyberRuntimeConfigured(): boolean {
  if (process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED !== "1" || process.env.SVANSAI_JOBS_ENABLED !== "1" || process.env.SVANSAI_CYBER_EXECUTION_ENABLED !== "1") return false;
  try { cyberPolicy(); return true; } catch { return false; }
}
