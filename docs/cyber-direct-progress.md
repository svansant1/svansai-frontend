# Cyber Lab direct investigation replies

## What this local update adds

Cyber Lab accepts typed questions, pasted output, code/configuration files and optional images through the existing chat path. New replies interpret evidence first and either answer directly, ask a focused blocking question, or propose a next manual action with the exact machine/environment, rationale, expected result and follow-up branches.

The server validates a bounded reply contract before displaying it. Suggested actions become project/conversation-scoped `next_action` events. Outcome updates can mark a known step completed, failed, blocked or rejected only when they cite additional user/tool evidence. They remain assistant **inferences**, not authenticated observations, tool execution or permission grants.

An unchanged action on the same machine/environment cannot be reissued without a revisit reason and new evidence. Each step records available evidence IDs and an observation-time watermark, so old, uncited evidence does not qualify. The duplicate check normalizes whitespace and PowerShell cmdlet capitalization without lowercasing arguments. Semantic similarity, relevance of evidence and natural-language correctness still depend on the model; this is not a guarantee that every possible paraphrase or mistake is detected.

## Example response shape

> Your output reports the service is stopped. That does not yet establish a firewall problem.
>
> Next — your Windows target / PowerShell: inspect the service state.
>
> Why: distinguish a stopped service from a network reachability problem.
>
> Look for: running, stopped, or an error.
>
> If running: inspect the listener. Otherwise: provide the service error or stopped-state result.
>
> This is a suggested manual action; I have not run it.

This is an illustrative format, not a finding from a scanned device.

## Memory and failure behavior

- Identity/constraints, latest evidence, progress and decisions take priority over older raw logs in the active prompt.
- Corrections supersede old records. User-reported evidence cannot be promoted to connected-tool evidence by the client.
- Failed or conflicting progress saves withhold the proposed reply. Own progress writes coordinate with the live permission watcher; foreign revisions are never silently adopted.
- Background generation keeps its frozen context binding: it can read progress but does not save proposed progress changes, and says so in its reply.
- The database read remains bounded to 256 active events and the prompt has a character budget. Omitted evidence is disclosed. Export/reload is available, but this update does not add unlimited memory or retrieval of every archived step.
- Provider refusals remain terminal. Availability or invalid output can use existing bounded fallback; this is not a safety-bypass mechanism.

## Unchanged controls and rollout

Verified owner sign-in, password unlock, manual Cyber Lab ON, project/conversation scope and the 30-minute inactivity lock remain required. Unlocking does not provide arbitrary device control or authorize new targets.

No feature flags, database migrations, credentials, commits, pushes or deployments are part of this update. Local tests use fake provider and storage boundaries; they do not prove live persistence or real-model response quality. Before enabling on svansai.com, complete the existing database/tenant/owner acceptance checks and an authenticated multi-turn staging test, including lock-during-generation and independent conversations.

## Local verification

Run `npm run test:cyber-progress` for the added contract, progress and runtime cases. Also run all `scripts/*.test.ts`, `npm run test:desktop-security`, and `npm run build` before release. See the dated implementation ledger for recorded results.
