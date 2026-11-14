# Cyber integration source ledger

Plan: docs/superpowers/plans/2026-11-06-cyber-lab-integration.md
Updated: November 12, 2026.

Implementation started. No tests, typechecks, lint, builds, live database changes,
provider calls, workers, commits, pushes, or deployments are authorized in this pass.
Existing uncommitted enhancements are preserved.

Ruling: use the existing codex/massive-update-2026-11-02 checkout, as the user
requested integration into the main project; do not copy a clean worktree that
would omit its uncommitted provider/jobs/artifact/desktop changes.

Ruling: author fixtures but defer execution under the user's explicit instruction.
Written source is not a passing test report.

Ruling: implement owner control and durable conversation context first. Browser
session IDs and remembered facts cannot grant access. No credential cleanup,
password rotation, or network-enabled worker activation will be performed.

## Source progress

- Owner access and idle locking: source written. Dedicated password form/cookie,
  shared database grants, owner-wide lock, 30-minute idle deadline, UI activity
  notifications and cross-tab invalidation. No fixed active-duration expiry.
- Durable evidence/context: source written. Owned projects/conversations, bounded
  append-only events, stable message IDs, explicit corrections, reported hypothesis
  confidence/basis, provenance, redaction, export/delete and revision checks.
- Shared chat execution and UI: source written. Named chat options, live guards
  before/after provider attempts and capability boundaries, evidence-first Cyber
  adapter, terminal policy refusals, explicit research intent and mode controls.
- Jobs/report integration: source written. Native generators/private versions
  reused, server-only job bindings, non-renewing worker checks and database
  authorization at enqueue/publication. Normal generation worker stays shell-free.
- Separate Cyber training executor: source written. Catalog-only synthetic HTTP
  fixture, exact-payload approval, shared lab budgets, one-attempt separate queue,
  rootless/gVisor loopback-only pair, bounded output/deadline and cleanup/recovery.
  Images, containment, compatibility and availability are NOT verified.
- Readiness/configuration/docs: source written. Flags default OFF; runtime
  configuration is explicitly distinct from verified execution.
- Fixture cases: authored only. npm run test:cyber was NOT executed.
- Acceptance: NOT RUN; see docs/cyber-lab-acceptance.md.

## Explicit limits and implementation rulings

- No real-device execution adapter. The initial executable catalog is one fixed
  HTTP-header exercise, not an unrestricted shell or arbitrary target scanner.
- Existing Data/Code Lab networking remains offline. Only their shared quota
  queries were expanded to count Cyber runs.
- Evidence automatically captures user reports; structured identity/constraints
  require explicit saving/correction. No invented semantic fact extraction.
- New database schemas and reviewed immutable image digests are prerequisites.
  Nothing has been applied, installed or enabled by this source pass.
- Known legacy password exchanges are excluded from reuse; stored historical
  rows/backups were not deleted and credentials were not rotated.
- Legacy self-modifying/deployment SV commands stay blocked without a separate
  approval executor; Cyber unlock does not confer that authority.
- Superpowers verification guidance is applied as an evidence rule. The user's
  no-test instruction takes precedence over executing verification commands.
  No claim of passing tests, build success, containment or production readiness.
- Other tasks in the massive-update backlog are not marked complete by this work.
- Final source review also tightened per-provider revocation checks, made Cyber
  generation payload hashes stable across JSONB key ordering, changed the old
  forged-job-field fixture to expect explicit rejection, scoped fixture listings
  to the selected investigation, and preserved stable message IDs through storage.
  These are source edits, not executed test results.

## November 12 source review follow-through

- Traced an owner-status ordering race directly in useOwnerAccess: status reads
  started before an unlock could overwrite its response. Added a pure request
  generation/order gate, bounded fetches, identity-change invalidation and
  suppression of polling during mutations. Manual-lock failures keep local
  controls locked until the server confirms lock or the owner explicitly unlocks.
- Wrote owner-status-order.test.ts scenarios before wiring the guard; NOT RUN.
  The debugging skill guided the source-level data-flow trace, while runtime
  reproduction remains deferred under the user's no-testing instruction.
- Foreground Cyber responses now bind the captured evidence revision as well as
  jobs, so mid-generation corrections/deletion cannot silently publish stale work.
- Native artifact storage has an optional authorization/publication hook. Cyber
  reports use a service-only transactional metadata publication function that
  checks current grant, mode, scope/revision and (for jobs) active lease/cancellation.
  Newly uploaded but unpublished blobs are cleaned up where possible. An uncertain
  metadata acknowledgement is reconciled before deleting any object; a committed
  version is never deleted merely because its response was lost.
- Ambiguous dispatched metadata writes retain their upload for reconciliation:
  an empty lookup alone cannot prove an in-flight transaction will not commit
  later. Cleanup is limited to pre-dispatch failures or definite SQL rejections.
  Added pure publication-outcome fixtures; NOT RUN.
- Added explicit trusted-context identity invariants. Ordinary file generation
  still uses the existing storage path without requiring a Cyber grant.
- No tests, typechecks, lint, builds, DB operations, provider calls, worker/image
  launches, commits, pushes or deployment have been performed.
