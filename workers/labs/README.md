# SVANS isolated Data & Code Labs

Implementation status: **code written; NOT RUN, built, provisioned or verified**.
Do not activate these workers until the complete roadmap coding pass reaches the
user-approved acceptance phase. Ordinary chat is not an execution sandbox.

## What this slice implements

1. The signed-in owner supplies a small UTF-8 text snapshot and an exact entrypoint.
2. The server normalizes it, adds a fixed runtime policy and immutable image ID,
   hashes the complete envelope, and saves a waiting-approval job.
3. The review UI displays the exact saved files, image, limits and SHA-256.
4. The owner approves that hash within 15 minutes. Approval reserves
   one run out of a rolling 20-run/day allowance; it cannot authorize later edits.
5. A separate lab worker claims the job once, verifies its hash and current policy,
   records the start and streams the snapshot to a fresh isolated container.
6. The worker records actual exit status, stdout/stderr, limits and cleanup.
   Failed tests remain failed; a missing report never becomes “passed.”
7. Cancellation is checked by lease heartbeat. The container is forcibly removed
   on completion, timeout, output overflow, cancellation or shutdown.

There are no automatic commits, pushes, merges, deployments, database changes,
package installs, original-folder writes or network calls from submitted code.
The code does not expose an unrestricted terminal to the web server.

## Required deployment boundary (not installed by this pass)

- A **dedicated Linux VM**, not the web application host or an employee PC.
- A dedicated non-root OS account and a rootless Docker daemon at that account's
  /run/user/UID/docker.sock. The web application and container never receive this
  socket. Only the supervisor on this isolated host may access it.
- Cgroup v2 memory/PID controls, seccomp, and a reviewed gVisor runsc runtime.
  Startup fails closed when these requirements are absent.
- One supervisor per host. An exclusive loopback socket on port 47839 prevents
  concurrent supervisors from clearing each other's containers.
- Infrastructure egress rules for the **host** as well as per-container
  network isolation. The supervisor needs its own secured database connection.
- Operator monitoring for rootless-daemon health, orphan cleanup, storage retention
  and abuse. Do not expose the Docker daemon over TCP.

Containers are a security boundary with residual kernel/runtime risk, not proof
that arbitrary hostile code is harmless. gVisor plus a disposable dedicated VM
adds separation; penetration and containment checks are still pending.

## Runtime images

Source: images/python.Dockerfile, images/node.Dockerfile and their launchers.
They contain no provider credentials or application environment files. Do not
copy this repository or .env into them.

When acceptance/setup is authorized:

1. Choose reviewed, supported Python and Node base images by **actual immutable
   digest**, not latest. Pass them as PYTHON_BASE / NODE_BASE.
2. Build the images using these Dockerfiles from the repository root.
3. Record the resulting full sha256 image content ID, or a reviewed repository
   digest. These are deployment values; none has been fabricated in this repository.
4. Install those exact images on the worker beforehand. Runtime pulls are disabled.
5. Set SVANSAI_LAB_PYTHON_IMAGE and SVANSAI_LAB_NODE_IMAGE to the same immutable
   IDs on the web server and worker. Changes invalidate pending approvals.

The worker checks required image labels, non-root user, declared volumes and
environment keys. Its container arguments override entrypoint, privileges,
network, writable paths and resource limits. Generated code cannot select images,
commands, environment variables, Docker arguments or mounts.

## Configuration and storage

- Review the runtime extensions in supabase/personalization_schema.sql, then
  supabase/lab_runtime.sql. Both are **source-only setup SQL**, not applied
  migrations. Package reviewed migrations with the Supabase CLI before rollout.
- The existing job/event tables keep owner-read RLS. Approval/claim/finish
  functions are service-role-only, with owner IDs verified by the web API.
- Only the trusted web API and lab supervisor need server database credentials.
  Never pass them into the execution container, logs or frontend.
- SVANSAI_JOBS_ENABLED=1 and SVANSAI_LABS_ENABLED=1 plus both image IDs are
  required. No values were enabled or changed during this implementation pass.
- npm run worker:labs is the separate supervisor entrypoint. It was not run.
- The original generation worker claims only generation jobs, never lab jobs.

The local UI collects selected desktop files only after an explicit read action.
It does not upload them until the owner chooses to save the displayed snapshot
to the account. A subsequent approval is required to execute that snapshot.
Snapshots are stored as private job payloads. Automated retention/deletion policy
and broader project permissions remain roadmap work; avoid confidential data
until those operational policies are configured.

## Hard limits and current capabilities

| Limit | Current value |
| --- | --- |
| Input | UTF-8 text only; no archives, symlinks or binary payloads |
| File count | 50 |
| Per-file / total content | 32 KiB / 128 KiB |
| Encoded request | 192 KiB |
| Runtime | 60 seconds per run |
| CPU / RAM / processes | 1 CPU / 512 MiB / 64 |
| Workspace / temporary storage | 64 MiB / 16 MiB, ephemeral |
| Output | 64 KiB combined; exceeding it terminates the run |
| Active requests | 3 labs, within the shared 5-active-job ceiling |
| Approval window | 15 minutes; no start after expiry |
| Attempts | 1; never automatic replay |

Python supports scripts and standard-library unittest files. Node supports
JavaScript scripts and node --test files. No npm/pip installation or arbitrary
TypeScript/build toolchain is implied. Data packages, CI images, database services,
browser E2E dependencies and networked integration tests require separately
reviewed profiles. Output currently consists of text reports; exporting generated
binary output from a lab is not implemented.

A zero interpreter exit is not proof of comprehensive test coverage. Results
must not be advertised as an exact reproduction of GitHub Actions unless the
runtime, dependencies and environment have actually been matched and recorded.

## Selective coding support

lib/agents/coding/indexer.ts reads exact evidence-linked paths only. It does not
enumerate the full repository. Direct relative JS/TS imports are suggested with
bounded reads; aliases, dynamic imports and Python dependency mapping require
explicit evidence paths. Contraction evicts stale working copies, not incident
records. This is a bounded in-memory index, not durable project RAG.

hypotheses.ts ranks competing explanations using referenced support and
contradictions. Scores are **heuristics, not calibrated probabilities**. Related
evidence does not count as independent corroboration. Patch proposal is blocked
by insufficient support, unresolved contradictions or close competing hypotheses.

patches.ts creates exact-hash, narrow replacement proposals in memory. It
does not write files. Workflow/dependency/schema/policy changes require separate
scope. The credential screen is heuristic, not a complete Shield audit.

approval-package.ts loads real account-owned baseline/candidate lab records and
requires matching before/after snapshot hashes and the same runtime policy.
It produces an owner review package with explicit limits and remaining security
review. These coding helpers are not yet connected to an automatic chat-driven
investigator or a durable evidence store.

## Recovery

An expired lab lease becomes indeterminate, never queued for replay. Startup
cleans up containers bearing this supervisor's fixed managed label on its dedicated
daemon. If a create outcome or cleanup is uncertain, the supervisor stops.
An operator must inspect the old worker/container state, confirm cleanup, then
request a **new** owner-approved run if needed. Do not manually change an
indeterminate row to queued.

## Deferred acceptance

npm run test:labs is authored, **NOT RUN**. Later checks must cover auth/RLS and
cross-account reads, changed-payload approvals, expiry/daily limits, lease loss,
cancel mid-run, fork/output/memory bombs, denied network/socket/host access,
runtime image changes, orphan reconciliation and actual UI behavior.

Implementation references: [Docker run constraints](https://docs.docker.com/engine/containers/run/),
[rootless daemon isolation](https://docs.docker.com/engine/security/rootless/),
[Supabase owner row policies](https://supabase.com/docs/guides/database/postgres/row-level-security).
