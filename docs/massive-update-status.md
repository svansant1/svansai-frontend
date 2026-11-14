# Massive update — implementation ledger

Updated November 4, 2026. Original SVANS-AI frontend, branch `codex/massive-update-2026-11-02`.

**Status: coding in progress. This is not a release or a passing test report.**
The user requested that all coding finish before tests. No tests, typechecks, lint,
builds, desktop launches, paid-provider calls, or live database checks have run.
Nothing has been committed, pushed, deployed, or applied to a database.

## Code added so far

- Shared provider transport cancellation, typed failure outcomes and bounded artifact failover.
- Capability registry with callable handlers and actual execution events, separate from suggested module badges.
- Desktop renderer/IPC boundaries, canonical workspace checks, native write approvals and dedicated read-only Git inspection. General host command execution is disabled until an isolated runtime exists.
- Durable reply/file generation jobs with owner scope, idempotent enqueue, leases, recovery limits, cancellation, event journaling, a worker and compact UI.
- Private generated-file storage, authenticated hash-checked downloads and immutable versions.
- Restoring an earlier version creates a new version. Comparison reports binary identity only, not a semantic redline.
- Recipe-based editing preserves untouched fields of a SVANS-generated document/workbook/deck. Arbitrary uploaded files are not passed through a lossy rewrite disguised as a native edit.
- Native PDFs: headings, paragraphs, lists, paginated tables, repeated table headers, running headers/footers and page numbering.
- Excel: native dates/times, named ranges, filterable tables and linked bar/line charts alongside existing formulas, validations, conditional formats and multi-sheet workbooks.
- PowerPoint: editable bar/line/pie/doughnut charts with embedded workbook data.
- Office package resource limits, explicit source-extraction limitations and byte-bounded HTTP bodies.
- Separately deployed isolated lab worker code, exact-snapshot approval UI/API, run limits, cancellation, cleanup and non-replayable unknown outcomes.
- Selective local file collection, evidence-ranked hypotheses and immutable narrow patch/review-package helpers (not yet an automatic investigator).

All items above describe **written code awaiting verification**, not confirmed runtime behavior.

## Configuration is not activation

Existing ordinary chat and inline downloads retain their original flow when the new storage flags are absent.

| Setting | Purpose | State in this pass |
| --- | --- | --- |
| `SVANSAI_ARTIFACT_STORAGE_ENABLED=1` | Signed-in chat stores files privately and returns references | Not enabled |
| `SVANSAI_JOBS_ENABLED=1` | Enables queued generation and the worker | Not enabled |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server runtime storage credentials | No values changed or printed |
| Private bucket `svans-artifacts` | Native generated file bytes | Not provisioned |
| Runtime SQL in `supabase/personalization_schema.sql` | Jobs, events, leases, artifact metadata/recipes and RLS | Source only; not applied |
| `npm run worker:jobs` | Separate worker process using its process environment | Not started |
| Provider model/allowlist environment variables | Per-vendor models and eligible cloud providers | No values changed |
| `SVANSAI_LABS_ENABLED=1` and immutable Node/Python image IDs | Separate approved lab execution | Not configured or enabled |
| `supabase/lab_runtime.sql` | Lab approval, run budget and one-attempt claims | Source only; not applied |
| `npm run worker:labs` | Dedicated Linux/rootless/gVisor supervisor | Not started; no images built |

Never expose a service-role key in a browser or make the artifact bucket public.
Enable these flags only after the complete implementation's acceptance phase and
database migration review. A running web server alone does not run the queue worker.

## Explicit current limits

- PDF is a real PDF, not a renamed text file. This renderer uses Helvetica/WinAnsi;
  unsupported scripts/emoji fail instead of being replaced. Full Unicode fonts and
  layout-faithful Office conversion remain future work.
- Excel charts are native OOXML linked to cells. Formula results are not calculated
  on the server; Excel must recalculate on opening. There is no claim of validated
  numerical results or Office compatibility until the deferred tests run.
- Native Excel chart types currently supported: bar/line. Pivot tables, macros,
  arbitrary native image embedding and structured table-reference formulas are not implemented.
- Native PowerPoint charts support bar/line/pie/doughnut, not unrestricted arbitrary chart XML.
- Revision APIs only accept validated data recipes and bounded explicit replacements.
  They cannot execute code, add macros, fetch assets or edit another user's file.
- Upload parsing accepts ordinary bounded Office ZIP packages, not encrypted,
  ZIP64 or multidisk archives. Package limits are not a substitute for parser isolation.
- Ordinary background generation jobs produce text/files only. Separate lab jobs
  have code for isolated approved snapshot execution; neither queue can send mail,
  browse interactively, install software or deploy.
- The inner conversation context window and existing analysis sampling still need
  the planned provenance/compaction work. Removing an API truncation does not make
  context unlimited.

## Next implementation work

Task 7 now has a source implementation of a separately deployed, fail-closed
Data/Code Lab worker, approval APIs/UI and bounded selective coding helpers. See
workers/labs/README.md for its limits and required deployment boundary. No lab
container, image build, worker, test or database change has run.

The lab code includes account-scoped snapshot review, exact-payload/image approval,
expiry, daily run reservations, cancellation, leases and indeterminate outcome
handling. A private snapshot must be explicitly uploaded and then approved; local
folder access alone grants neither. Node/Python standard-library profiles are not
a full CI reproduction system. The automatic chat-driven investigator, durable
evidence store, broader CI profiles and binary result export are still pending.

Finish the remaining provider/job approval and budget work alongside their
consumers. Tasks 8–16 cover project retrieval, research,
supervisor/DAGs, connectors, browser/computer operation, Cyber Lab, media/Live,
automation/local-only execution, collaboration and controlled extensions.

Full previews, imported Office editing and compatible conversion also remain open
in tasks 5–6. Do not close these tasks because their contracts or UI buttons exist.

## Deferred verification inventory

`npm run test:expansion` and `npm run test:desktop-security` have been added for
the later acceptance phase, alongside the existing artifact/chat regressions.
Typecheck, production build, native Office open/recalculation, PDF visual inspection,
browser/desktop UI review, database tenant-isolation and queue recovery checks are
also still required. None of these commands/checks has run.

The newly authored npm run test:labs fixtures are also **NOT RUN**. Adversarial
lab containment, tenant isolation, cancellation and recovery require a separately
configured acceptance host. No container image IDs were invented or installed.

Implementation references: PDF font/layout APIs follow the [PDF-lib API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

## November 10 — Cyber integration source pass

Owner grants with 30-minute idle locking, persistent scoped investigation evidence,
shared-provider authorization, native-report/background-job bindings, and a separate
approved synthetic-fixture executor have now been written in source. See
ADMIN_CYBER_MODE.md and docs/cyber-integration-progress.md for the exact boundaries.
This does not close the remaining unrelated massive-update tasks.

All new fixtures, builds, migrations, images, workers, UI behavior, containment
and regression checks remain **NOT RUN**, per the owner's instruction. No commit,
push, production configuration change or deployment was performed.
Editable PowerPoint charts use the [PptxGenJS chart API](https://gitbrent.github.io/PptxGenJS/docs/api-charts/).
Native workbook chart parts follow Microsoft's [Open XML chart structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-insert-a-chart-into-a-spreadsheet).
