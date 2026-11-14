# Verification and release scope — November 14, 2026

## Verified locally

- All 101 tests in `scripts/**/*.test.ts` and `scripts/**/*.test.cjs`: PASS,
  zero failures, skipped tests or cancellations.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`: PASS.
- `node node_modules/next/dist/bin/next build`: PASS (Next.js 16.3.7).
- `node scripts/quality-guards-regression.mjs`: PASS. This legacy script tests
  copied local guard logic; it is not an end-to-end provider-quality evaluation.
- `node scripts/artifact-http-smoke.mjs`: PASS against the production build.
  Both `/api/chat` and API-key-authenticated `/api/v1/chat` produced 20 exports
  covering DOCX, XLSX, PPTX, PDF, CSV, TXT and Markdown. Assertions check native
  package entries, a readable PDF, text/CSV contents and nonduplicated binaries.
  Missing credentials, forged Cyber flags, anonymous private-resource access and
  anonymous/cross-origin unlock attempts were rejected. These are negative-access
  tests, not verification of a signed-in owner's database-backed session.

The HTTP test uses a separate loopback server, clears provider credentials, blocks
external fetches and disables new persistence/worker features in the child process.
Image-provider calls are mocked in unit tests. No paid inference was requested.

Reproduce the complete local unit suite in PowerShell:

```powershell
$files = @(rg --files scripts -g '*.test.ts' -g '*.test.cjs')
node node_modules/tsx/dist/cli.mjs --test --test-reporter=spec @files
```

## Failures corrected

1. Chat request array typing now permits supplemental context without an ID while
   preserving real message IDs for persistent context.
2. Native PowerPoint charts use the installed library's `showLabel` option.
3. Both worker command environments explicitly set NODE_ENV without inheriting
   credentials or arbitrary host environment variables.
4. The Excel time assertion now verifies stored numeric OOXML and the Date that
   ExcelJS returns on reload; the original workbook time was correct.
5. Supplied interactive workbook specifications now validate and export locally.
   Raw CSV requesting calculations still requires drafting; invalid specifications
   or missing formulas cannot silently become static workbooks. Regression tests
   reproduced the original unwanted provider invocation before the fix.

## Integration and publication

The live repository had 24 commits after the original checkout. Merge resolutions
retain the newer shared owner-grant, execution and scoped-context architecture
instead of reintroducing process-local unlocks, transcript IP guessing, or refusal
fallbacks. Remote prompt/critic additions and its test entry point are retained.
The three legacy Cyber suites were adapted to the new contracts, preserving access
gates, scanner/target continuity and explicit provenance. Both histories remain.

The owner approved My Workspace and Git commit/push for deployment. Target:
`svansai-frontend`, Render service `srv-d7avja0ule4c738nhs0g`, GitHub `main`.
Pre-release live commit: `f169c924924be41144d780111408b15e27d33e1d`.
Pre-release live deploy: `dep-dblasoflk1mc73eo7s70`.

The following flags were explicitly saved as 0 on that service, merging without
replacing unrelated configuration: SVANSAI_ADMIN_CYBER_MODE_ENABLED,
SVANSAI_CYBER_EXECUTION_ENABLED, SVANSAI_JOBS_ENABLED,
SVANSAI_ARTIFACT_STORAGE_ENABLED, SVANSAI_LABS_ENABLED. They take effect with
the applicable deployment. This is a web release, not a new Windows installer.
Deployment is not complete until the release commit is live and HTTP checks pass.

## Not yet verified / not activated

- SQL migrations, RLS/tenant isolation, shared grant/rate-limit transactions,
  authenticated context persistence, private bucket/version publication and
  multi-worker lease/cancellation/recovery behavior.
- Rootless Linux/gVisor containment, image builds, live scanner fixtures, or
  Data/Code/Cyber worker execution. No containers were built or started.
- Interactive browser/Electron acceptance, Windows installer packaging/signing,
  actual Office opening/recalculation, PDF visual review, and paid-provider quality.
- Separate live chat/attachments/profile-memory regression scripts, because they
  call providers or change real account data.

The initial build warned that Browserslist compatibility data is stale. This is
non-blocking; no unrelated dependency update was made to silence it. A staged
secret-pattern check flagged only a deliberately incomplete PRIVATE KEY header
in a rejection test, not a real credential. Local secrets were not staged.

These results do not mark every massive-update backlog item complete or establish
production readiness for disabled features. Rollback of the web build does not
restore database state; no database changes were made in this release pass.
