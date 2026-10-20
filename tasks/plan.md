# Implementation plan: a focused restoration job workspace

Status: ready for implementation. Written October 19, 2026.

## 1. Objective, defaults, and boundaries

Expand this application from a document generator into a small shared job workspace for the office, estimator, and field project manager. Reduce repeated entry, status calls, and time preparing handoffs and closeout paperwork. Implement all six capabilities below in stages; do not treat the first release as completion of the whole initiative.

The user selected **whole team**, **less administrative work**, and **small job management tool**. The following recommended defaults are adopted because the follow-up questions were interrupted and the user instructed us to proceed:

- This application owns its lightweight status and next action. No automatic integration with another job system.
- Supporting uploads include photos and PDFs, stored privately in Google Drive through Apps Script.
- Reminders appear inside the app. Customer communications are reviewable text drafts that staff copy; no automatic email or SMS.
- Approvals are manually recorded decisions with a name, date, and evidence reference. They are not electronic signatures.
- Preserve the existing authentication, accounts, roles, branding, eight original forms, offline operation, and five main navigation destinations.
- Use Google Apps Script, Sheets, and Drive for new backend work. Do not introduce Firebase, a new backend service, a task-management platform, or a new UI framework. Existing unrelated integration cleanup is outside this initiative.

Success means a user can open a job, see its stage and next action, record an update, prepare a handoff, record selections and changes, and assemble a closeout packet without retyping information already stored. The main navigation must still contain Home, Intake, Job details, Production, and Documents.

Do not build accounting, payment collection, detailed crew scheduling, inventory, a customer portal, a chat system, automatic estimate comparison, or automated coverage/legal decisions. Do not change contract language, original PDF artwork, or payment formulas incidentally.

### Capability map and build order

| Module | Responsibility | Depends on |
| --- | --- | --- |
| workspace-foundation | Typed records, safe writes, draft isolation, offline queue, supporting files | Existing save/auth stack |
| job-progress | Stage, one next action, responsibility, due items | workspace-foundation |
| job-updates | Dated notes, supporting files, communication drafts | workspace-foundation |
| production-handoff | Reused job summary, readiness review, frozen handoff | job-progress, job-updates |
| selections | Materials/finishes, needed-by dates, recorded decisions | job-progress, job-updates |
| change-register | Multiple changes, separate decisions, stable document snapshots | job-updates |
| closeout | Completion checklist, selected evidence, reviewed export | All preceding modules |

Build sequentially in the task order in `tasks/todo.md`. Each slice must remain runnable. Do not stop for routine design choices already resolved here. Record any newly discovered contradiction before changing the agreed behavior.

## 2. Current implementation and architecture changes

### Verified starting point

This plan targets `C:\Users\russe\haysdocuments-pre-csv`, not a similarly named checkout. React/Vite renders the app; the current job record schema is version 1. `src/types/jobData.ts` contains the job types/defaults and a single `changeOrder`. `src/services/jobSync.ts` and IndexedDB provide local mirrors, autosave, and an account-owned outbox. `src/apps-script/Code.gs` is the backend source of truth and must remain ASCII.

The backend shares saved jobs across accounts, but checks for conflicting full-record saves only lead to a warning; the last write still replaces the record. Its cloud Drafts sheet uses a single shared workspace row. The frontend's local draft is already account scoped. Existing jobs occupy one serialized JSON cell with a 49,000-character guard. New histories and file bytes must not be placed in that cell.

Existing navigation already groups detailed sections into five destinations. Existing required-field checks cover customer name, property address, carrier, claim number, RCV, and deductible; extend those checks instead of creating competing validation lists. Original documents and ZIP output use a shared document catalog and pdf-lib/JSZip.

At planning time README.md, scripts/test-theme-ui.spec.ts, and src/BRAND.md have unrelated uncommitted changes. Preserve them. No application behavior has been changed by writing this plan.

### Storage and types

Keep the existing Jobs sheet and its legacy columns intact. Append revision metadata rather than reordering columns. Add two backend-owned sheets, provisioned idempotently:

1. **JobItems**: one row per supporting record, with `jobId`, `kind`, `itemId`, integer `revision`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt`, `lastMutationId`, and `payloadJson`.
2. **JobMutations**: durable mutation journal with `mutationId`, authenticated actor, target, request hash, expected revision, pending/applied state, serialized intent, result, and timestamps. Retain records for the life of the job; do not use an expiring cache as the retry guarantee.

Use a TypeScript discriminated union for JobItems. Allowed kinds are `workflow`, `activity`, `selection`, `change`, `closeout`, `attachment`, and `artifact`. Each kind has an explicit payload schema; reject unknown kinds, arbitrary JSON patches, and oversized payloads. Keep each serialized supporting payload below 40,000 characters. Store long snapshots and files in Drive, referenced by metadata.

Common identifiers are stable client-generated UUIDs, allocated when the user initiates an action and reused across retries. The singleton workflow and closeout item IDs are deterministic per job. Server-authoritative revisions, actors, and timestamps cannot be supplied as trusted client metadata. Store timestamps as UTC ISO strings, date-only inputs as `YYYY-MM-DD`, and display dates in America/Indianapolis. New monetary values use integer cents; adapt to existing dollar fields only at the legacy PDF boundary.

Minimum payloads:

| Kind | Required capability fields |
| --- | --- |
| workflow | stage, nextAction or null, holdReason, contractBaseAmountCents or null, openingPreviousChangesCents, latestHandoffArtifactId or null |
| activity | note, occurredAt, source manual/system, attachmentIds; system entries also have an event code and source mutation ID |
| selection | room/location, item, specification, allowanceCents or null, neededBy or null, responsible person, decision pending/approved/changes_requested, decision name/date/note, attachmentIds |
| change | display number, scope, insuranceRelated, signed amountCents, addedDays, lifecycle draft/submitted/closed/void, customer decision and carrier decision, attachmentIds, linked selection IDs, frozen document artifact ID or null |
| closeout | completion date, checklist decisions with evidence/note, punch items with open/done state, attachmentIds, latestArtifactId or null |
| attachment | filename, MIME type, byte size, SHA-256, Drive file ID, parent entity reference, upload state reserved/ready/failed, optional caption/category |
| artifact | type handoff/change_order/closeout, immutable source revision manifest, generatedAt, generatedBy, snapshot attachment ID, output attachment IDs, review state draft/final |

A responsible person is `{name, email?}`; an optional email is validated when present. Suggest existing Team names and the signed-in user without exposing the administrative user directory. Stage is one of intake, awaiting_contract, ready_for_production, in_production, on_hold, closeout, complete, cancelled. Next action is either null or `{id, title, responsiblePerson, dueDate?, completedAt?}`. There is one active next action per job; completing it records history and permits a replacement.

### API contract

Keep the current POST router and `text/plain;charset=utf-8` transport. Continue returning `{ok:true,data}` or `{ok:false,error,code}`. Add optional `details` to failures and preserve it in DatabaseError for conflict resolution. Never interpret HTTP 200 alone as a successful save.

All new routes require the current application session. Viewers may read; editors/admins may write. Check role and job existence on every mutation, including attachments. A soft-deleted job rejects new writes and uploads. Files are retrieved by job/attachment ID, never by a caller-supplied arbitrary Drive ID.

| Action | Input beyond session credentials | Result |
| --- | --- | --- |
| getCapabilities | none | API version, supported features, write-protection state, attachment limits/configuration |
| saveJob | existing job, protocolVersion:2, mutationId, expectedRevision | existing record response plus persisted revision/timestamps |
| deleteJob | recordId, protocolVersion:2, mutationId, expectedRevision | soft-deletion acknowledgment and revision |
| listJobItems | jobId, kinds, cursor?, pageSize? | items, nextCursor, serverTime |
| mutateJobItem | jobId, kind, itemId, operation create/update/delete, expectedRevision, mutationId, typed payload | canonical item and mutation acknowledgment |
| listJobWorkflowSummaries | jobIds, maximum 100 per request | workflow stage, next action, latest update, outstanding counts per job |
| saveWorkspaceDraft | jobId, deviceId, mutationId, expectedRevision, job snapshot | account/device/job-scoped draft acknowledgment |
| listWorkspaceDrafts | deviceId, cursor? | drafts owned by the authenticated account and matching device |
| reserveJobAttachment | jobId, parent reference, attachmentId, mutationId, filename, MIME, size, hash | reservation and upload status |
| uploadJobAttachment | jobId, attachmentId, mutationId, base64 bytes matching reservation | ready attachment metadata |
| getJobAttachment | jobId, attachmentId | authorized metadata and base64 bytes |

Mutation expectedRevision is 0 for creation and the last acknowledged server revision for updates/deletion. List page size defaults to 50 and is capped at 100. Cursors use a deterministic stable ID order, scoped to filters; de-duplicate client-side and retain tombstones when reconciling cached lists. Normal core-job saves must not include or replace JobItems.

Add internal typed methods for publishing artifacts using the same mutation and attachment primitives. Artifact metadata is publishable only when its referenced files are ready. Add explicit validation of relations so one job cannot reference another job's supporting record or attachment.

### Conflict protection and retry behavior

Use a script-wide lock around revision checks and state commits; release in finally. Locks coordinate writers but are not a cross-service transaction. Journal each intent before applying it. A row commit includes its mutation ID; recover an interrupted journal entry for that target before permitting another mutation to that target. If the row already contains the ID, reconstruct its acknowledgment rather than apply twice. Otherwise replay the stored pending intent at its validated base revision. Derive system activity from journal events with deterministic IDs, so a missing activity projection can be repaired without repeating the business change. [Google LockService reference](https://developers.google.com/apps-script/reference/lock/lock-service)

The same mutation ID and identical payload returns the original acknowledgment, even after later mutations. Bind each ID to its authenticated actor, job, target, and action before returning a replay; a different actor cannot retrieve another user's result. The same ID with a different hash returns `idempotency_conflict`. A stale revision returns `conflict` with the canonical current item/record in details. Do not overwrite automatically. Keep the local value and base snapshot; show a persistent comparison with actions to accept the server copy or save a reviewed local/combined copy against the latest revision. Resolving creates a new intent/mutation ID. Never discard an unsynced copy before a durable acknowledgment or an explicit discard action.

Separate items permit two people to add different updates or edit different selections without a conflict. Editing the same item or core record requires review. Pending/conflicted operations block only their own target and dependent operations, not unrelated jobs. Pause automatic retries for conflicts, invalid input, permissions, and missing capabilities; retry network/timeouts/busy failures using existing backoff. A timeout is an unknown outcome, so retry the original mutation ID.

Supporting writes for a brand-new offline job depend on acknowledgment of that job's creation. Attachment reservation depends on the parent supporting record; its upload depends on reservation. Final publication depends on every referenced mutation/file acknowledgment. Give each step its own mutation ID while retaining the same job/item/attachment IDs across the chain. Do not coalesce an already-sent mutation into a different payload; queue subsequent edits as a new intent based on its eventual acknowledgment.

Upgrade IndexedDB additively from version 1: add stores for supporting records, attachment blobs, cached base snapshots, and conflict records; extend outbox operations with stable mutation IDs, revisions, dependencies, and account ownership. Never clear jobs, drafts, or the existing outbox during upgrade. Assign IDs once to legacy pending writes before their first new-protocol send. Queue local item/blob/outbox changes in a single transaction and show success only after commit. Preserve the current 350 ms local autosave and 2-second idle/8-second maximum cloud scheduling for core drafts.

Replace the shared cloud draft behavior with keys scoped to authenticated account, stable device ID, and job ID. Keep local recovery first. The legacy shared cloud draft is retained read-only and offered as an explicitly labeled recovery copy; never silently load another user's work as the current draft. A restored draft must still pass revision checks when saved as a shared job.

### Files, security, and size limits

Store files under a Script Property-configured private root folder and per-job subfolders. Use the backend execution identity; new features do not depend on browser Google OAuth or the existing Firebase-backed optional export helper. Never make uploads public or grant anyone-with-link access. App-authorized reads return bytes through Apps Script; Drive links are optional conveniences for users who already have Drive permission. [Google File reference](https://developers.google.com/apps-script/reference/drive/file)

Accept JPEG, PNG, WebP, and PDF. Set an application limit of **5 MiB per uploaded file**, at most ten files per selection batch, and one transfer at a time. These are product limits, not claims about a Google inbound request limit. Normalize supported photos to JPEG at a maximum 2000-pixel long edge and target at most 2 MiB; preserve portrait orientation. A photo is an annotated supporting copy, not a forensic original. Reject unsupported HEIC clearly and preserve the unsent note. PDF bytes remain unchanged. Verify type signatures, decoded size, hash, and safe filename on the server.

Uploads must be restart safe: reserve an attachment ID plus a pre-generated Drive file ID, persist both before uploading bytes, and create the file with that exact Drive ID through the Advanced Drive service. A retry after Drive creation but before metadata acknowledgment retrieves and verifies that file instead of creating another. An already-existing Drive ID is reconciled as an unknown earlier success, not replaced; mismatched bytes are rejected. Store only file metadata and a byte hash in the mutation journal; base64 bytes never enter a spreadsheet cell. Do not hold long-lived locks during byte transfer; use a short lock to finalize. Recheck the job's live state before publishing ready metadata. Keep originals in IndexedDB until a ready acknowledgment. Revoke preview object URLs and evict only acknowledged cached blobs automatically. This follows Google's supported retry behavior for pre-generated IDs. [Google Drive file creation reference](https://developers.google.com/workspace/drive/api/guides/create-file#generate-ids-to-use-with-your-files)

Soft-delete attachment metadata when removed; do not trash a file referenced by an immutable artifact. Bound downloads and packet assembly to 25 MiB of selected source files per export; show a selection/size message before generation. Exceeding this requires splitting the export, not silent omission. Check decoded sizes rather than base64 text length. Surface storage/quota errors while retaining queued work. [Google Apps Script quota guidance](https://developers.google.com/apps-script/guides/services/quotas)

Generated summary PDFs and appendices also obey the 5 MiB persisted-file limit; split a large photo appendix into numbered files. Store the immutable manifest and constituent outputs, then assemble the ZIP for download on demand. Do not upload a potentially larger ZIP through the attachment endpoint. Before publication, enable the Advanced Drive service and its required deployment scope, and verify those permissions against the test Drive root.

## 3. User behavior and acceptance criteria

### A. Job progress and reminders

- Add a compact stage/next-action card to the current job and job-library rows. Keep missing-information warnings separate from workflow stage. Existing legacy status remains readable; new workflow summaries are authoritative for the new UI.
- On first open, derive a default stage from legacy status: Draft -> intake, Active -> in_production, On Hold -> on_hold, Complete -> complete, Cancelled -> cancelled; unknown -> intake. Persist only on the first explicit workflow change.
- Keep stage selection manual. Going on hold requires a short reason. Completing/cancelling suppresses ordinary due reminders; reopening restores them. Stage changes record history, never imply carrier approval or receipt of money.
- Home shows at most five needs-attention jobs, then View all. Use one filter control for All/Mine/Overdue/Waiting; Mine matches a responsible-person email to the current account. Due today is not overdue; overdue starts on the following local calendar date.
- Reminders derive from the next action, selection needed-by dates, and open punch items. Do not add recurring tasks, background email, push permissions, or a new Tasks navigation destination.
- Refresh visible shared metadata on job open, manual refresh, window focus, and every 60 seconds while visible/online. Stop background polling when hidden/offline; show cached status and last successful refresh.

Acceptance: another signed-in editor sees a synced stage/action change after refresh; offline changes survive reload; an overdue date behaves correctly across midnight and daylight-saving changes; completing the action removes its reminder.

### B. Quick job updates and communication drafts

- Add Updates inside Production: one short-note input, optional photos/PDFs, and Post update. Persist text immediately; attachments show separate queued/uploading/ready/error states. Text remains visible if upload fails.
- Show the latest 20 activity entries initially and Load more. Include author, event date, edited indicator, and attachments. Prevent double-submit with the durable mutation ID. System history includes stage/action/decision/change/handoff/closeout events, not every keystroke.
- Permit the author or an admin to correct a manual note, preserving the prior text in mutation history. Other editors can add a correction note; nobody can edit generated system entries.
- Draft customer update builds editable text from explicitly selected manual updates and current next action. Exclude internal notes, financial details, access codes, hazards, and other attachments unless selected deliberately. Staff review and copy; no send button or automatic delivery.
- Use native keyboard dictation where available; do not add a custom SpeechRecognition dependency for this initiative.

Acceptance: one note plus two files recovers after offline reload; repeated upload/post attempts do not duplicate records; copying a draft does not modify the job or contact anyone.

### C. Production handoff

- Extend the existing checklist/Production area with a Handoff summary. Derive customer/property, claim contact, team, scope, financial summary, site access, schedule, safety, outstanding selections, and open changes from saved data.
- Add only missing operational confirmations: contract recorded signed, approved scope reviewed, initial-payment status recorded/not applicable, and mortgage prerequisite reviewed/not applicable. Reuse existing deductible/mortgage fields as context; do not treat them as proof of payment or authorization.
- Readiness is a transparent list with links back to fields. For self-pay jobs, carrier and claim number are not blockers. New required-field rules must be shared with document warnings and distinguish errors from warnings.
- Allow a draft handoff with visible missing-item labels. Mark ready requires no blockers, or a recorded override reason. Overrides and readiness events appear in history and on the handoff.
- Preview/export a branded handoff PDF with explicit internal-use labeling. It can contain site access/safety information and must be excluded from customer and carrier closeout presets.
- Freeze the exact source data and revisions when publishing the handoff. Store snapshot JSON in Drive and a manifest/artifact record in Sheets. Later edits show Handoff needs review without changing the old file; publishing creates a new version. Final publishing requires sync; offline draft preview/download is allowed and labeled draft.

Acceptance: changing access instructions updates the live summary but leaves a published handoff unchanged; missing RCV is clearly shown rather than converted to zero; approved overrides are attributed.

### D. Selections and decisions

- Add an optional Selections section inside Production. The default empty state is a single Add selection action; do not display a large empty form.
- Capture room, item, specification, optional allowance, needed-by date, responsible person, evidence, and recorded decision. Display pending/approved/changes requested; show overdue only for an unfinished decision with an elapsed needed-by date.
- Recording approval requires an approver name and date. Label it Recorded approval. This does not create a signature, charge, or coverage decision.
- Editing an approved specification or allowance resets its decision to pending and records the previous approved version. A decision-only note correction does not change the specification.
- Selecting Create change from selection prepopulates scope and links the selection. It does not infer an overage or add a charge; the editor enters and reviews the amount.

Acceptance: selections are optional on a job; two different selections sync independently; changing an approved finish requires renewed review; allowances remain blank when unknown.

### E. Multiple changes and supplements

- Replace the single-change editing experience with a register inside the existing Change Order section. Users can create, reopen drafts, view prior documents, and record decisions without overwriting a previous change.
- Keep customer decision and carrier decision separate: pending/approved/rejected, with name/date/note/evidence; carrier also permits not_applicable for non-insurance work. Submission is not approval. A carrier approval never authorizes customer contract changes automatically.
- Initialize a legacy register entry only when legacy change fields contain meaningful user content; default date/number alone does not qualify. Use a deterministic `legacy:<jobId>` ID and mark its approval unknown/pending. Preserve all old values and its original PDF data. Never invent past approvals or renumber migrated documents.
- Freeze the contract base and any brought-forward previous changes before the first new finalized change. Suggest existing originalContractSum, otherwise existing contract RCV; require explicit review rather than treating insurance RCV as an automatically updated contract. Display baseline and adjustments separately.
- Revised contract total is base + brought-forward changes + non-void customer-authorized signed change amounts, counted once. Carrier-approved totals are a separate figure. Include zero-dollar time changes; do not roll pending or rejected requests into the authorized total. Do not rewrite the current payment schedule automatically.
- Preserve the original change-order PDF layout through an adapter: originalContractSum = reviewed base, netPreviousChanges = brought-forward changes plus prior authorized changes, changeAmount/changeType = selected signed amount, plus the selected scope/date/added days. Keep the legacy data field as a compatibility snapshot rather than a second editable source.
- Number drafts with stable IDs and assign new display numbers sequentially on server finalization. Recover pending finalization intents for the job under the script lock before allocating a number; reserve the selected number in that durable intent. Two offline drafts cannot claim the same final number. Finalization freezes a source snapshot and PDF; edits afterward create an amendment/new change and link the predecessor. No silent edits to signed/issued documents.

Acceptance: multiple increases/credits produce exact-cent totals; two offline drafts receive unique finalized numbers; authorization does not double-count brought-forward changes; old change PDFs remain reproducible after later edits.

### F. Closeout packet

- Add Closeout within Production and export actions within Documents. Default checklist items: work completion recorded, punch items resolved, completion/acceptance evidence recorded, final invoice evidence attached or marked unavailable with a note, completion photos reviewed, and depreciation submission status recorded/not applicable.
- Each item has pending/done/not_applicable plus evidence/note. Not-applicable requires a reason. Record completion date and small open/done punch list. A checklist acknowledgment is not a payment ledger or a claim that a carrier accepted the submission.
- Offer three explicit export presets: Internal closeout, Customer closeout, and Carrier/depreciation support. Start from the appropriate completion summary and ready evidence; users preview the exact file manifest before export. Exclude mortgage authorization, SSN fragments, lockbox/access details, internal commentary, and unrelated financial data from customer/carrier summaries and default selections.
- Closeout summaries use an explicit allowlist of fields, not the complete job JSON. Staff must review uploaded attachments for their intended audience. Never automatically include the full nine-page production packet. Internal source snapshot JSON stays in private artifact storage and is never included in customer/carrier ZIPs.
- Generate a branded completion summary PDF and ZIP containing selected ready files and a manifest. Embed selected images with captions in a photo appendix; retain supplied PDFs as separate ZIP files. Skip nothing silently. Show unresolved checklist items and unavailable files in draft preview; final export requires resolution or a recorded override plus all selected files available.
- Publish immutable source snapshots/manifests just like handoff. Mark complete is a separate explicit action and must not imply all money was collected. Surface unresolved punch items before marking complete, permitting only a recorded override.

Acceptance: staff can produce a useful closeout from an existing job; downloaded ZIP contains exactly the reviewed files; private fields are absent from external summaries; offline missing files produce a clear blocking explanation without losing choices.

### Shared UI rules

Use the current design tokens, Hays branding, form patterns, and light/dark appearance. Add no sixth main destination. Production gains compact internal sections for Updates, Handoff, Selections, Changes, and Closeout while retaining existing Team/Notes/Checklist access. At narrow widths use a compact section selector instead of another full row of crowded tabs. Lazy-load file previews/PDF helpers and fetch only supporting metadata for the active job/section.

All actions must work at a 390-pixel viewport, with no horizontal page scrolling. Target controls at least 44 pixels where touched, visible focus, associated labels, accessible dialogs, and text alongside state colors. State changes announce through a polite live region. Save language distinguishes Saved on this device, Waiting to sync, Synced, and Needs review. Avoid a generic success toast while attachments or changes are still queued.

## 4. Migration, delivery stages, and verification

### Migration and compatibility

1. Back up the spreadsheet before a production migration. Use a separate test spreadsheet/Drive folder for local and live smoke tests; no fabricated jobs in production.
2. Bump the job schema to 2 and add defaults without changing original values. Treat existing server rows as revision 1, new unsaved records as revision 0. Apply migrations idempotently, including legacy change import and draft isolation. Do not discard unknown legacy fields.
3. Provision new tabs/columns and Drive root configuration without deleting sheets, jobs, original drafts, users, sessions, or attachments. Run migration twice in tests and demonstrate no duplicates.
4. Ship capabilities in the backend before the new frontend. New UI requires the necessary feature capabilities and preserves local work when the backend is stale.
5. Coordinate activation of revision enforcement with the frontend/PWA update. Before activation, the compatibility phase retains existing behavior; do not claim concurrent-write protection during that window. Once activated, all legacy job/delete/shared-draft writes lacking protocol/revision data fail `client_upgrade_required` rather than overwrite protected data. New scoped drafts remain supported. Old clients must update; never silently downgrade the write protocol.
6. Roll back to a feature-disabled frontend that retains the new save protocol; keep additive backend tabs and revision enforcement. Do not restore an old unrestricted writer over new data. Preserve pending queues throughout rollback.

### Delivery stages

- **Foundation checkpoint:** safe core writes, scoped drafts, idempotent supporting records, and offline upgrade verified before adding shared workflow UI.
- **Release 1:** progress, quick updates, attachments, and production handoff. This is the first useful team release.
- **Release 2:** selections and change register, including legacy migration and exact-cent financial behavior.
- **Release 3:** audience-reviewed closeout packets and completion workflow.

Use deployment feature flags for each stage. Disabled sections do not appear, but stored records remain readable/exportable by the compatible client. Do not add an in-app experimental settings panel. Review each checkpoint against the tests below and record evidence in the task checklist.

### Test commands and baseline

Before implementation, run and record these commands independently; inspect every result. A failed legacy harness must be recorded with its error, not assumed to be a new regression or hidden by deleting tests:

```powershell
npm run lint
npm run database:test
npm run apps:ascii
npm run apps:test:drafts
npm run apps:test
npm run apps:register
npm run parser:test
npm run intake:test
npm run save:ui:test
npm run build
```

The README currently documents legacy helper/API drift in apps:test and apps:register. Verify that baseline in this checkout; add current-contract harnesses for new behavior without reviving obsolete backend functions. Do not claim `npm run verify` is green unless it actually completes. `apps:paste` regenerates a deploy artifact; run it after backend changes, separately from test commands.

Add focused scripts using the existing tsx/node:test, fake-indexeddb, Apps Script VM mocks, and Playwright tools:

- `workflow:test`: domain models, defaults/migrations, due-date behavior, decisions, calculations, snapshot stability, and API client validation.
- `apps:test:workflow`: routing/roles, revision enforcement, journal recovery, pagination, upload reconciliation, and stale-client handling.
- `workflow:ui:test`: Playwright workflows on desktop and 390-pixel mobile. Two isolated browser contexts must exercise shared edits/conflicts; mocked API tests do not substitute for later live smoke tests.

Required adversarial cases:

| Area | Cases that must pass |
| --- | --- |
| Migration | Old jobs retain IDs/values; pending v1 outbox survives; legacy CO imports once; shared draft preserved as recovery; second migration is a no-op |
| Concurrency | Different updates both survive; same-item stale revision is held; stale core save/delete rejected; late server responses never replace newer local edits |
| Retry recovery | Response lost after committed row; crash between journal/row/ack; same key different payload rejected; retry remains safe after a later mutation |
| Ownership | Account switch cannot flush or reveal another account's unsynced drafts/blobs; viewers cannot mutate through any direct endpoint |
| Files | Unsupported type, oversize, hash mismatch, wrong-job file ID, quota failure, interrupted Drive creation, upload-after-job-deletion, removal while referenced |
| Money | Empty versus zero; increases/credits; zero-dollar days; brought-forward changes counted once; customer/carrier decisions independent; frozen totals do not drift |
| Export | Long fields/notes, portrait photos, multiple pages, no clipping, exact manifest, external field allowlist, missing offline files, source-size limit |
| Existing app | Intake review, financial entry, original PDFs, autosave recovery, save/sync, role behavior, themes, and navigation continue working |

Generate original and new PDFs using representative fixtures and worst-case long content. Run the existing PDF sample/span/audit tooling where applicable, render the new outputs with Poppler, and visually inspect every page. Verify original forms retain their approved layout. A successful generation call alone is not visual validation.

For releases 1-3, use the built production PWA for offline/update testing and a real phone for camera/file picking and mobile export. Check the Windows/Electron save dialog path for new generated files. Explicitly identify anything not device-tested.

### Rollout, diagnostics, and done criteria

Deploy a new version of the existing Apps Script deployment first, keeping its `/exec` URL. Then deploy the compatible frontend preview; verify signed-in writes and file round trips against the test backend before production. A GitHub push or generated paste file is not an Apps Script deployment. Production deployment is separate from completing local implementation and must be reported exactly.

Extend existing diagnostics with mutation ID, action, safe entity identifiers, error code, duration, and retry state. Keep note bodies, credentials, file bytes, SSN fragments, and access instructions out of logs. Record authoritative who/when events server-side. Provide pending/conflict/upload counts in the existing sync area; do not create another dashboard.

Final acceptance requires all six capabilities, all focused checks passing, regression results documented, visual PDF review completed, and live two-user save/upload/export checks reported. Report local, preview, backend-deployed, production-deployed, and real-device-tested states separately. If an external deployment is unavailable, finish the locally testable work and clearly list the remaining operational step; do not claim it was verified.

## 5. Instructions for the implementing AI

Read this plan and `tasks/todo.md` first. Recheck repository rules, dirty files, and current contracts before editing. Use the existing stack and small service/component boundaries; do not expand App.tsx into a monolithic implementation. Extract typed workflow services and selectors without unrelated refactoring.

Work through the ordered checklist. For each task: implement its smallest complete behavior, run the named focused checks, record evidence, and update only its completed checkboxes. Preserve all unrelated user changes. Do not weaken tests, remove assertions, or suppress type errors to get a green result. Do not add sample data to the runtime app. Do not send customer or staff communications.

When a genuine blocker changes the contract, describe the concrete evidence and propose the smallest adjustment. Otherwise follow the defaults here without repeatedly asking for confirmation. Completion of the first release is a checkpoint, not permission to omit releases 2 and 3.
