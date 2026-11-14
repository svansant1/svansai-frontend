import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateApprovedCyber } from "@/lib/cyber/approvals";
import type { CyberEnvelope, CyberRunReport } from "@/lib/cyber/contracts";
type Result = { code: number | null; stdout: string; stderr: string; reason?: "cancelled" | "timed_out" | "output_limit" };
const LABEL = "com.svans.cyber=fixture-v1";

/** Server-only supervisor. No arbitrary command, image, host mount or external target input. */
export class CyberDockerClient {
  private healthy = false;
  private readonly env: NodeJS.ProcessEnv;
  constructor() {
    const uid = process.getuid?.();
    if (process.platform !== "linux" || !uid) throw new Error("A dedicated non-root Linux worker is required.");
    this.env = { NODE_ENV: "production", PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C.UTF-8",
      DOCKER_CONFIG: "/nonexistent-svans-docker-config", DOCKER_HOST: "unix:///run/user/" + uid + "/docker.sock" };
  }
  private command(args: string[], signal?: AbortSignal, timeout = 15000, limit = 65536): Promise<Result> {
    return new Promise(resolve => {
      if (signal?.aborted) return resolve({ code: null, stdout: "", stderr: "", reason: "cancelled" });
      const child = spawn("/usr/bin/docker", args, { shell: false, env: this.env, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let size = 0, done = false, reason: Result["reason"], kill: ReturnType<typeof setTimeout> | undefined;
      const stop = (why: Result["reason"]) => { reason ??= why; child.kill("SIGTERM"); kill ??= setTimeout(() => child.kill("SIGKILL"), 1000); };
      const collect = (list: Buffer[]) => (chunk: Buffer) => {
        if (size < limit) list.push(chunk.subarray(0, limit - size));
        size += chunk.length;
        if (size > limit) stop("output_limit");
      };
      const timer = setTimeout(() => stop("timed_out"), timeout), abort = () => stop("cancelled");
      signal?.addEventListener("abort", abort, { once: true });
      const finish = (code: number | null) => {
        if (done) return; done = true;
        clearTimeout(timer); clearTimeout(kill); signal?.removeEventListener("abort", abort);
        const clean = (list: Buffer[]) => Buffer.concat(list).toString("utf8").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        resolve({ code, stdout: clean(stdout), stderr: clean(stderr), ...(reason ? { reason } : {}) });
      };
      child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
      child.once("error", () => finish(null)); child.once("close", finish);
      if (signal?.aborted) abort();
    });
  }
  private async remove(name: string) {
    await this.command(["rm", "--force", "--volumes", name]);
    const check = await this.command(["ps", "-aq", "--filter", /^[a-f0-9]{12,64}$/.test(name) ? "id=" + name : "name=^/" + name + "$"]);
    return check.code === 0 && !check.reason && !check.stdout.trim();
  }
  async initialize() {
    const info = await this.command(["info", "--format", "{{json .}}"]);
    if (info.code !== 0 || info.reason) throw new Error("Rootless daemon unavailable.");
    const d = JSON.parse(info.stdout);
    if (d.OSType !== "linux" || d.CgroupVersion !== "2" || d.CgroupDriver === "none" || !d.MemoryLimit || !d.PidsLimit || !d.Runtimes?.runsc ||
      !d.SecurityOptions?.some((v: string) => v.includes("rootless")) || !d.SecurityOptions?.some((v: string) => v.includes("seccomp"))) throw new Error("Containment prerequisites unavailable.");
    const orphans = await this.command(["ps", "-aq", "--filter", "label=" + LABEL]);
    if (orphans.code !== 0 || orphans.reason) throw new Error("Orphan discovery failed.");
    for (const id of orphans.stdout.trim().split(/\s+/).filter(Boolean)) {
      if (!/^[a-f0-9]{12,64}$/.test(id) || !await this.remove(id)) throw new Error("Orphan cleanup could not be confirmed.");
    }
    this.healthy = true;
  }
  private async image(image: string, role: "scanner" | "fixture", signal: AbortSignal) {
    const inspected = await this.command(["image", "inspect", image], signal);
    if (inspected.code !== 0 || inspected.reason) throw new Error("Reviewed image is not installed. Automatic pulls are disabled.");
    const c = JSON.parse(inspected.stdout)?.[0]?.Config;
    if (!c || c.User !== "65532:65532" || c.Labels?.["com.svans.cyber.role"] !== role || c.Labels?.["com.svans.cyber.version"] !== "1" ||
      Object.keys(c.Volumes || {}).length || (c.Env || []).some((v: string) => !/^(PATH|LANG|NODE_VERSION|YARN_VERSION)=/.test(v))) throw new Error("Image does not match the reviewed policy.");
  }
  async run(value: CyberEnvelope, hash: string, runId: string, parent: AbortSignal, authorize: () => Promise<void>): Promise<CyberRunReport> {
    if (!this.healthy) throw new Error("Supervisor not ready.");
    const e = validateApprovedCyber(value, hash), started = Date.now();
    const controller = new AbortController(), abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true }); if (parent.aborted) abort();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, e.policy.wallTimeMs);
    const signal = controller.signal, fixture = "svans-cyber-fixture-" + randomUUID(), scanner = "svans-cyber-scanner-" + randomUUID();
    const report: CyberRunReport = { runId, requestHash: hash, exerciseId: e.request.exerciseId, targetId: e.request.targetId,
      targetDescription: "Disposable HTTP fixture on shared loopback; not the owner's real target.",
      status: "infrastructure_error", stdout: "", stderr: "", exitCode: null, durationMs: 0, outputTruncated: false, cleanupConfirmed: false };
    const must = (r: Result) => { if (r.reason || r.code !== 0) throw new Error("Container operation failed."); return r; };
    const check = async () => { if (signal.aborted) throw new Error("Run cancelled."); await authorize(); };
    try {
      await check(); await this.image(e.policy.fixtureImage, "fixture", signal); await this.image(e.policy.scannerImage, "scanner", signal);
      const common = ["--label", LABEL, "--pull=never", "--runtime=runsc", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--user=65532:65532", "--pids-limit", String(Math.floor(e.policy.pids / 2)), "--memory", Math.floor(e.policy.memoryMb / 2) + "m",
        "--memory-swap", Math.floor(e.policy.memoryMb / 2) + "m", "--cpus", String(e.policy.cpus / 2),
        "--ipc=private", "--cgroupns=private", "--shm-size=8m", "--restart=no", "--stop-timeout=1", "--no-healthcheck", "--log-driver=none",
        "--ulimit", "nofile=128:128", "--ulimit", "core=0:0", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=8m,uid=65532,gid=65532,mode=700",
        "--entrypoint", "/usr/local/bin/node"];
      await check();
      must(await this.command(["create", "--name", fixture, "--network=none", ...common, e.policy.fixtureImage, "/opt/svans/fixture.cjs"], signal));
      const fixtureInspect = must(await this.command(["inspect", fixture], signal));
      const f = JSON.parse(fixtureInspect.stdout)?.[0];
      if (!/^[a-f0-9]{64}$/.test(f?.Id || "") || f?.HostConfig?.NetworkMode !== "none" || f?.HostConfig?.Privileged || f?.HostConfig?.Binds?.length || Object.keys(f?.HostConfig?.PortBindings || {}).length) throw new Error("Unexpected fixture isolation.");
      await check(); must(await this.command(["start", fixture], signal));
      // Share ONLY this run's loopback namespace: no bridge, gateway, DNS or published ports.
      // If runsc cannot enforce namespace sharing, creation fails; never fall back to a bridge.
      must(await this.command(["create", "--name", scanner, "--network=container:" + f.Id, ...common, e.policy.scannerImage, "/opt/svans/scanner.cjs"], signal));
      const scannerInspect = must(await this.command(["inspect", scanner], signal)), s = JSON.parse(scannerInspect.stdout)?.[0];
      if (s?.HostConfig?.NetworkMode !== "container:" + f.Id || s?.HostConfig?.Privileged || s?.HostConfig?.Binds?.length || Object.keys(s?.HostConfig?.PortBindings || {}).length) throw new Error("Unexpected scanner isolation.");
      await check();
      const output = await this.command(["start", "--attach", scanner], signal, e.policy.wallTimeMs, e.policy.outputBytes);
      report.stdout = output.stdout; report.stderr = output.stderr; report.outputTruncated = output.reason === "output_limit";
      report.status = output.reason || (output.code === null ? "infrastructure_error" : "exited");
      if (output.code !== null && !output.reason) {
        const state = must(await this.command(["inspect", "--format", "{{json .State}}", scanner], signal));
        const actual = JSON.parse(state.stdout);
        if (actual.Running || actual.OOMKilled || actual.Error) throw new Error("Scanner outcome incomplete.");
        report.exitCode = actual.ExitCode;
      }
    } catch {
      report.status = timedOut ? "timed_out" : signal.aborted ? "cancelled" : "infrastructure_error";
    } finally {
      clearTimeout(timeout); parent.removeEventListener("abort", abort);
      // Cleanup is deliberately not cancelled with the request.
      const scannerRemoved = await this.remove(scanner), fixtureRemoved = await this.remove(fixture);
      report.cleanupConfirmed = scannerRemoved && fixtureRemoved;
      if (!report.cleanupConfirmed) this.healthy = false;
      report.durationMs = Date.now() - started;
    }
    if (timedOut) report.status = "timed_out";
    return report;
  }
}
