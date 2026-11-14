# SVANS-AI Master Expansion Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. The user's explicit instruction overrides test-first execution: write code and test cases, but run NO tests, builds, lint, typechecks, smoke checks, or paid-provider checks until the entire implementation pass is complete. No commits, pushes, deployments, or live database changes.

**Goal:** Implement the original SVANS-AI master roadmap incrementally without replacing the functioning chat/artifact baseline or advertising unconnected tools as working.

**Architecture:** Retain Next.js/React, Electron, current Office generators and Supabase. Introduce versioned capability contracts and execution events, an enforceable permission boundary, shared provider execution, durable jobs, and private versioned artifacts. Long-running, browser, code, data, cyber and media work uses separate configured workers; missing workers are unavailable, never simulated.

**Tech Stack:** Existing TypeScript, Next.js, React, Electron/CommonJS, Supabase/PostgreSQL, ExcelJS, docx, PptxGenJS; additional libraries only where a concrete implementation requires them.

**Spec:** `../SVANS_AI_Massive_Update_Outline.docx` relative to repository root; current document title is “SVANS-AI Master Architecture & Development Roadmap”, October 2026, sections 1–38, 15 phases. User approved implementation on November 2, 2026 and repeated “continue”.

## Global Constraints

- Work on the ORIGINAL frontend, not the separate unified V3 project.
- Preserve the existing layout, mascot/quotes, history and native artifact downloads.
- Do not modify the source Word roadmap.
- User request: “dont test anything, untill all the codes are updated. Then we test.” Tests may be authored now, but execution is deferred until all work below is implemented or explicitly re-scoped by the user.
- Local code changes only; deployment, production schema installation, OAuth grants, paid resources and provider calls require separate setup/authority.
- No silent context loss, fictitious tool runs, fake native extensions, invented validation, or claims of model retraining.
- All execution is scoped to user/project/organization and specific grants; untrusted content cannot grant authority.
- Consequential actions need payload-bound approval; timeouts of external actions may be indeterminate and must not blindly retry.
- Local-only requests must not send content to cloud providers.
- Partial implementation is recorded as partial. A manifest or adapter interface alone does not complete a capability.

## Review Focus

1. Repeated quiz/writing requests must not inherit unrelated workspace templates or unnecessary sources.
2. Revoked permissions, symlink/junction escapes and remote renderer IPC must not access host files/commands.
3. Timeout/cancel/retry must stop work where possible and must not duplicate an irreversible action.
4. Tenant/project access must cover jobs, files, memory, retrieval, events, approvals and connectors.
5. Generated formulas/native document content must preserve requested behavior without silently dropping source data.

## Execution sequence and file map

### 1. Provider foundation (roadmap phase 1)
- Modify `lib/ai/providers/{executor,openai,anthropic,gemini,router}.ts` and `lib/ai/chat-engine.ts`.
- Create `lib/ai/providers/outcomes.ts` and shared policy-aware execution in `executor.ts`.
- Interface: `executeProviderPlan(request, policy, dependencies?) -> ProviderExecutionResult`; classified outcomes, AbortSignal, deadline, bounded attempts, configured providers, response validator and attempt events. Retain `callProvider` compatibility.
- Modify `lib/artifacts/chat-artifacts.ts` to use the same executor, model selection per vendor and validation before accepting a draft.
- Author `scripts/provider-execution.test.ts` for refusal no-failover, timeouts, malformed output, model isolation, privacy and cooldown behavior. DO NOT RUN.
- [ ] Implementation complete

### 2. Real capability execution and visibility (phase 1; sections 5, 21, 27, 33)
- Create `lib/platform/capabilities/{contracts,registry,runner}.ts`; implement exact input/output guards, versioned callable handlers, readiness, permissions, validation and ordered execution facts.
- Adapt `lib/platform/orchestrator.ts`, `lib/platform/telemetry.ts`, `app/api/{chat,v1/chat}/route.ts`, `components/AIHelper.tsx`.
- Interface: `runCapability(definition, input, executionContext)` returns output plus `ExecutionEvent[]`; suggested modules remain distinct from executed capabilities.
- [ ] Implementation complete

### 3. Desktop security boundary (precedes execution phases)
- Modify `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/capabilities.cjs`, `types/svans-desktop.d.ts` and `components/DesktopCommandCenter.tsx`.
- Create `desktop/security.cjs` with canonical path checks, denied secret/system paths, IPC sender validation, safe external URLs and closed command policies. Read-only grants cannot execute arbitrary interpreters. General code execution requires isolated runtime, not only cwd confinement.
- Host write confirmation binds exact path/content; access revocation invalidates outstanding approvals. No unbounded inherited environment.
- Author `scripts/desktop-security.test.cjs`; do not run it.
- [ ] Implementation complete

### 4. Durable jobs, approvals and budgets (phase 3; sections 22, 24, 26)
- Create `lib/jobs/{types,store,runner,approvals,budgets}.ts`, `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts`, `app/api/jobs/[id]/events/route.ts`, `app/api/jobs/[id]/approval/route.ts`, `workers/jobs.ts`, `components/TaskProgress.tsx`.
- Add reviewed SQL migration using the Supabase CLI naming workflow only when implementing; do not apply remotely.
- States: queued/running/waiting_approval/validating/succeeded/failed/cancelled/indeterminate. Persist leases, step keys, checkpoints, tenant scope, audit and retry ceilings. Unknown external-action outcomes require reconciliation.
- [ ] Implementation complete

### 5. Artifact storage and versioning (phase 2; sections 11, 25)
- Create `lib/artifacts/{storage,versions,validation}.ts` and authenticated `app/api/artifacts/[id]/route.ts`.
- Adapt `message-storage.ts`, `GeneratedFileDownload.tsx`, chat persistence and output envelopes to private storage references; preserve legacy base64 history reads.
- Immutable versions, hashes, bounded downloads, compare and restore-as-new-version; no public bucket or prompt inclusion of file bytes.
- [ ] Implementation complete

### 6. Native artifact expansion (phase 2)
- Extend `workbook-spec.ts`, `xlsx-generator.ts`, `document-spec.ts`, `docx-generator.ts`, `pptx-generator.ts`, `generation-instructions.ts`, request parser and source extraction.
- Add typed dates/times, safe named ranges, structured tables, dashboard/chart support through a verified renderer, explicit supported revision operations and source-preserving edits. Never present static output as interactive.
- Create `pdf-generator.ts` for native PDF generation; conversions use an isolated compatible Office runtime, not renamed extensions or lossless claims.
- [ ] Implementation complete

### 7. Execution environments and selective coding (phase 3)
- Create `lib/execution/{contracts,client,scope}.ts`, `workers/labs/` implementations and documented pinned container configurations for Data and Code Labs.
- No host secrets, Docker socket, privileged mode or unapproved host mounts. Network and workspace scopes are enforced outside generated code. Bounded output/process trees and reset/cleanup.
- Create `lib/agents/coding/{indexer,hypotheses,patches}.ts`: selective entry points, evidence-driven expansion/contraction, diff-based edits, approval package; no automatic commit/deploy.
- [ ] Implementation complete

### 8. Projects, context and retrieval (phase 4)
- Create `lib/projects/{types,store,permissions}.ts`, `lib/context/{chunks,index,retrieval,compaction,provenance}.ts`, scoped project API and UI.
- Paginated code/document indexing, embeddings when configured, clearly labeled lexical fallback, source references, durable decisions outside rolling summaries, export/delete. Knowledge graph is explicitly a prototype.
- [ ] Implementation complete

### 9. Deep research (phase 5)
- Adapt `lib/ai/live-search.ts` and citation guard; add `lib/research/{planner,sources,report}.ts`.
- Enforce provenance, freshness labels, quote bounds, source-backed citations, uncertainty and untrusted-content isolation. Writing/quiz requests do not automatically research.
- [ ] Implementation complete

### 10. Supervisor and workers (phase 6)
- Create `lib/agents/{contracts,supervisor,graph,messages}.ts`; register actual capability-backed workers.
- Bounded DAG with cycle/depth/cost checks, non-chat internal messages, per-worker grants, persisted independent outputs and conflict resolution. Agent titles are not standalone functionality.
- [ ] Implementation complete

### 11. Connectors, MCP and webhooks (phase 7)
- Create `lib/connectors/{contracts,registry,credentials,mcp,webhooks}.ts`, provider adapters and authenticated routes/settings.
- Start with GitHub and generic approved MCP/HTTP adapters; implement concrete mail/calendar/storage/Slack/Teams/DB adapters separately. Scoped encrypted credentials, OAuth state/PKCE where supported, SSRF boundaries, signed replay-resistant webhook inputs, revoke and audit.
- [ ] Implementation complete

### 12. Browser/computer agent (phase 8)
- Create isolated browser worker, snapshot/action contracts, domain grants, preview/approval UI and audit; desktop input uses an explicitly enabled local adapter.
- Page text cannot authorize actions. Never blindly replay submissions after timeout. OS-level control is unavailable unless a working adapter is configured.
- [ ] Implementation complete

### 13. Cyber Lab (phase 9)
- Separate sandbox network/profile and known training targets from Data/Code Labs. Explicit allowlisted authorized targets, default-deny external egress, reset and cleanup; no destructive real-world workflows.
- [ ] Implementation complete

### 14. Media and SVANS Live (phases 10–11)
- Extend image pipeline; add bounded audio/video extraction with timestamps in a separate worker and configured media provider adapters.
- Add real live transport/session state, interrupt/cancel, mic/camera/screen consent indicators and limited tool callbacks to `components/SvansVoiceConversation.tsx` plus `lib/live/` and authenticated session routes.
- Browsers' existing speech APIs are a fallback, not equivalent to full streaming multimodal sessions.
- [ ] Implementation complete

### 15. Automation and local/private modes (phases 12–13)
- Create `lib/automation/{schedule,triggers,runs}.ts`, worker scheduling and management UI using durable jobs; timezones, pause/revoke, dedupe and notify-only-on-matching-condition.
- Implement local-provider adapter in desktop boundary, scoped hybrid redaction, no cloud fallback in local-only mode and explicit privacy diagnostics.
- [ ] Implementation complete

### 16. Collaboration and controlled extension (phases 14–15)
- Scoped memberships, roles, comments, shared artifact history and authorized channel participation; no claims of live co-editing without implementation.
- SDK manifests, version pinning, candidate tools, isolated validation, admin-bound installation and revocation. Generated tools cannot add their own grants. Marketplace remains gated on signing/review maturity as specified by the roadmap.
- [ ] Implementation complete

### 17. Unified acceptance phase — ONLY AFTER all code above is updated
- Author regression/eval fixtures during implementation. Then run typecheck, unit suites, production build, HTTP smoke, desktop permission tests, tenant isolation, queue recovery, container/network boundaries, native Office opening/recalculation, media and browser scenarios.
- Real integrations/paid-provider tests need configured accounts and explicit cost/resource scope. Local passing checks do not prove production deployment.
- Record pass/fail/not-run separately; fix failures and rerun affected checks. Do not claim completion until actual acceptance evidence exists.
- [ ] Test execution authorized by completion of implementation pass
- [ ] Final verification complete

## Progress / rulings

- 2026-11-02: Repository clean on entry; current source inspected without execution. Outline now has 38 sections/15 phases, larger than prior review.
- User preference honored: original project location; work on a local feature branch, no commit/push/deploy. Existing paid providers and third-party services are not called as part of this coding pass.
- Test-first skill timing overridden by explicit user instruction; all runtime verification deferred. Read-only inspection and code review are not test execution.
- Independent read-only inventories attempted; helpers reached account usage limits. Continue local implementation without relying on missing reports.

### November 3 continuation — source changes only, verification still deferred

- Tasks 1–3 remain partial: shared provider attempt/outcome controls, cancellation, native artifact failover, actual capability events, and desktop IPC/path/command restrictions are coded. Ordinary chat still has its legacy retry loop; distributed provider health, full cost budgets, and broader evaluation infrastructure are pending.
- Task 4 partial: persistent generation jobs, lease/heartbeat/cancel/idempotent enqueue, a standalone worker, authenticated job/event APIs and compact progress UI are coded. Journal acknowledgement precedes capability execution. General approvals, budgets, DAG checkpoints, and indeterminate external-action recovery are not yet implemented. Only reply/file generation jobs are installed.
- Task 5 partial: private bucket storage, SHA-256 verification, authenticated downloads, immutable parent/root version history, cursor pagination, binary-identity comparison, restore-as-new-version, and signed-in chat references are coded. V1 inline attachment history remains readable. Metadata references never grant access by themselves.
- Task 6 partial: native PDF pagination/tables/page numbers; Excel typed dates/times, named ranges with cycle/resource checks, native filterable tables and linked bar/line charts; PowerPoint editable bar/line/pie/doughnut charts. Existing calculation/source-preservation checks remain. Charts have NOT been opened in Office or recalculated.
- Added structured recipe revision API and optional advanced editor for files generated from SVANS recipes. Explicit replacements are validated before rendering a new immutable file. This does not claim lossless editing of arbitrary uploaded Office files.
- PDF currently uses Helvetica/WinAnsi. Unsupported scripts/emoji fail explicitly instead of disappearing. Office-compatible PDF conversion, Unicode font embedding, full preview rendering, Excel pivot tables and image embedding remain pending.
- Read-only source review identified and corrected stale-account background/download UI handling, native permission-dialog navigation checks, and a desktop audit-promise error path.
- Request body readers now bound actual bytes without trusting Content-Length. Chat/API requests exceeding 250 messages fail explicitly instead of silently taking the last 250. The inner chat context compaction still needs phase 4 work.
- Office input resource guard checks package structure and actual bounded decompression before ExcelJS/Mammoth parsing. This is NOT a parser sandbox or malware certification; isolated parsing belongs to task 7.
- Ruling: dependency installation with scripts disabled is setup, not verification. Added pdf-lib 1.17.1 and an explicit JSZip 3.10.1 dependency; synchronized the lock and installed four dependency packages with lifecycle scripts disabled. No tests/builds/lint/typechecks/smoke checks were run.
- Ruling: unavailable integration behavior stays feature-gated. SVANSAI_JOBS_ENABLED and SVANSAI_ARTIFACT_STORAGE_ENABLED are not enabled by this pass. SQL source is appended to the existing schema setup because the Supabase CLI is absent; production migration packaging/application is pending and requires separate approval.
- New regression fixtures cover PDF, native charts/tables/dates/names, reference history, safe recipe edits, bounded upload bodies, Office package limits, and execution-journal ordering. All fixtures are **NOT RUN**.
- Tasks 7–16 remain unimplemented beyond prior foundations. Do not mark the roadmap complete or start acceptance tests. See docs/massive-update-status.md for configuration and next-work boundaries.

### November 3–4 continuation — isolated labs and selective coding

- Task 7 partial source implementation: execution contracts, scopes, client policy, private snapshot storage, explicit approval APIs, and an opt-in Data & Code Labs panel. Paths/text/bytes are bounded; known secret patterns are screened without claiming exhaustive detection.
- Task 4 extended for lab consumers: waiting-approval and indeterminate states, hash-bound approvals expiring in 15 minutes, one run per approval, atomic 20-run/24-hour reservations, owner-scoped review, cancellation and event history. Generation jobs remain separate; no new general external actions are installed.
- Added separate Linux/rootless Docker/gVisor supervisor, immutable-image policy, no-network/no-host-mount execution, resource/output limits, process-tree termination through container removal, orphan cleanup and stop-on-unknown behavior. Source image recipes are supplied; no runtime images were built or pulled, and no supervisor was started.
- Approval hashes use canonical JSON so database JSONB key ordering does not invalidate unchanged requests. The worker reconstructs policy and checks the stored hash before execution; image/policy changes require new approval.
- Added exact-path selective desktop collection and one-hop relative JS/TS import expansion, with read/file/byte budgets and no full repository enumeration. Local collection does not upload files; saving the displayed snapshot and approving a run are separate explicit actions.
- Added bounded hypothesis ranking, contradiction/independent-evidence checks, narrow hash-bound patch proposals and a review-package helper that loads actual owner-scoped lab reports. Scores are explicitly heuristic; no root cause, CI parity, test coverage or full security audit is fabricated. Coding helpers are not yet a complete automatic investigator.
- Ruling: an ephemeral, separately deployed Linux worker is required for arbitrary generated code. No fallback executes it on the Next.js host or user's desktop. Cost: deployment requires a reviewed VM/runtime configuration before this feature can be enabled.
- Ruling: standard-library Node/Python profiles ship first within this coding slice. Full CI dependency images, browser E2E/database services and binary lab output extraction remain pending rather than being simulated. Exact-current image IDs are operator-provided; no fake digests or mutable tags are used.
- Added source-only supabase/lab_runtime.sql plus runtime-table extensions to the existing schema source. No SQL applied; CLI migration packaging remains pending.
- New regression fixtures: execution contracts, approval hash changes, selective read/contraction, evidence-driven hypothesis updates and narrow patch bounds. All **NOT RUN**. Existing tests/build/lint/typecheck/paid-provider/live DB restrictions remain unchanged.
- Next: complete lab/coding integration and continue task 8's project permissions, durable evidence/provenance and context compaction, alongside remaining phase 1–3 gaps. Tasks 8–16 are not complete. Do not start acceptance yet.
