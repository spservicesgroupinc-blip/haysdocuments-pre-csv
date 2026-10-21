# Hays + Sons — Restoration Document Suite

Single-entry document automation for Hays + Sons Complete Restoration: capture a job once,
then generate the contract, reports and production packet as PDFs. Runs as a web app
(installable PWA) and as a Windows desktop app (Electron). Works **offline-first**: jobs are
cached on the device and changes sync to the Google Apps Script database automatically.

## Prerequisites

- Node.js 20+ and npm
- The Apps Script backend deployed (see `apps-script/README.md`)

## Environment

Copy `.env.example` to `.env.local` and set:

| Key | Purpose |
| --- | --- |
| `VITE_APPS_SCRIPT_URL` | Deployed Apps Script `/exec` URL (the job database) |
| `VITE_GOOGLE_CLIENT_ID` | OAuth client for Google Drive/Sheets features (web only) |
| `VITE_DEV_SHARED_SECRET` | **Local development only** — disables auth. Never ship a build with this set. |
| `VITE_DEEPSEEK_API_KEY` | Optional override for the built-in DeepSeek key used in AI intake analysis |

Vite inlines `VITE_*` values at build time — restart `npm run dev` (or rebuild) after changes.

If saving reports a non-JSON response, check the configured `/exec` URL first. The client
normalizes copied links and Google account-specific URLs to the public deployment URL.
Google sign-in pages, unavailable deployments and invalid responses produce separate
instructions; failed writes stay queued on the device. After correcting the URL, rebuild
the app, reload it (apply any pending app update), and select **Sync now**.
Run `npm run database:test` to verify the save transport and response handling.

Saving commits the job and its pending cloud write in one IndexedDB transaction. The
Save button finishes after that device commit; cloud sync runs in the background.
The status badge distinguishes a draft being saved, a device copy awaiting sync, and
a completed draft sync. Temporary connection and database-busy errors retry with
increasing delays; session and deployment errors stay queued until corrected.

Drafts persist after 350 ms of idle time, together with a coalesced backup operation
owned by the signed-in account. Cloud autosave waits for 2 seconds of idle time, with
an 8-second maximum wait while typing. Startup recovery happens before autosave can
write the empty form. Responses from earlier saves and reads cannot replace newer
device edits. Hiding the window, signing out, and applying an update flush device
autosave; closing with an incomplete device save prompts you to keep the window open.

After updating the backend, deploy `src/apps-script/Code.gs` as a **new version of the
existing deployment**, keeping its `/exec` URL. `npm run apps:paste` and
`npm run apps:chunks` regenerate the editor paste files from this source.

## Commands

Choose **Account → Appearance → Light / Dark** to change the app theme. The sign-in
screen also offers the same choice. The preference is saved on this device and restored
before the app renders; a first visit follows the device's appearance setting. Document
previews and exported PDFs retain their white paper background.

Intake runs built-in extraction immediately and DeepSeek independently in the background.
Either method can succeed when the other fails. Local results remain editable and saveable
while AI runs; AI fills missing fields and offers differing values with **Keep current**
and **Use AI** controls. Existing values and edits made during analysis are preserved for
review. Accepting a financial value recalculates the payment figures.

Each AI run has a 60-second total deadline, including its transient retry. **Retry AI**
reuses the last analyzed text without rerunning local extraction. A newer intake, job
switch, or reset cancels obsolete work. Review choices last for the current intake session;
accepted values use the normal job save flow. Image-only PDFs still require selectable
text or separately obtained OCR text.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build into `dist/` (web app + service worker + manifest) |
| `npm run preview` | Serve the production build locally (use this to test PWA/offline behaviour) |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm run intake:test` | Independent extraction, merging, conflicts, cancellation, and deadline regressions |
| `npm run database:test` | Save/sync/transport regressions, including real IndexedDB transactions |
| `npm run apps:test:drafts` | Current backend draft/job write locks, round trips and session heartbeat checks |
| `npm run save:ui:test` | Chromium tests for recovery, saving while editing and connection failures (run `npx playwright install chromium` once) |
| `npm run verify` | Full gate: lint + backend tests + parser tests + build |
| `npm run icons` | Regenerate all app icons from `public/logo.svg` |
| `npm run deploy:web` | Build + deploy the PWA to Vercel (linked project) |
| `npm run apps:test`, `npm run apps:register`, `npm run parser:test` | Backend / parser test suites |

## PWA (browser install)

The production build ships a web app manifest and service worker (`src/sw.ts`) that precache
the shell — including the pdf.js worker — so the app opens and generates documents offline.
Database reads come from an IndexedDB mirror; writes queue in an outbox and replay when the
connection returns. Revision conflicts retain both copies for explicit review.

- Test locally: `npm run build && npm run preview`, then DevTools → Application (manifest,
  service worker, cache) and Network → Offline.
- The service worker is **production-only**; `npm run dev` intentionally does not register it.

### Deploy to Vercel

1. One-time: `npx vercel link` (create/select the project for this repo).
2. Deploy: `npm run deploy:web` (builds locally via `vercel build --prebuilt`, so your
   `.env.local` values are baked in — no Vercel dashboard env setup required).
3. In Google Cloud Console → APIs & Services → Credentials → your OAuth web client, add the
   deployed origin (e.g. `https://your-app.vercel.app`) to **Authorized JavaScript origins**
   so Google Drive/Sheets sign-in works on the deployed site.

## Desktop app (Windows)

| Command | What it does |
| --- | --- |
| `npm run desktop:dev` | Bundles the Electron main process and launches the app (prefers the dev server on :3000 when running, otherwise loads the built `dist/`) |
| `npm run desktop:build` | Builds the web app + bundles Electron, then produces the NSIS installer in `dist_desktop/` |
| `npm run desktop:release` | `desktop:build` + copies installer/`latest.yml` into `release/` for the update feed |

- Installer: `dist_desktop/Hays-Sons-Document-Suite-Setup-<version>.exe` (per-user install, no admin needed).
- Auto-update: packaged builds check the static feed configured in `electron-builder.yml`
  (`publish.url`). The installer is ~130 MB, which exceeds Vercel's ~100 MB per-file limit —
  host the `release/` folder where there is no such cap (GitHub Releases, Cloudflare R2, S3,
  or any static server) and set `publish.url` to that location before cutting a release.
- The installer is **not code-signed** — first install shows a SmartScreen warning
  ("More info" → "Run anyway"). Updates work regardless.
- Google Drive/Sheets buttons are **browser-only**: Google blocks OAuth popups inside
  embedded browsers, so the desktop app disables them (tooltip explains).
- PDF/ZIP downloads open a native "Save as" dialog; printing opens in an app window.

## Offline behaviour (both platforms)

- The saved-jobs list paints instantly from the local mirror, then refreshes from the server.
- Saves/deletes made offline are queued (amber "PENDING SYNC" badge); the status card in the
  bottom-right shows the queue, a "Sync now" button, and reconnect notices.
- The current workspace record autosaves locally (debounced), so a reload/crash never loses
  in-progress work.
- If someone else changed the same record, the device copy stays queued. Compare both versions
  and explicitly choose the shared copy or save the reviewed device copy at the current revision.

## Known issues

- The legacy backend and registration harnesses have been migrated to the current API contracts.
  `apps:test`, `apps:register`, and the dedicated workflow harness now pass locally.
- `npm run clean` references a `server.js` that has never existed (template leftover).


## Shared restoration workspace

The six workflow capabilities are job progress/next action, dated updates and supporting files,
production handoff, selections with recorded decisions, multiple changes, and reviewed closeout.
Home, Job details, Changes, Production, and Documents are the five main destinations.
On phones these stay in a bottom navigation bar; desktop shows the same destinations
across the top with section tabs. Intake is inside Job details. Switch job returns to
the searchable saved-job library. Each page shows only its own tools.

Changes opens a short form for the scope and price, with optional calendar days and
insurance details. Review the job, scope, and amount before submitting. Unfinished
quick forms recover on the same browser, scoped to the signed-in account and job.
Saved drafts and submissions use the existing offline queue; submission receives a
server number after sync. It does not send an email or establish customer approval.
The full change editor, decisions, attachments, issuing, and contract baseline remain
available on desktop and mobile. An older backend retains the legacy PDF form.

Supporting records and private files use Apps Script, Sheets, and Drive. `JobItems` holds typed
revisioned records; `JobMutations` journals stable mutation IDs for replay after unknown outcomes.
Core saves also send protocol version 2 and expected revisions. No conflict silently overwrites
another editor. The comparison keeps the device copy until the user resolves it.

Draft backups are scoped to account/device/job. The old shared cloud draft is read-only recovery:
Home ? Recover an older shared workspace ? preview ? explicitly restore. Existing device work
is saved before switching to a recovery copy. Pending notes, file blobs, conflicts, and complete
publication dependency chains survive reloads. Photo copies are normalized, HEIC is rejected,
and notes remain saved if file preparation fails. Photos/PDFs have preview, download, and caption
controls. Sync now retries both core and supporting work; counts appear in the existing sync area.

Reviewed handoff/change/closeout versions store immutable source JSON and constituent outputs.
Issued changes download their saved PDF; amendments receive a new record. External closeout
ZIPs use field allowlists and reviewed file manifests, never the private source JSON. Record
completion separately from export. Recorded approvals are decisions, not electronic signatures.

`VITE_WORKFLOW_RELEASE` controls authoring stages: 0 hides workflow authoring, 1 enables
progress/updates/handoff, 2 adds selections/changes, and 3 adds closeout (default). Keep the
revision protocol during rollback; published files remain in Documents. There is no in-app
experimental settings panel. Capabilities still gate sections when the backend is older.

| Verification | Command |
| --- | --- |
| Domain, migration, offline queue, exports | `npm run workflow:test` |
| Backend recovery, roles, files, numbering | `npm run apps:test:workflow` |
| Built desktop/mobile workflow UI | `npm run build`, then `npm run workflow:ui:test` |
| Built service worker, offline reload, update | `npm run build`, then `npm run pwa:ui:test` |
| Original save/intake/theme regressions | `npm run save:ui:test` |

See [verification and deployment status](tasks/verification.md) and
[workflow rollout instructions](tasks/rollout.md). A passing ping does not prove signed-in
writes, capability support, or that the local Code.gs was deployed.
