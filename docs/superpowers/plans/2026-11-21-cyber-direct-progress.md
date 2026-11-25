# Cyber Lab: direct, evidence-led progress

Goal: Implement the agreed authorized investigation behavior locally, without changing owner controls, idle locking, provider refusal handling, or deployment flags.

Architecture: A bounded structured reply is validated before rendering. Server-authored inference records track suggested actions and evidence-linked outcomes in existing project/conversation context events. They never grant permissions or claim tool execution. Existing provider execution and scoped storage remain the boundaries.

Tech stack: TypeScript, existing Next.js/provider runtime, existing context RPCs, node:test/tsx.

## Approved behavior

- Accept typed questions, logs, source/configuration and optional images; analyze current attachments afresh.
- Interpret evidence, offer one next action with machine/environment, rationale, expected result and branches. Answer conceptual questions directly without forced commands.
- Keep target/scanner/OS/constraints distinct. Preserve competing hypotheses and corrections.
- Record proposed/completed/failed/blocked/rejected steps, citing user/tool evidence for outcome updates. Inferences are not verified observations.
- Reject an unchanged repeated action unless a specific reason and new evidence justify revisiting it.
- Preserve owner verification, password unlock, manual mode, 30-minute idle lock, scoped authorization, redaction and terminal provider refusals.
- No automatic device control, permission widening, stealth abuse, deployment or database writes during verification.

## Tasks and verification ledger

- [x] Add failing contract/progress/compaction tests, then implement bounded validation and rendering.
- [x] Add failing runtime tests, then connect authorization, provider validation and scoped persistence.
- [x] Verify full local test suite and production build; perform final independent review.

Ruling: Reuse the clean existing non-main checkout, no new worktree or commit.
Ruling: Background generation uses a frozen context revision. It will read progress but not advance it; doing so would invalidate the existing queued-job publication binding. Disclose this limitation rather than weakening the binding.
Ruling: Reuse existing event schema; no migration is applied. History remains bounded by the existing 256-event database read and context budget. Omitted history is disclosed, not represented as perfect memory.
Ruling: This is a local software update. Live activation still requires the separate database/tenant/owner acceptance checks.

## Completion record — 2026-11-25

- Added structured answer/next-step/blocked replies and bounded project/conversation progress records. Current input can be text, logs, code/configuration or images.
- New tests first reproduced missing contract/runtime support and JSON redaction corruption, then passed after implementation.
- Independent review found a copied-context publication bug (P1), stale uncited evidence qualifying as new (P2), and PowerShell capitalization bypassing repetition checks (P2). All were reproduced with failing regressions and corrected.
- The real chat-entry integration test uses intercepted HTTP with fake provider/database responses. It verifies shared revision state reaches outer publication checks and a separate request signal cannot replace an owner-revocation signal.
- New evidence is checked against bounded available-evidence IDs and the observation-time watermark. PowerShell cmdlet names normalize case; argument values do not.
- `npm run test:cyber-progress`: 23 passed.
- `tsx --test scripts/*.test.ts`: 127 passed, 0 failed.
- `npm run test:desktop-security`: 4 passed, 0 failed.
- `npm run build`: successful, including TypeScript and route generation.
- `git diff --check`: passed. Git emitted only line-ending normalization notices.
- No live provider calls, database writes, migrations, feature-flag changes, commits, pushes or deployment were performed. Live persistence and actual model behavior still need the authenticated staging acceptance checks documented in `docs/cyber-direct-progress.md`.

Ruling: Keep the existing branch and changes local for owner review. No worktree cleanup or branch integration is authorized by this task.
