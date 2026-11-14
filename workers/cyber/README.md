# Isolated Cyber fixture worker

SOURCE ONLY — not built, started or verified.

This is separate from Next.js, Electron, the generation worker and offline
Data/Code Lab workers. Never import this supervisor into a browser bundle.
The worker claims only kind=cyber jobs. Fixtures cannot access its database keys.

## Acceptance-host prerequisites

Use a dedicated non-root Linux account with a rootless Docker socket at
/run/user/<uid>/docker.sock, cgroup v2 resource enforcement, seccomp and
gVisor/runsc. The supervisor uses only /usr/bin/docker with an explicit minimal
environment. It refuses missing isolation features.

The fixture and scanner require a reviewed Node base supporting fetch and
AbortSignal.timeout. Both Dockerfiles require NODE_BASE; supply an immutable
reviewed digest, not a floating tag. No base/image digest has been fabricated.
Image building, scanning, installation and any network download require the later
acceptance approval. The runtime uses --pull=never.

Configure the resulting immutable scanner and fixture digests consistently on
web and worker processes. Change of image/policy invalidates old approvals.
Do not enable SVANSAI_CYBER_EXECUTION_ENABLED until containment is accepted.
SVANSAI_ADMIN_CYBER_MODE_ENABLED, SVANSAI_JOBS_ENABLED, private database setup,
owner identity and provider settings are independent prerequisites.

The future launch entry is npm run worker:cyber. **It was not executed.**
Port 47840 on loopback is an OS-owned single-supervisor lock, not a public server.
Run one supervisor per dedicated host/account. Reconcile old tagged containers
before work; never share the dedicated daemon with untrusted operators/workloads.

## Network model

The fixture has --network=none and binds its synthetic HTTP service to loopback.
The scanner joins that fixture container's network namespace, not a Docker bridge.
Neither gets a gateway, host namespace, published port or mounted Docker socket.
Verify gVisor/rootless namespace sharing on the chosen host; unsupported behavior
must remain unavailable. Do not replace it with host networking to make it run.

## Failure and recovery

Execution is bounded to 60 seconds. Logs share a 64 KiB stdout/stderr budget.
The scanner is removed before the fixture in the cleanup path, even on cancel.
Cleanup calls ignore the cancelled request signal. Unconfirmed cleanup stops the
worker. A lost lease or uncertain run is indeterminate and is never replayed.

During later recovery, inspect the durable run ID, execution events, labelled
containers and original approval. Resolve cleanup manually, record the outcome,
then propose a new run if still desired. Do not reset an uncertain job to queued.

The fixture results describe only synthetic HTTP header behavior. Missing headers
are observations for training, not proof of compromise or a production risk score.
