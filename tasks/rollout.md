# Workflow rollout and rollback

The frontend preview is Ready. Production rollout remains separate from local implementation.

1. Open the Apps Script editor project corresponding to the supplied /exec URL. The /exec URL is
   a runtime endpoint and cannot be used to upload source code. An editor URL/project ID plus an
   authenticated deployment connection is needed for automated updates.
2. Back up the spreadsheet and use a separate test spreadsheet/private Drive root for live checks.
   Preserve all existing Jobs, Drafts, users, sessions and custom columns.
3. Paste `src/apps-script/PASTE-INTO-APPS-SCRIPT.txt` into Code.gs, replacing the complete file.
   It contains 2234 ASCII lines and is byte-identical to `src/apps-script/Code.gs`.
   Copy the supplied appsscript.json separately; it enables Advanced Drive v3 and required scopes.
4. Run existing provisioning idempotently. Set WORKFLOW_DRIVE_ROOT_ID to a private test folder.
   The backend provisions additive JobItems, JobMutations and scoped-draft storage on demand.
5. Publish a new version of the existing Apps Script deployment, retaining its /exec URL.
6. Sign into the preview with test editors and confirm capabilities, separate concurrent updates,
   stale core/item conflicts, private file upload/download and frozen document outputs. Never use
   production customer records for fabricated smoke tests.
7. Coordinate client/PWA updates before setting WORKFLOW_ENFORCE_REVISIONS=true. Before that
   activation, compatibility does not guarantee protection from old clients. After activation,
   legacy writes without protocol/revision data return client_upgrade_required.
8. Promote the frontend only after live acceptance. Do not call a source push or generated paste
   file an Apps Script deployment.

VITE_WORKFLOW_RELEASE is a build-time gate: 0 hides authoring, 1 progress/updates/handoff,
2 selections/changes, 3 closeout (default). Roll back using the compatible client with release 0;
keep additive backend sheets, revision enforcement, pending queues and published document access.
Do not redeploy an old unrestricted writer over revisioned data. Re-enable stages incrementally.

Diagnostics expose account-owned pending/conflict/upload counts in the existing sync area.
Keep credentials, notes, access information and file bytes out of logs and support messages.
