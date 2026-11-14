# Deferred Cyber integration acceptance

November 12, 2026. **Every item below is NOT RUN.** Source inspection is not
proof of compilation, successful migration, containment or regression safety.
The user requested coding first and no tests/builds/deployment during this pass.

## Acceptance order

1. Review source/diffs and confirm unrelated uncommitted enhancements remain.
2. Run TypeScript checking and the authored local fixture suites.
3. Apply reviewed schema source only in an approved disposable acceptance database.
4. Exercise auth/context/job APIs and browser/Electron behavior using test accounts.
5. Build/install reviewed fixture images only on the approved isolated Linux host.
6. Perform adversarial containment, cancellation, cleanup and quota checks.
7. Exercise native generated files, private storage/version history and existing
   desktop/Data/Code Lab regressions.
8. Production build and explicit owner review. Deployment is a separate decision.

## Auth and UI

- Non-owner, unconfirmed email, ID/email mismatch, forged cyberMode and API-key-only
  requests cannot activate Cyber Lab.
- Dedicated password body never appears in chat callbacks, prompts, saved messages,
  analytics, console logs, localStorage or tab broadcasts.
- Five-attempt limiter works across server processes. Password hashes/config errors
  fail closed. Manual lock invalidates a concurrent password attempt.
- Exactly 30 idle minutes locks server-side. Repeated legitimate interaction keeps
  an active grant usable beyond 30 minutes without changing grant revision.
- Polling, focus/refresh, hidden tabs, streaming, queue heartbeats and worker reads
  do not renew. Sleep/resume after expiry requires password again.
- Cross-tab lock, delayed status response, mode off, logout and network failure.
  Include a pre-unlock status read arriving last, a late unlock after manual lock,
  a second explicit unlock while the older lock settles, failed-lock polling,
  and status responses returning after an account switch.
  Verify same-origin cookies behind the actual HTTPS proxy and Electron wrapper.
- Ordinary quiz, writing, upload, quote and non-Cyber chat behavior remains intact.

## Context and reports

- Two users/projects cannot read, append, export, delete or reference each other's
  events. Verify RLS/privilege denial through direct anonymous/authenticated clients.
- Multi-process optimistic concurrency returns conflict rather than overwriting.
  Event replay is idempotent despite a regenerated server timestamp.
- Target/scanner IPs stay separate. Unknown OS remains unknown. Corrections and
  explicit no-RDP constraints survive 250+ turns and bounded-context omissions.
- Provenance cannot be upgraded by client JSON. Hypothesis scores have a basis
  and are displayed as reported estimates, not verified measurements.
- Consistent paginated export, 8 MB/10,000-event limits, deletion during export,
  stale job revision after context deletion. Original report versions survive.
- Word/Excel/PowerPoint/PDF generation uses selected context, preserves native
  structure and formulas, has correct private downloads and immutable revisions.
- Legacy stored downloads/text decode. Stable IDs round trip. Historical password
  filtering does not claim deletion of original rows/backups.

## Providers and background work

- Revocation before dispatch, between retries, during generation/validation and
  during storage withholds protected output.
  Verify transactional artifact metadata checks, cancellation/lease loss at
  publication, uploaded-object cleanup, and recovery from a lost commit response
  without deleting a valid immutable version. Object storage and Postgres are
  separate services; confirm unknown outcomes are reported honestly.
  Include a transaction that commits only AFTER the recovery lookup: an empty
  lookup must not trigger deletion following an ambiguous dispatched write.
- Provider refusal is terminal; availability fallback respects allowlists, models,
  total time/token budgets and cancellation.
- Banner/quoted URLs do not trigger research. Explicit opening research requests
  send a narrow redacted query, not the private transcript.
- Forged grant metadata is rejected at enqueue. Owner eligibility, current grant,
  mode, capability, payload and context revision are checked in the worker.
- Two-worker leases, cancellation races, context changes while queued/running,
  server restart, database outage, atomic protected-result publication.
- Ordinary generation jobs remain usable and never acquire Cyber or shell powers.

## Isolated fixture execution

- Missing flags/digests/images/worker/runtime is unavailable, not a simulated pass.
- Exact-hash approval, 15-minute approval expiry, changed image/catalog, another
  grant/account, malformed request and unapproved execution are rejected.
- Shared quotas are atomic under concurrent Data/Code/Cyber proposals/approvals.
- No external egress, DNS, host/metadata endpoints, host mounts, daemon sockets,
  privileged runtime or network fallback. Unsupported runsc sharing fails closed.
- Confirm CPU/memory/PID limits across BOTH containers, 60-second deadline,
  stdout/stderr bound and no inherited cloud credentials.
- Cancel, kill supervisor, lose lease, exceed output, missing fixture, image
  mismatch, Docker outage and cleanup failure. No automatic replay.
- Results clearly identify the synthetic fixture, never a real owner device.
  Worker-observed evidence is saved atomically only under current authorization.
- Data/Code Lab network=none and desktop scoped approvals are unchanged.

## Authored fixture entry points (not executed)

- npm run test:cyber
- npm run test:expansion
- npm run test:labs
- npm run test:desktop-security
- Existing chat/attachment/artifact suites after their external-call requirements
  are reviewed.

Database concurrency, UI races, actual native file opening and adversarial host
containment are acceptance scenarios, not already passing automated coverage.
