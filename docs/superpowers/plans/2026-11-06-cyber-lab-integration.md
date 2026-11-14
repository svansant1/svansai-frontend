# Authorized Cyber Lab Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development only if the user chooses delegation. Steps use checkbox syntax. No execution method has been selected yet.

**Goal:** Integrate advanced authorized Cyber Lab teaching, durable investigation evidence, secure owner controls, and separately approved isolated training execution without replacing the newer runtime.

**Architecture:** Use one server-created request context, one shared capability/provider path, and project-scoped durable evidence. Keep access grants separate from remembered facts. Preserve existing generation, artifact, job, and offline Data/Code Lab implementations.

**Tech Stack:** Existing Next.js/TypeScript, Supabase Auth/PostgreSQL, React, Electron boundary, and separate Linux/rootless/gVisor worker infrastructure; no new dependency is assumed.

**Spec:** `docs/superpowers/specs/2026-11-06-cyber-lab-integration-design.md`.

**Status:** Plan authored only. Product implementation has NOT started in this pass. All checks below are deferred, not passed.

## Global constraints

- Work in the existing dirty enhancement checkout; preserve unrelated and overlapping user work through narrow edits. Do not reset, overwrite whole shared files, or blindly cherry-pick remote commits.
- User requested all coding before tests. Author fixtures first where useful, but DO NOT execute tests/typechecks/lint/builds, app launches, providers, workers, or database checks now. This explicitly overrides the normal red/green sequence.
- Do not commit, push, deploy, install dependencies, enable feature flags, rotate passwords, or delete historical records during implementation.
- Passwords never enter chat, memory, artifacts, learning queues, or provider/research payloads.
- Retain provider refusal/cancellation semantics and default-deny external execution.
- Owner unlock has no fixed maximum active duration. User-selected behavior: lock after 30 consecutive minutes of inactivity using authoritative server time. Polling and background jobs never extend it; activity cannot revive an already idle-locked or revoked grant.
- Initial executable Cyber targets are isolated catalog fixtures. Arbitrary device/network execution is not implicitly authorized or implemented by a chat toggle.
- All paths below are relative to `C:/Users/Shawn Vansant/OneDrive - DeVry University/Desktop/Vansant Platform/svansai_parent/frontend`.

## Review focus

1. Lock arriving during generation, queued work, or a password challenge must revoke centrally and prevent later privileged steps (Tasks 1, 3, 6).
2. Scanner and target IPs in the same pasted output, later corrections, and more than 250 historical messages must not corrupt target identity (Tasks 2, 4).
3. Forged owner flags, another user's conversation ID, stale revisions, and copied job payloads must not confer access (Tasks 1, 2, 3, 6).
4. Terminal banners containing URLs or instructions must remain evidence, not search requests or model authority (Task 4).
5. Cyber reports, lock failures, and cancelled runs must preserve existing downloads/version history and Data/Code Lab network restrictions (Tasks 5, 7, 8).

## Task 1: Secure owner control channel and shared revocation

**Files:** Create `lib/auth/owner-session.ts`, `app/api/system/owner-access/route.ts`, `supabase/cyber_context_runtime.sql`, `scripts/owner-session.test.ts`. Modify `lib/auth/server-owner.ts`, `lib/ai/instruction-handler.ts`, `lib/ai/cleanup.ts`, `lib/db/chat-history.ts`, `components/AIHelper.tsx`.

**Interfaces:** `OwnerGrant = { id: string; userId: string; lastActivityAt: string; idleLocksAt: string; revision: number }`. `resolveOwnerGrant(req: Request, userId: string): Promise<OwnerGrant | null>` and `assertOwnerGrantCurrent(grant: OwnerGrant): Promise<void>` read current shared state without renewing it. `recordOwnerActivity(req: Request, userId: string): Promise<OwnerGrant | null>` atomically renews only an existing non-idle, non-revoked grant using server time, without changing its revocation revision. `revokeOwnerGrants(userId: string): Promise<void>`. Route GET returns structured status and server time/deadline; POST accepts bounded `{action: 'unlock', password: string}`, `{action: 'activity'}`, or `{action: 'lock'}` with verified owner identity. Password max 1024 UTF-8 bytes; JSON max 4096 bytes.

- [ ] Author fixtures for verified-owner+password+manual-mode conjunction, inactivity, cross-user cookie reuse, database outage, shared-process revocation, five attempts/15 minutes, and lock during challenge. Assert active use every 20 minutes remains unlocked over multiple hours; idle 29:59 is valid and idle 30:00 is locked; polling/streaming/worker heartbeats do not renew; client clock manipulation cannot extend access; activity after the deadline cannot revive it. Assert `resolveOwnerGrant` returns null after revoke and no generation callback is invoked by control commands.
- [ ] Implement shared grant and attempt reservation storage with a sliding 30-minute inactivity deadline and no absolute active-session timeout, hashed 32-byte session-cookie tokens, atomic owner-wide manual revocation, no raw token storage, and constant-time password verification. Initialize last activity on successful unlock; expire a grant when server time is at or beyond its deadline. Read and renew atomically against current shared state; delayed activity must not undo lock or idle expiry. Cookie lifetime must not introduce a separate fixed 30-minute cutoff. Prefer a scrypt hash configuration; document a temporary legacy environment-password compatibility path without logging it. If OWNER_USER_ID is configured it is canonical; email-only fallback requires verified email.
- [ ] Create additive schema source with RLS and explicit role grants/revocations. Server-side operations are service-only; no public executable privileged functions. Do not apply it. Grant/attempt mutation must be atomic under concurrent requests; missing storage fails closed.
- [ ] Move password entry to the dedicated control route, not chat. Require Supabase bearer identity and same-origin checks for cookie-changing requests; set secure HttpOnly SameSite cookies. Clear on logout and lock. Reject password-shaped legacy exchanges at chat entry before research/learning/provider work; filter legacy `isPassword` messages on client and persistence paths without deleting existing records.
- [ ] Make lock available independently of a running chat request. Remove process-local sets as authority. Preserve explicit owner-command handling without treating a Cyber grant as approval for deployment or other external actions.
- [ ] Record activity only on authenticated, owner-initiated app actions or the authenticated activity endpoint, never in permission/status reads. Check the current grant before recording activity. Ignore client times, and treat UI activity as a signal rather than an authorization factor. Workers always use non-renewing checks. Keep automatic idle invalidation scoped to that grant; manual lock revokes all owner grants.
- [ ] Deferred verification: unit fixtures plus route/DB multi-instance revocation, CSRF, cookie, attempt-race, log-redaction, and password-never-persisted assertions. Do not run yet.

## Task 2: Shared project/conversation evidence, not a Cyber-only memory cache

**Files:** Create `lib/projects/{types,store,permissions}.ts`, `lib/context/{types,store,provenance,compaction}.ts`, `app/api/projects/route.ts`, `app/api/projects/[id]/context/route.ts`, `scripts/context-state.test.ts`, `scripts/context-isolation.test.ts`. Modify the Task 1 schema source, `lib/ai/conversation-state.ts`, and `lib/db/chat-history.ts` to retain durable source message IDs.

**Interfaces:** `ContextScope = { userId: string; projectId: string; conversationId: string }`. `EvidenceSource = { kind: 'user_report' | 'tool_observation' | 'inference'; messageId?: string; artifactId?: string; observedAt: string }`. `ContextFact` contains stable ID, entity ID, field, bounded value, source, confidence label, status, supersedes ID. `loadContext(scope): Promise<ContextSnapshot>`; `appendContextEvents(scope, expectedRevision, events): Promise<ContextSnapshot>`; `buildContextView(snapshot, maxCharacters): ContextView`.

- [ ] Author fixtures showing two IPs stay on separate entities, a target correction supersedes only that fact, an assistant example cannot become tool evidence, and stale revisions produce conflicts instead of lost updates. Assert unknown OS remains unknown.
- [ ] Implement owned projects and conversation links with server ownership checks, bounded evidence events, monotonic revisions, and idempotent event IDs. No client may supply another user's owner ID. Add export/delete APIs scoped to the owner; evidence deletion must not accidentally delete referenced generated-file versions.
- [ ] Store durable facts/decisions independently of transcript windows. Retain stable source IDs across message persistence and retrieval. Read paginated history; construct a bounded provider view with explicit omitted-evidence metadata. Do not silently claim full recall or fabricate summaries.
- [ ] Redact secrets before storage and provider rendering; keep raw private artifact references where authorized. Separate observations from decisions, attempts from suggestions, and unknowns from confirmed facts. No passwords, grant tokens, or active-mode flags in context.
- [ ] Deferred verification: tenant/project RLS and API isolation, 250+ messages, concurrent updates, export/delete, evidence reference access, and correction fixtures. Do not run yet.

## Task 3: Shared request context and named chat options

**Files:** Create `lib/platform/request-context.ts`, the access contract in `lib/ai/cyber-mode.ts`, and `scripts/cyber-execution-context.test.ts`. Modify `app/api/chat/route.ts`, `app/api/v1/chat/route.ts`, `lib/platform/orchestrator.ts`, `lib/platform/capabilities/{contracts,runner,chat-capabilities}.ts`, `lib/ai/{chat-engine,types}.ts`.

**Interfaces:** `TrustedRequestContext = { requestId: string; userId: string | null; scope: ContextScope | null; ownerGrant: OwnerGrant | null; cyber: CyberAccessContext; context: ContextView | null; signal?: AbortSignal }`. Construct only on the server; never serialize secrets into provider prompts. Change `generateChatResponse` to `(rawMessages, options: ChatGenerationOptions): Promise<string>` with named attachedFiles, responseMode, telemetry, profile, memories, signal, and trusted context. `ExecutionContext.assertAuthorized?: () => Promise<void>` is invoked before dispatch and before publication.

- [ ] Author fixtures proving signal propagation, no positional signal/cyber collision, forged JSON owner fields ignored, API-key-only Cyber requests rejected, and revoked grants block dispatch/publication.
- [ ] Update all discovered callers, including scripts, without removing the existing capability registry or real execution events. Ordinary chat gets an inactive Cyber context and retains current behavior.
- [ ] Require verified owner, current grant, enabled server flag, and explicit mode activation bound to this conversation. Keep mode activation out of general knowledge. Control commands bypass the model/research router entirely.
- [ ] Add cooperative revocation polling during active Cyber requests, with an AbortController linked to request cancellation. Recheck authoritatively at operation boundaries. Do not claim cancellation can retract a response already delivered.
- [ ] Deferred verification: route integration, cancellation/lock races, ordinary chat compatibility, and capability tests. Do not run yet.

## Task 4: Cyber response policy, continuity, and research intent

**Files:** Selectively port/rewrite `lib/ai/{cyber-mode,cyber-continuity,cyber-owner-access}.ts`; create `lib/ai/research-intent.ts`, `scripts/{cyber-mode,cyber-continuity,cyber-owner-access,cyber-research-intent}.test.ts`. Modify `lib/ai/{chat-engine,prompt,response-critic,request-context}.ts`, `lib/ai/providers/{execution-plan,outcomes}.ts`.

**Interfaces:** `CyberAccessContext` is derived from Task 3, never inferred from text. `buildCyberContinuityContext(view: ContextView, access: CyberAccessContext): string`; `buildOwnerDeviceAccessResponse(view: ContextView, request: string): string | null`; `classifyResearchIntent({instruction, evidence}): { requested: boolean; query: string | null }`.

- [ ] Author fixtures for a Windows target/Kali scanner, explicit no-RDP constraint, both IPs in one output, correction after a long chat, suggested-versus-executed commands, and ambiguous device identity requiring clarification rather than guessing.
- [ ] Preserve the useful upstream evidence-first guidance while replacing first/last-IP regex authority, generic Windows fallback, and independent rolling history extraction with the shared context view.
- [ ] Handle advanced authorized requests contextually; do not block a legitimate request solely because it mentions an attack technique. Retain policy checks based on the actual requested operation and scope. No broad `cyber.active` bypass for all output checks.
- [ ] Consolidate repeated Cyber instructions in one domain policy consumed by prompt builders. Quality checks evaluate environment/constraint consistency, not whether any refusal occurred. Keep provider-policy refusals terminal for provider failover; safe alternatives do not bypass that decision. Route conversation retries through the bounded shared execution architecture, preserving other chat behavior and token/deadline/cancellation limits.
- [ ] Separate user instruction from quoted/tool evidence before research routing. A banner URL or the word 'website' in output does not cause search; an explicit request for current documentation still can. Construct a redacted task-specific query, not the full private transcript.
- [ ] Deferred verification: helper fixtures and non-Cyber quiz/writing/research regressions, refusal terminality, model allowlists, and total retry budgets. Do not run yet.

## Task 5: UI, context corrections, and report/artifact integration

**Files:** Create `components/CyberLabPanel.tsx`, `scripts/cyber-artifacts.test.ts`; modify `components/AIHelper.tsx`, `app/page.tsx`, `lib/db/chat-history.ts`, `lib/platform/capabilities/chat-capabilities.ts`, `lib/artifacts/chat-artifacts.ts`, `lib/platform/telemetry.ts`.

**Interfaces:** Panel takes structured owner status, context scope/revision, target/scanner facts, pending approvals, and explicit control callbacks. Report generation receives the same authorized `ContextView` as conversation generation and returns the existing artifact/reference types.

- [ ] Author fixtures asserting no password in message callbacks; refresh leaves mode off and does not renew activity; stale status cannot enable a request; reports reuse authorized evidence IDs; unrelated project evidence is excluded; immutable versions are retained. Cover typing/click/touch/scroll activity, hidden tabs, focus without input, throttling, sleep/resume beyond 30 minutes, and a delayed notification after revocation.
- [ ] Wire locked/off/on states to server status, not assistant text. Fetch on auth change/focus and after control operations; broadcast lock to sibling tabs without broadcasting tokens. Reconcile server denial immediately. Re-enabling after refresh requires a click and a valid grant.
- [ ] Send at most one activity notification per 30 seconds in response to trusted keyboard, click/touch, or scroll interaction in a visible focused app. Do not use timer-only keepalives; background polling, refresh/focus alone, streaming, and jobs must not renew. Normal authenticated owner submissions also record activity. Display/schedule idle lock from the server-reported deadline, refresh across tabs sharing the cookie, and recheck on resume before allowing protected actions. After idle lock require password unlock again; active use otherwise has no fixed cutoff.
- [ ] Pass durable conversation IDs rather than treating a browser session ID as the conversation. Display user-reported and tool-observed findings distinctly and allow explicit corrections through revision-checked events.
- [ ] Feed report requests to existing generators/private storage; keep native Word/Excel/PowerPoint/PDF and legacy inline downloads. Do not add a second report generator, public bucket, or binary transcript storage path.
- [ ] Record actual authorization/execution outcomes with IDs, not raw credentials/terminal transcripts. Preserve suggested-module versus executed-capability UI separation.
- [ ] Deferred verification: browser/Electron layout, auth transitions, tabs, refresh, native file generation/opening, artifact download authorization, and version history. Do not run yet.

## Task 6: Durable jobs that cannot inherit stale authority

**Files:** Modify `lib/jobs/{types,store,runner}.ts`, `app/api/jobs/route.ts`, `components/BackgroundTasks.tsx`, `workers/jobs.ts`, and the additive schema source; create `scripts/cyber-job-authorization.test.ts`.

**Interfaces:** `JobContextReference = { projectId: string; conversationId: string; revision: number }`. Server-only job authorization metadata contains grant ID/revision/user ID and capability scope, not cookies/passwords/Supabase tokens. Request parsing rejects client-supplied privileged fields. `resolveJobContext(job): Promise<TrustedRequestContext>` verifies stored ownership, current configured owner eligibility, context revision, grant validity, and intended capability.

- [ ] Author fixtures for a forged grant ID, another user's context, idle lock while queued/running, manual lock during a provider call, context mutation after approval, and same-payload retries after uncertain external outcomes. Assert job heartbeats and output streaming never record owner activity, and a legitimate activity renewal does not invalidate grant-revision bindings on queued jobs.
- [ ] Attach grant metadata on the server at enqueue, never by spreading request JSON. Bind approval to context revision and payload hash. Workers use current non-renewing grant lookups, not a stale captured idle deadline. Fail closed or return to an explicit approval state when the grant idles out or is revoked; no automatic unlock, privilege upgrade, or unattended keepalive.
- [ ] Revalidate before dispatch/retries/publication and use cancellation/event journals. Keep normal non-Cyber generation jobs functional; do not turn the ordinary worker into a shell/network worker.
- [ ] Deferred verification: two-worker DB leases/revocation, cancel races, idempotency, ownership, and prior ordinary-job fixtures. Do not run yet.

## Task 7: Separate, approved isolated Cyber training executor

**Files:** Create `lib/cyber/{contracts,catalog,approvals,store}.ts`, `app/api/cyber/runs/route.ts`, `app/api/cyber/runs/[id]/route.ts`, `workers/cyber/queue.ts`, `workers/cyber/docker-client.ts`, `workers/cyber/README.md`, and `scripts/cyber-runtime.test.ts`; extend the additive schema source, `supabase/lab_runtime.sql` for shared budget accounting, and `components/CyberLabPanel.tsx`. Keep `lib/execution/contracts.ts` and Data/Code Lab network policy unchanged.

**Interfaces:** `CyberRunRequest = { targetId: string; exerciseId: string; contextRevision: number }`; target/exercise resolve only through a server catalog of approved, fixed exercises and immutable images. No arbitrary hostnames, IPs, shell strings, mounts, environment values, or image names in request JSON. `CyberRunReport` records run/payload IDs, observed output references, exit status, truncation, timing, and cleanup result. Run IDs bind to owner, grant, catalog version, context revision, and approval.

- [ ] Author fixtures for tampered approval hashes, unknown target IDs, injected command fields, expired grants, external egress, host mounts, output exhaustion, and supervisor loss resulting in an indeterminate non-replayed run.
- [ ] Implement exact-payload review/approval and a separate queue. Use the existing execution limit envelope as the ceiling: 60-second runs, 64 KiB output, 15-minute approvals, and the shared account-wide active/run budget accounting. Atomically count Cyber alongside other labs; do not create a second independent quota that bypasses global limits.
- [ ] Implement a dedicated rootless/gVisor supervisor with per-run internal-only scanner/fixture networking, immutable configured images, no external egress, no host workspace/socket in containers, resource limits, cancellation, and finally-path cleanup. Catalog exercises use fixed diagnostic/teaching entrypoints; prompts cannot become unrestricted commands. Missing runtime/images disable execution honestly.
- [ ] Store sanitized observations in the shared evidence journal; describe the actual fixture used. Do not claim the user's real laptop was scanned. Real-device execution remains unavailable until an explicitly designed local/remote adapter exists.
- [ ] Add worker/configuration documentation only; do not build/download images or start containers. If containment cannot be enforced on the configured host, return unavailable rather than relaxing isolation.
- [ ] Deferred verification: adversarial containment on the acceptance host, cleanup, cancellation, grants/quotas, fixture results, and unchanged offline Data/Code Labs. Do not run yet.

## Task 8: Readiness, docs, and deferred acceptance inventory

**Files:** Modify `lib/platform/readiness.ts`, `.env.example`, `package.json`, `docs/massive-update-status.md`; create `ADMIN_CYBER_MODE.md` and `docs/cyber-lab-acceptance.md`. Edit `render.yaml` only if necessary to document disabled-by-default settings; never set enabled flags as part of this implementation.

- [ ] Register unit fixture commands using the existing TypeScript test runner. Document every test as NOT RUN until executed. Add an acceptance matrix covering all five review-focus classes and existing provider/jobs/artifacts/desktop/lab regressions.
- [ ] Document all access gates, 30-minute inactivity locking without a fixed active-session cutoff, manual revocation, context versus permission, configuration versus activation, owner-password retention risk, private evidence retention/export/delete, and execution limits. Explain what counts as activity, why background work cannot keep a session unlocked, and that no real-device command ran unless a supported tool produced evidence.
- [ ] Make readiness distinguish source installed, storage configured, grant verified, execution unavailable, and runtime verified. Flag absent tables/images/workers without enabling them or exposing secrets.
- [ ] Update the implementation ledger accurately after each written task. Do not mark a task runtime-complete based on source review or UI buttons.
- [ ] After all code is written, present the acceptance plan. Run tests/builds/database/runtime checks only when the prior coding-before-tests condition and the user's acceptance authorization are satisfied. Deployment remains a separate approval.

## Self-review and handoff

- Coverage: approved response behavior, access, persistence, shared providers, jobs, native files, desktop boundaries, and isolated training execution map to Tasks 1–8.
- Interfaces: Task 1 defines grants; Task 2 scope/context; Task 3 trusted request context; Tasks 4–7 consume them rather than inventing separate identity/state stores.
- Deliberate limits: no unrestricted mode, no provider-policy bypass, no arbitrary real-device execution, no live migration, no tests run now, and no automatic cleanup of historical secrets.
- User-selected timeout: 30 consecutive idle minutes; active owner interaction renews the timer with no fixed maximum active duration. Other proposed defaults needing plan approval: five attempts per 15 minutes, owner-wide manual lock, and catalog-only initial executable targets.
- Execution recommendation: native implementation in the current chat, task-by-task, to avoid concurrent edits to the heavily shared chat/UI/schema files. Delegate only if the user explicitly chooses that method.
- Plan approval was subsequently received. The November 10 source implementation
  is recorded in docs/cyber-integration-progress.md and ADMIN_CYBER_MODE.md.
  Checkboxes combining implementation and acceptance remain unchecked because
  tests, builds, migrations, UI/runtime checks and deployment have not run.
