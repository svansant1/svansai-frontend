# Authorized Cyber Lab integration design

Date: November 6, 2026.
Status: records the authorized-lab direction approved in chat. Detailed implementation plan awaits review. No product code or deployed configuration has changed in this pass.

## Intent and approved scope

Build advanced, practical cybersecurity teaching and investigation into the original SVANS-AI application's newer shared runtime. Support owned devices, explicitly authorized assessments, CTFs, contained exploit reproduction, reverse engineering, and contained malware analysis. Answer from actual evidence, explain the exact environment for a proposed command, and preserve the investigation across conversations.

This is not an unrestricted mode or a provider-policy bypass. Authorization applies to identified targets and actions, not to arbitrary systems because a user says "educational." The owner toggle does not confer desktop, network, deployment, or filesystem authority.

## Approaches considered

1. Copy the remote Cyber Lab files over the local branch: rejected because it would replace newer cancellation, capability, artifact, and job integrations.
2. Maintain a second Cyber-only chat/provider/memory pipeline: rejected because its access decisions, retries, and history would diverge again.
3. Selectively port the behavior into shared request authorization, execution, and durable context: recommended in the review and approved by the user. Cyber-specific files remain domain adapters, not alternate execution engines.

## Current source facts

- Local branch: `codex/massive-update-2026-11-02`; existing uncommitted enhancements belong to the user and must be preserved.
- Reviewed upstream revision: `f169c924924be41144d780111408b15e27d33e1d` in `svansant1/svansai-frontend`. This is a source reference, not a verified production deployment.
- Local chat's tenth positional argument is an AbortSignal; upstream uses that position for CyberAccessContext. Replace the boundary with named options.
- Owner unlock currently uses process-local sets and password text travels through normal conversation messages. Fix both before connecting durable context.
- Ordinary generation jobs currently produce replies/files only. Data/Code Labs have an isolated, network-disabled worker implementation awaiting verification.
- Persistent project evidence, general agent execution, and a network-enabled Cyber worker are not finished features.

## Required behavior

### Access and revocation

The server verifies Supabase identity, configured owner identity, a current password-based unlock grant, the feature flag, and an explicit per-conversation Cyber Lab selection. No client-provided owner flag is authoritative. Cyber Lab is OFF after refresh/resume until manually enabled again.

`sv unlock` opens a dedicated password form. Password submission never becomes a chat message, provider input, job payload, artifact, memory, log, or handoff. `sv lock` is a control operation independent of generation, clears any pending password form, revokes grants in shared storage, and turns Cyber Lab off. New or queued privileged operations fail closed after revocation. In-flight operations are cancelled cooperatively and checked again before result publication; cancellation cannot undo already-completed external actions.

User-selected timeout behavior (November 6): there is no fixed maximum duration for an actively used owner unlock. Automatically lock an unlock session after 30 consecutive minutes of inactivity, measured from its last accepted owner activity using server time. Successful sign-in, owner eligibility, feature configuration, and manual revocation still apply; active use cannot override those gates.

An authenticated user-initiated chat submission, scope correction, approval, or control action counts as activity. To support active typing/interaction between submissions, the visible, focused app can send a throttled activity notification following trusted keyboard, click/touch, or scroll events. This is a UI activity signal, not proof of human presence or new authorization: the server must validate the existing owner identity and grant, ignore client timestamps, and atomically extend the idle deadline only if the grant is still current and has not already idled out. Throttle these UI notifications to at most one per 30 seconds; never send a timer-only keepalive.

Status polling, refresh/focus alone, background tasks, provider streaming, worker heartbeats, and an unattended open tab do not count as activity. Status and permission reads never renew a grant. Browser sleep/offline time counts toward inactivity; resuming or sending activity after the deadline requires a fresh password unlock and manual mode activation. Use a session cookie, not a fixed 30-minute cookie lifetime that would interrupt active use. Activity changes the last-activity/deadline fields, not the grant's revocation revision. Automatic idle locking affects the idle grant; explicit `sv lock` remains owner-wide. The UI schedules its lock display from the server deadline and rechecks on resume, while server and worker checks enforce the deadline even if browser timers stop.

Other proposed implementation defaults, not previously selected by the user: 32 random bytes in a secure HttpOnly same-origin cookie with only a hash stored server-side; five password attempts per verified owner per 15 minutes; owner-wide manual lock revocation. Validate these during plan review. Same-origin browser/Electron rendering uses the existing Supabase bearer identity in addition to the cookie. API-key callers cannot inherit owner access.

### Persistent context

Store project/conversation ownership and stable device identities separately from IP observations. Keep scanner and target entities distinct. Facts contain source message/artifact IDs, provenance, timestamps, confidence, and correction/supersession links. Distinguish user reports, tool observations, inferences, and proposals. Mentioning or suggesting a command never proves execution.

Explicit user corrections supersede prior user assertions. Conflicting tool observations remain visible instead of silently replacing confirmed facts. Target or scope changes require renewed scope confirmation before executable work. Evidence text is untrusted data and cannot grant permissions or supply system instructions. Credentials are excluded or redacted before persistence and provider submission.

Persist findings, decisions, constraints, experiments, results, and next actions. Do not persist an authoritative unlocked/active boolean in knowledge, summaries, or continuation keywords. Session context is project-scoped, exportable, deletable, and subject to optimistic concurrency checks. Unresolved facts remain unknown; numeric confidence is an evidence label, not a measured probability.

### Responses, research, and providers

Interpret supplied results first. Give one useful next action, identify the machine/environment, describe expected evidence, and branch on possible outcomes. Reuse the confirmed target, respect constraints such as no RDP, and do not invent tool execution.

Replace blanket keyword handling with task/context-aware decisions without removing policy enforcement. Reuse shared provider execution, cancellation, budgets, and typed failures. Policy refusals are not quality errors that permit provider-shopping. Safe clarification or a bounded alternative may address a misclassified request, but must not produce otherwise-disallowed content.

Research intent comes from the user's instruction outside evidence blocks. URLs inside Nmap banners or pasted terminal output do not request external research. Do not send private scan logs to search engines.

### Tools, jobs, and artifacts

Cyber reports use existing native document generation and private artifact/version storage. A background job records an authorized context revision and server-issued grant reference, never a secret or authoritative client boolean. Workers revalidate scope and grants before dispatch, retries, subsequent actions, and publication without extending the inactivity timer. An idle-locked or revoked grant blocks further privileged steps and invokes the existing cancellation/reapproval flow. A running job does not keep an unattended session unlocked. Fresh unlock and explicit approval are required to resume; do not silently replay uncertain actions.

Do not enable general host shell access or change Data/Code Lab network isolation. Executable Cyber training uses a separate worker/profile with approved immutable images, fixed training-target identities, private internal networking, default-deny external egress, resource bounds, output limits, cleanup, and non-replayable uncertain outcomes. Initial executable targets are isolated catalog fixtures, not arbitrary IPs from conversation text. Owned-device coaching remains available without claiming remote control; a future real-device adapter needs its own scope and transport design.

### UI and honesty

Show LOCKED / OFF / ON from structured server state, never from matching words in assistant responses. Refresh on focus and auth changes; propagate lock across tabs. Display target/scanner identity, evidence provenance, outstanding approvals, and actual execution events separately from suggested module badges.

## Constraints

- No tests, typechecks, lint, builds, app launches, provider calls, database queries/migrations, images, or workers are run until the user-approved acceptance stage.
- Author test fixtures and schema source but label them NOT RUN / NOT APPLIED.
- No deployment, feature activation, secret changes, dependency installation, commit, or push without separate authorization.
- Preserve existing artifact downloads, immutable versions, cancellation, jobs, desktop grants, and Data/Code Lab isolation.
- Do not delete stored conversations or rotate credentials automatically. Propose authorized cleanup separately.
- Retain the existing platform and installed libraries; do not promise parity with another product.

## Documentation references

Server identity remains based on Supabase's authenticated user lookup, not unverified client claims: [getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser).
Database access must combine explicit grants and row ownership controls; privileged server clients still need application-level ownership checks: [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Completion definition

Source implementation is complete only when all tasks in the companion plan are written and reviewed. Runtime readiness is a separate status requiring the deferred acceptance suite, a reviewed migration, configured isolated workers, and explicit release approval. Until then, do not describe the feature as live, verified, or safe to activate.
