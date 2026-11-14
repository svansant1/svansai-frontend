# SVANS Cyber Lab — source integration

Updated November 12, 2026. **Not tested, built, migrated, activated, or deployed.**
This integrates authorized Cyber training into the existing shared execution
architecture. It is not an unrestricted mode, a provider-refusal bypass, or a
grant of access to every device.

## Three access gates

1. Supabase verifies the configured owner. OWNER_USER_ID is authoritative when
   set; email-only fallback requires a confirmed matching email.
2. The owner submits the password through the dedicated secure control form
   opened by sv unlock. Passwords are never conversation messages.
3. The owner explicitly switches Cyber Lab ON for an owned investigation project
   and saved conversation. The server checks the selection on every operation.

Unlock uses a random HttpOnly, SameSite=Strict session cookie. Only its hash is
stored in service-only tables. Scrypt password hashes are preferred; the existing
server-side SV_OWNER_PASSWORD setting remains a migration compatibility option.
There is no password or grant token in prompts, conversation context, job JSON,
localStorage, or tab broadcasts. Job records contain identifiers, not credentials.

## Thirty-minute idle lock

There is **no fixed maximum active-session duration**. The database locks a grant
after 30 consecutive minutes without accepted activity. Once expired, activity
cannot revive it; another password unlock is required.

The UI sends throttled activity notifications for trusted keyboard, pointer,
touch and scroll events in a visible focused page. Authenticated owner chat/control
submissions also count. This is an activity signal, not proof of human presence.
Status polling, focus/refresh alone, streaming, workers and job lease heartbeats
never renew access. Database time is authoritative; UI timers are advisory.

sv lock revokes all of the owner's grants, including in-flight unlock attempts.
The UI broadcasts lock state without sharing credentials. Sign-out attempts
server revocation before ending the local session; network failure is reported.
Active requests/jobs poll non-renewing authorization and recheck at dispatch,
provider attempts, validation and result-publication boundaries. Already delivered
results cannot be retracted. Cancellation is cooperative, not instantaneous.

## Persistent investigation context

- Owned projects and conversations, monotonic revisions, append-only evidence,
  explicit same-field corrections, export and deletion.
- Separate target, scanner and session records. Unknown values remain unknown;
  the last IP mentioned in terminal output is not assumed to be the target.
- Source labels: user report, connected tool observation, inference.
  Client requests cannot label their own evidence as authenticated tool output.
- Optional hypothesis status, reported confidence and evidence basis. These are
  not calibrated probabilities or permission grants.
- Automatic Cyber user-turn capture retains redacted reports. Save important
  identity/OS/constraints in the evidence editor for durable priority. This pass
  does not autonomously extract and verify every fact from arbitrary transcripts.
- Stable message IDs survive saved-message encoding. Older formats still decode.
- A bounded provider view prioritizes identity/constraints and explicitly reports
  omitted events. No fabricated summaries or promise of unlimited recall.
- Export includes corrections and is revision-checked, capped at 10,000 events/
  8 MB. Delete removes context and mode selections, not immutable report files or
  the original conversation transcript. One investigation per conversation.

Text redaction is best effort, not a DLP guarantee. Images/binary uploads may
contain credentials that cannot be reliably removed by regex. Sanitize them
before submitting. Historical password records have **not** been erased from
databases, backups or logs. Known legacy password exchanges are filtered from
future display/prompt/storage reuse; credential rotation and historical cleanup
require a separate approved operation.

## Shared execution, reports and jobs

Cyber chat uses the shared bounded provider plan, named generation options,
cancellation signals and capability events. Provider policy refusals are terminal
for failover. Availability fallback is not refusal-shopping.

Terminal URLs (for example an Nmap banner) do not start research. Put an explicit
research instruction on the first line or send it separately. Later pasted lines
and fenced output do not become search instructions.

Word, Excel, PowerPoint, PDF and other supported report requests use the existing
native generators and private immutable artifact/version storage. Evidence IDs
and source labels accompany the selected context; global profile memories are not
injected as investigation facts. No duplicate report system or public bucket.

Cyber background jobs are generation-only. The server binds the current grant
ID/revision, user, scope, context revision and capability before atomically
queuing the payload. The worker rechecks current configured-owner eligibility,
live grant, mode and revision without renewing activity. Context changes require
a fresh submission; idle/revoked jobs cannot automatically unlock themselves.
Result publication also checks binding in the database.

Protected file metadata now uses the same live binding at publication. Background
files additionally require the current uncancelled job lease. Upload and metadata
storage are separate services: a denied publication attempts cleanup of its new
unpublished object; an uncertain acknowledgement is reconciled without deleting
an already committed version. Unknown cleanup/commit outcomes require review,
not claims that a file definitely was or was not saved.

Legacy self-improvement/deployment administration is not authorized merely by
Cyber unlock. Analyze/improve/instruct/deploy controls remain blocked pending a
separate explicit approval executor. Desktop permissions and native confirmations
are unchanged.

## Separate executable training catalog

The initial executable exercise compares HTTP security headers on weak and
hardened routes in a synthetic fixture. The conversational assistant can discuss
broader authorized investigations; executable automation is deliberately narrower.

- Separate queue/worker, exact-payload review and 15-minute approval window.
  Approval expiry is not a fixed owner-session expiry.
- Immutable image digests and fixed entrypoints; no client URLs, IP addresses,
  commands, environment variables, images, mounts or workspace snapshots.
- Dedicated non-root Linux worker, rootless Docker, cgroup v2 and gVisor/runsc.
- Fixture starts with network=none; scanner shares only that fixture's loopback
  namespace. No bridge, published ports, host network or external egress.
  Unsupported namespace sharing fails closed; there is no bridge fallback.
- Read-only roots, no capabilities, no new privileges, bounded tmpfs, no host
  files/socket/credentials inside containers, no automatic image pulls.
- 60-second execution deadline, 64 KiB captured output. Total pair resource
  envelope: 512 MB, one CPU, 64 PIDs. Cleanup time is reported separately within
  observed duration and can outlast the execution deadline.
- Shared Data/Code/Cyber budgets: three active lab runs, 20 approved runs per
  rolling 24 hours; five total active jobs account-wide.
- One attempt. Lost supervisor/lease or unconfirmed cleanup is indeterminate,
  never automatically replayed. Worker halts after uncertain execution.
- Successful connected output is recorded as a **fixture** observation, never as
  a scan of the owner's laptop. No real-device executor is implemented.

## Source map

| Area | Files |
|---|---|
| Owner controls | lib/auth/owner-session.ts, owner-grant.ts; app/api/system/owner-access/route.ts; components/useOwnerAccess.ts |
| Context | lib/projects/*; lib/context/*; app/api/projects/** |
| Chat | lib/platform/request-context.ts; lib/ai/cyber-*.ts; providers/execution-plan.ts; app/api/chat/route.ts |
| Reports/jobs | lib/artifacts/chat-artifacts.ts; lib/jobs/cyber-context.ts, runner.ts, store.ts; app/api/jobs/route.ts |
| Training | lib/cyber/*; app/api/cyber/runs/**; workers/cyber/** |
| UI | components/CyberLabPanel.tsx, CyberRuns.tsx, BackgroundTasks.tsx, AIHelper.tsx |
| Schema source | supabase/cyber_context_runtime.sql; cyber_execution_runtime.sql; shared lab_runtime.sql budget queries |

## Later acceptance setup — do not run as part of this source pass

Review schemas in order: personalization_schema.sql → lab_runtime.sql →
cyber_context_runtime.sql → cyber_execution_runtime.sql. Confirm the existing
conversation schema and roles first. New context/grant tables use RLS plus
service-only privileges; user access goes through ownership-checked APIs.

Keep both Cyber flags disabled until the corresponding acceptance work is
approved. Configure owner/password privately, verify same-origin controls through
the deployment proxy and desktop wrapper, then verify grant/context SQL.
Only after containment review should reviewed Node base/image digests be selected,
images built/installed on the dedicated host and the Cyber worker started.

Read docs/cyber-lab-acceptance.md and workers/cyber/README.md. No deployment,
container execution, live migration or test results are implied by this document.
