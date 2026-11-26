# Cyber project storage verification - November 26, 2026

## Scope and current outcome

The owner approved installing the missing database foundation and verifying project
creation, without enabling Cyber Lab. The database portion is complete. The live
Create project workflow is **not yet fixed end to end**: a separate origin-check
failure was reproduced during the final HTTP checks.

No application commit, push, deployment, feature-flag change, worker activation,
password change or retained owner unlock was performed in this database pass.

## Follow-up origin correction (approved separately)

The owner subsequently approved correcting, testing and deploying the request
check. The shared guard now accepts only exact origins in the server-controlled
`SVANSAI_APP_ORIGINS` list when configured. It never adds origins from Host or
Forwarded headers. Without configuration it retains direct same-origin behavior
for local development. Invalid configured origins fail closed with 503; absent,
opaque, malformed and untrusted request origins fail with 403.

Deployment configuration uses `https://svansai.com` and the verified service URL
`https://svansai-frontend.onrender.com`. The www address redirects to the canonical
site and is not added as a separate trusted origin. This is separate from API CORS
and does not grant sign-in, owner unlock, project ownership or execution access.

Six regression tests were added. Before the fix, four failed, including the real
project POST route returning 403 instead of reaching its 401 sign-in check. All
six now pass, as do the complete 137-test offline suite, the production build and
the 20-export HTTP smoke suite. The HTTP suite also exercises the public-origin
request against an internally addressed server and checks untrusted/null/missing
origins. No paid providers or production account tokens were used.

Deployment and post-deploy acceptance are recorded separately after they complete.

## Applied migration

- Supabase project: `keccckqqaixcfspewrib` (matched to the app configuration).
- Hosted migration: `20261126060128_cyber_core_project_context.sql`.
- The local filename matches the version recorded by the hosted migration API.
- Added `sv_owner_control`, `sv_owner_attempts`, `sv_owner_grants`, `sv_projects`,
  `sv_context_heads`, `sv_context_events` and `sv_cyber_modes`.
- Added the nine core owner/session, context and mode-binding functions from the
  existing runtime schema, with service-only grants and supporting FK indexes.
- Existing conversation tables and application records were not migrated.
- Job queues, workers, artifact publication and execution schemas were excluded.

All seven new tables have RLS enabled. Direct `anon` and `authenticated` table
privileges are revoked; the server service role has access. All nine functions
are security invoker with a fixed search path. Function execution is denied to
`anon` and `authenticated` and granted to the server service role. This design
requires the app server to verify the caller and enforce account/project scope;
it does not give browser clients direct storage access.

## Checks completed

- Real production REST/store acceptance: `createProject` and `listProjects`
  successfully created and returned an owner-scoped, uniquely named fixture.
- Another account ID's list did not include that project; anonymous direct table
  access was denied. This is not a logged-in second-account browser test.
- The fixture was removed using its exact generated name and account ID.
- Transaction-only SQL acceptance passed for context append/read, stale revision
  rejection, cross-account rejection, conversation/project binding, context
  deletion invalidation, grant redaction, activity renewal, the thirty-minute
  idle deadline, manual locking and stale unlock epochs.
- All transactional fixture changes, grants, mode selections and counters were
  rolled back. Subsequent queries found zero verification projects and zero
  verification conversations.
- Production permission queries confirmed the table/function grants above.
- `npm run build` passed, including TypeScript and production page generation.
- No paid model inference, device commands or penetration tests were performed.

The opt-in store check is in `scripts/verify-cyber-project-storage.ts`. It requires
`--confirm-live`, the matching `--project-ref` and an existing approved `--user-id`.
It is deliberately not included in the offline `*.test.ts` suite. The SQL checks
are in `scripts/verify-cyber-core-transaction.sql`; execute only inside a transaction
with `svans.verify_user` set to the approved account, then roll back.

## Remaining live request blocker

An unauthenticated request to `GET https://svansai.com/api/projects` returns the
expected 401 sign-in response. However, a POST to that same endpoint with
`Origin: https://svansai.com`, JSON content type and an empty body returns:

```text
HTTP 403: Owner controls require a same-origin request.
```

This occurs before authentication, body handling or project storage. No account
token or project name was sent, and no project was created by this probe.

`lib/auth/owner-session.ts` compares the Origin header only with
`new URL(req.url).origin`. The live custom-domain request is being rejected by
that comparison. A reverse-proxy/public-origin mismatch is the leading diagnosis;
the internal request origin has not been captured, so its exact value is unknown.
The same helper is used by owner controls, context writes and Cyber endpoints.

Next app fix: reproduce the public-origin/proxy case in a regression test and
validate against a trusted deployment origin without accepting arbitrary forwarded
headers or removing cross-origin protection. Verify same-site requests reach
authentication while foreign/null/malformed origins remain blocked. Review, build
and deploy only with approval, then repeat the live check and the owner's signed-in
Create project interaction. Do not describe the UI as fixed before that succeeds.

## Security review and activation status

The advisor reports seven INFO-level "RLS enabled, no policy" notices for the new
tables. That is intentional for server-only storage with direct client privileges
revoked, not a reason to add public policies.

Pre-existing findings remain unchanged: thirteen older public tables have RLS
disabled, including `conversations` and `conversation_messages`, and leaked-password
protection is disabled. Review the existing callers and ownership policies before
changing those tables; do not broadly enable access or apply one policy to all.

- [RLS-disabled advisory](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
- [Server-only/no-policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

The live owner-status endpoint still reports `featureEnabled: false` and
`unlocked: false` for an anonymous request. Cyber Lab remains disabled. The new
database checks alone do not establish activation readiness: legacy conversation
access controls, authenticated UI flows and any separately enabled workers still
need acceptance. No project fixtures were retained, so an empty project list is
expected until the owner can successfully create a real project.
