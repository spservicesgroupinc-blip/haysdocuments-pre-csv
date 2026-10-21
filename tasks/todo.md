> Status October 21, 2026: local implementation is available in the Ready hosted preview.
> See verification.md for passed checks and rollout.md for external deployment limits.
> Checkbox evidence below distinguishes implementation from live/device acceptance.

# Restoration workspace implementation checklist

Plan: [plan.md](plan.md). Status: planning complete; implementation has not started.

Implement in order. Each task is a verifiable slice, not an instruction to build an entire subsystem in one pass. Record commands, results, and any material limitation below its task before marking it done. Preserve existing unrelated changes. The full behavioral/API contract is in the plan.

## Stage 0: baseline and safe shared work

### T01. Record baseline and contract fixtures

- [x] Verify repository identity/rules and preserve dirty files; record independent baseline command results from the plan.
- [x] Add fixtures for a v1 job, a populated legacy change, two users, a pending offline write, and a shared cloud draft.
- [x] Confirm original PDF samples and current save/recovery behavior before changing them.

Depends on: none. Verify: existing typecheck, save/backend tests, intake tests, UI checks, build, and original PDF sample tooling. Document existing failures individually.

### T02. Define supporting models and pure migration helpers

- [x] Add typed payload unions, validators, stable IDs, revision types, cents/date helpers, and schema-v2 defaults.
- [x] Prove old fields/unknown values survive; legacy change import uses a deterministic ID and does not invent approval.
- [x] Add workflow:test with defaults, migration idempotence, bounds, and money/date cases.

Depends on: T01. Verify: workflow:test, lint, parser/intake regressions. Evidence:

### T03. Add backend storage and capabilities

- [x] Provision JobItems/JobMutations and append core revision metadata idempotently without column reorder.
- [x] Implement authenticated capabilities, paginated item reads, workflow summaries, and typed item validation.
- [x] Add apps:test:workflow using the existing VM-style testing approach.

Depends on: T02. Verify: schema provision twice, viewer reads, denied writes, wrong-job references, pagination, apps:ascii. Evidence:

### T04. Implement revision checks and recoverable mutation commits

- [x] Protect core save/delete and typed supporting mutations with expected revisions and durable mutation IDs.
- [x] Implement journal recovery, replayed acknowledgments, hash mismatch rejection, and repairable system event projection.
- [x] Preserve legacy reads; enforce the explicit compatibility/write-protection activation behavior.

Depends on: T03. Verify: stale writes, concurrent same/different items, crash at each commit boundary, lost acknowledgment followed by another write, stale client rejection. Evidence:

### T05. Upgrade device storage and queued synchronization

- [x] Add IndexedDB supporting-item/blob/base/conflict stores and mutation-aware outbox operations without clearing v1 data.
- [x] Persist optimistic state and outbox atomically; migrate pending operations with IDs assigned once; honor target/dependency ordering.
- [x] Preserve account ownership, handle persistent conflicts, and continue unrelated queue work.

Depends on: T04. Verify: fake-indexeddb upgrade, transaction abort, reload/retry, account switch, late acknowledgment, existing database:test. Evidence:

### T06. Isolate draft recovery and expose conflict resolution

- [x] Scope cloud drafts to account/device/job; preserve the legacy shared draft as an explicit recovery option.
- [x] Show local/server comparisons and reviewed resolution actions without overwriting unsynced work.
- [x] Retain current local autosave timing and update/sign-out flush behavior.

Depends on: T05. Verify: two accounts and devices on different jobs, same-job stale draft, offline reload, save:ui:test, apps:test:drafts. Evidence:

### Checkpoint A: shared-work foundation

- [x] Foundation test suites and production build pass; baseline exceptions are identified.
- [x] Two users cannot silently replace one another's core/job-item changes; pending v1 data survives upgrade.
- [x] Record evidence before proceeding to workflow screens.

## Stage 1: progress, updates, and production handoff

### T07. Deliver job stage and next action

- [x] Add persisted stage/action/responsible-person/date controls and history through the new item service.
- [x] Extend existing job cards/Home with compact summaries, limited attention list, filters, and due-date rules.
- [x] Add active-window refresh and offline/cached status with no extra navigation destination.

Depends on: Checkpoint A. Verify: workflow:test and desktop/mobile browser cases for overdue/Mine/complete/reopen/offline state. Evidence:

### T08. Deliver quick update notes and activity history

- [x] Add one-note composer and paginated activity list within Production; support author/admin corrections and immutable system events.
- [x] Generate editable customer-update drafts from selected safe content; copy only, never send.
- [x] Make posting retry safe and retain notes when later file uploads fail.

Depends on: T07. Verify: duplicate posting, note corrections, pagination, no internal fields in draft defaults, offline reload. Evidence:

### T09. Deliver backend attachment reservation and file transfer

- [x] Configure private Drive root/per-job folders; implement reserve/upload/read with type/size/hash/job/role checks.
- [x] Reconcile interrupted Drive creation using stable attachment IDs and staged files.
- [x] Refuse public sharing, arbitrary Drive IDs, unsupported bytes, and uploads to deleted jobs.

Depends on: T08. Verify: backend file mocks including crash recovery, hash mismatch, wrong-job access, viewer denial, missing folder config, apps:ascii. Evidence:

### T10. Deliver device attachment queue and previews

- [x] Add photo normalization, PDF selection, durable blobs, sequential transfer, preview, retry, and removal states.
- [x] Enforce 5 MiB/file and ten-file batch limits; handle unsupported HEIC and device-storage failures without dropping notes.
- [x] Associate ready/pending files with updates and expose usable offline cached previews.

Depends on: T09. Verify: offline note plus two attachments, reload, retry after lost acknowledgment, orientation, quota failures, viewer UI. Evidence:

### T11. Deliver live handoff summary and readiness review

- [x] Reuse job fields and readiness rules, with self-pay handling and minimal operational confirmations.
- [x] Add linked blockers/warnings, draft state, and attributed readiness overrides.
- [x] Keep team/notes/checklist accessible through compact Production sections.

Depends on: T10. Verify: handoff selectors, unknown amounts versus zero, self-pay rules, blocker navigation, 390-pixel layout. Evidence:

### T12. Deliver frozen handoff artifacts

- [x] Generate/preview branded internal handoff PDF and publish immutable source snapshot plus ready output files.
- [x] Record manifest/revisions, expose previous versions, and mark stale handoffs after source edits.
- [x] Allow labeled offline drafts; require synced sources for final publication.

Depends on: T11. Verify: snapshot immutability, source change after publish, file failure/retry, rendered long/multi-page PDF review. Evidence:

### Checkpoint B: first useful team release

- [ ] Progress, updates, files, and handoff work end to end; original eight forms still generate correctly.
- [ ] Test built PWA offline/reload/update and two signed-in users against a test deployment.
- [ ] Record local/browser/live/device evidence and proceed to the remaining stages.

## Stage 2: selections and multiple changes

### T13. Deliver selections with recorded decisions

- [x] Add optional selection list/editor, responsibility, date, allowance, attachments, and attributed decisions.
- [x] Invalidate approval when approved specification/allowance changes; surface due decisions in Home.
- [x] Provide explicit Create change prefill without inventing an amount or authorization.

Depends on: Checkpoint B. Verify: simultaneous separate selections, same-item conflict, approval reset, blank allowance, due-date reminders. Evidence:

### T14. Deliver legacy change migration and multi-change drafts

- [x] Import meaningful legacy content once, preserving values and compatibility PDF input.
- [x] Deliver change register/draft editor with independent customer/carrier decisions and supporting records.
- [x] Keep legacy field as an adapter snapshot rather than another editable record source.

Depends on: T13. Verify: empty defaults create no legacy change, repeated migration, pending decisions, multiple draft retention. Evidence:

### T15. Deliver financial baselines and change finalization

- [x] Require reviewed contract baseline/brought-forward amount; calculate exact-cent authorized totals without rewriting payment schedules.
- [x] Assign final numbers server-side; freeze each issued change's source/PDF and create amendments for subsequent edits.
- [x] Handle increases, credits, zero-dollar day changes, rejection/void, and legacy previous changes without double-counting.

Depends on: T14. Verify: exhaustive amount/approval combinations, concurrent final numbering, frozen PDF consistency, rendered original change-form comparison. Evidence:

### Checkpoint C: selections and change register

- [x] Multiple selections/changes survive offline retries and independent team edits.
- [x] Legacy and newly issued change documents remain reproducible after later job edits.
- [x] Record calculation, migration, UI, and visual PDF results.

## Stage 3: closeout and completion

### T16. Deliver closeout checklist and punch items

- [x] Add optional closeout completion date, checklist evidence/reasons, and small punch list within Production.
- [x] Surface unfinished work and allow only attributed completion overrides; keep payment/submission status factual.
- [x] Completion is explicit and separate from generating documents.

Depends on: Checkpoint C. Verify: not-applicable reasons, completion blocker/override, overdue suppression/reopen, no implied payment/claim approval. Evidence:

### T17. Deliver reviewed closeout exports

- [x] Implement internal/customer/carrier presets with allowlisted summaries and exact selectable file manifests.
- [x] Generate completion PDF, captioned photo appendix, ZIP, and immutable source/output artifacts.
- [x] Enforce available-file and 25 MiB source limits; preserve choices on interruption and omit nothing silently.

Depends on: T16. Verify: private-field exclusion, ZIP versus manifest equality, missing offline files, oversize selection, long PDF layouts and image orientation. Evidence:

### T18. Complete cross-feature regression and device review

- [x] Add/run workflow:ui:test with two browser contexts, desktop and mobile viewport, keyboard/labels/focus checks, and dark/light themes.
- [ ] Run original/new PDF samples, spans/audits, Poppler rendering, production PWA offline/update checks, phone capture, and Electron save/export path.
- [x] Run all relevant commands individually; document failures and distinguish mocks, live tests, and actual device checks.

Depends on: T17. Verify: all acceptance tables in plan.md plus original intake/save/document regressions. Evidence:

### T19. Prepare and verify staged rollout

- [x] Update backend/API/migration documentation and deployment flags; run apps:ascii, apps:paste, focused checks, and production build.
- [ ] Back up and test the migration, deploy backend before frontend preview, coordinate revision-protection activation/PWA update, and exercise signed-in round trips.
- [x] Record exact deployment state, rollback path, remaining operational steps, and safe diagnostics; never call a push a backend deployment.

Depends on: T18. Verify: live two-user edit/conflict, real Drive upload/download, issued handoff/change/closeout exports, stale-client rejection, compatible feature-disabled rollback. Evidence:

### Final checkpoint

- [x] All six capabilities delivered with five main destinations and no new unrelated management systems.
- [ ] No lost drafts, silent last-save overwrite, duplicate retries, fabricated approvals, or automatic external communications.
- [x] Task evidence distinguishes local, preview, backend, production, and device verification; unresolved limitations are explicit.
