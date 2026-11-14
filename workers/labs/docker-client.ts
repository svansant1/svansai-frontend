import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { LabClient } from "@/lib/execution/client";
import { validateApprovedLab } from "@/lib/execution/client";
import type { LabEnvelope, LabReport } from "@/lib/execution/contracts";

type CommandResult = { code: number | null; stdout: string; stderr: string; reason?: "cancelled" | "timed_out" | "output_limit" };
type CommandOptions = { input?: string; timeout?: number; outputLimit?: number; signal?: AbortSignal };
const LABEL = "com.svans.lab=isolated-v1";

/** Dedicated Linux worker only. Neither Next.js nor the Electron renderer imports this. */
export class DockerLabClient implements LabClient {
  private healthy = false;
  private readonly env: NodeJS.ProcessEnv;
  constructor(private readonly docker = "/usr/bin/docker") {
    const uid = process.getuid?.();
    if (process.platform !== "linux" || !uid || docker !== "/usr/bin/docker") throw new Error("Labs require a non-root, dedicated Linux worker.");
    // Never inherit cloud keys, Git credentials, CLI contexts, or arbitrary Docker endpoints.
    this.env = { NODE_ENV: "production", PATH: "/usr/bin:/bin", HOME: "/nonexistent",
      DOCKER_CONFIG: "/nonexistent-svans-docker-config", DOCKER_HOST: `unix:///run/user/${uid}/docker.sock`, LANG: "C.UTF-8" };
  }
  private command(args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
      if (options.signal?.aborted) return resolve({ code: null, stdout: "", stderr: "", reason: "cancelled" });
      const child = spawn(this.docker, args, { env: this.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let size = 0, done = false, reason: CommandResult["reason"];
      const limit = options.outputLimit ?? 65_536;
      let killTimer: ReturnType<typeof setTimeout>;
      const stop = (why: CommandResult["reason"]) => {
        if (!reason) reason = why;
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
      };
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        const remaining = Math.max(0, limit - size);
        if (remaining) target.push(chunk.subarray(0, remaining));
        size += chunk.length;
        if (size > limit) stop("output_limit");
      };
      const timer = setTimeout(() => stop("timed_out"), options.timeout ?? 15_000);
      const cancelled = () => stop("cancelled");
      options.signal?.addEventListener("abort", cancelled, { once: true });
      const finish = (code: number | null) => {
        if (done) return; done = true;
        clearTimeout(timer); clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", cancelled);
        const clean = (parts: Buffer[]) => Buffer.concat(parts).toString("utf8")
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        resolve({ code, stdout: clean(stdout), stderr: clean(stderr), ...(reason ? { reason } : {}) });
      };
      child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
      child.on("error", () => finish(null)); child.on("close", finish);
      child.stdin.on("error", () => { /* Early exit / cancellation closes stdin. */ });
      child.stdin.end(options.input ?? "");
    });
  }
  /** Call only while holding this worker host's exclusive process lock. */
  async initialize(): Promise<void> {
    const info = await this.command(["info", "--format", "{{json .}}"]);
    if (info.code !== 0 || info.reason) throw new Error("The rootless lab daemon is unavailable.");
    const daemon = JSON.parse(info.stdout);
    if (daemon.OSType !== "linux" || daemon.CgroupVersion !== "2" || daemon.CgroupDriver === "none" ||
        !daemon.MemoryLimit || !daemon.PidsLimit || !daemon.Runtimes?.runsc ||
        !daemon.SecurityOptions?.some((option: string) => option.includes("rootless")) ||
        !daemon.SecurityOptions?.some((option: string) => option.includes("seccomp"))) {
      throw new Error("Labs require rootless Docker, cgroup v2 limits, seccomp and gVisor/runsc.");
    }
    // A crashed worker must not leave a running execution behind. Never replay its job.
    const found = await this.command(["ps", "-aq", "--filter", `label=${LABEL}`]);
    if (found.code !== 0 || found.reason) throw new Error("Could not reconcile previous lab containers.");
    for (const id of found.stdout.trim().split(/\s+/).filter(Boolean)) {
      if (!/^[0-9a-f]{12,64}$/.test(id) || !await this.remove(id)) throw new Error("Orphan cleanup failed; operator review required.");
    }
    this.healthy = true;
  }
  private async remove(name: string): Promise<boolean> {
    const result = await this.command(["rm", "--force", "--volumes", name]);
    if (result.code === 0 && !result.reason) return true;
    const filter = /^[0-9a-f]{12,64}$/.test(name) ? `id=${name}` : `name=^/${name}$`;
    const remaining = await this.command(["ps", "-aq", "--filter", filter]);
    return remaining.code === 0 && !remaining.reason && remaining.stdout.trim() === "";
  }
  private async validateImage(envelope: LabEnvelope): Promise<void> {
    const result = await this.command(["image", "inspect", envelope.policy.image]);
    if (result.code !== 0 || result.reason) throw new Error("Approved lab image is not installed; automatic pulls are disabled.");
    const image = JSON.parse(result.stdout)?.[0], config = image?.Config;
    const allowedEnv = /^(PATH|LANG|NODE_VERSION|YARN_VERSION|PYTHON_VERSION|PYTHON_SHA256|PYTHON_PIP_VERSION|PYTHON_SETUPTOOLS_VERSION|PYTHON_GET_PIP_URL|PYTHON_GET_PIP_SHA256|GPG_KEY)=/;
    if (!config || config.Labels?.["com.svans.lab.profile"] !== envelope.request.profile ||
        config.Labels?.["com.svans.lab.version"] !== "1" || config.User !== "65532:65532" ||
        Object.keys(config.Volumes ?? {}).length || (config.Env ?? []).some((entry: string) => !allowedEnv.test(entry))) {
      throw new Error("Image does not match the reviewed lab image policy.");
    }
  }
  async run(value: LabEnvelope, expectedHash: string, signal: AbortSignal): Promise<LabReport> {
    if (!this.healthy) throw new Error("The lab worker is unavailable pending safety setup or cleanup.");
    const envelope = validateApprovedLab(value, expectedHash);
    await this.validateImage(envelope);
    const { policy, request } = envelope, name = `svans-lab-${randomUUID()}`, start = Date.now();
    const report: LabReport = { requestHash: expectedHash, image: policy.image, profile: request.profile,
      status: "infrastructure_error", exitCode: null, stdout: "", stderr: "", outputTruncated: false,
      durationMs: 0, cleanupConfirmed: false, oomKilled: false };
    let createOutcomeUnknown = false;
    try {
      if (signal.aborted) { report.status = "cancelled"; return report; }
      const interpreter = request.profile === "python" ? "/usr/local/bin/python3" : "/usr/local/bin/node";
      const launcher = request.profile === "python" ? "/opt/svans/launcher.py" : "/opt/svans/launcher.cjs";
      const created = await this.command(["create", "--name", name, "--label", LABEL, "--pull=never",
        "--runtime=runsc", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--user=65532:65532", "--pids-limit", String(policy.pids), "--memory", `${policy.memoryMb}m`,
        "--memory-swap", `${policy.memoryMb}m`, "--cpus", String(policy.cpus), "--ipc=private", "--cgroupns=private",
        "--shm-size=8m", "--restart=no", "--stop-timeout=1", "--no-healthcheck", "--log-driver=none",
        "--ulimit", "nofile=256:256", "--ulimit", "core=0:0", "--workdir=/workspace",
        "--tmpfs", `/workspace:rw,noexec,nosuid,nodev,size=${policy.workspaceMb}m,uid=65532,gid=65532,mode=700`,
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=700",
        "--entrypoint", interpreter, "-i", policy.image, launcher], { signal });
      if (created.code !== 0 || created.reason) {
        createOutcomeUnknown = created.code === null || Boolean(created.reason);
        report.status = created.reason ?? "infrastructure_error"; return report;
      }
      const run = await this.command(["start", "--attach", "--interactive", name], {
        input: JSON.stringify(request), timeout: policy.wallTimeMs, outputLimit: policy.outputBytes, signal });
      report.stdout = run.stdout; report.stderr = run.stderr;
      report.outputTruncated = run.reason === "output_limit";
      if (run.reason) { report.status = run.reason; return report; }
      const inspected = await this.command(["inspect", "--format", "{{json .State}}", name]);
      if (inspected.code !== 0 || inspected.reason) return report;
      const state = JSON.parse(inspected.stdout);
      if (state.Status !== "exited" || !Number.isInteger(state.ExitCode) || state.Error) return report;
      report.exitCode = state.ExitCode; report.oomKilled = state.OOMKilled === true; report.status = "exited";
      return report;
    } finally {
      // Removing the container, not just the docker client, terminates all descendants.
      const removed = await this.remove(name);
      // A timed-out daemon create may finish after a client disconnect; absence is not proof.
      report.cleanupConfirmed = removed && !createOutcomeUnknown;
      report.durationMs = Date.now() - start;
      if (!report.cleanupConfirmed) { this.healthy = false; report.status = "infrastructure_error"; }
    }
  }
}
