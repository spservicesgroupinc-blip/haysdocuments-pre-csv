# Verification and delivery status

Updated October 21, 2026. Further testing stopped at the user's request to conserve usage.

## Ready to try

- Hosted preview: https://haysdocuments-pre-a1xuo2kdm-rfe-foams-projects.vercel.app
- Vercel reports deployment dpl_F7zi4oW1k2kVtpRamqXsWYz6QjDP **Ready**, target **preview**.
- Local production preview remains running at http://localhost:3000/.
- Both use the Apps Script endpoint supplied October 21, ending `Z8iFr/exec`.
- No production frontend promotion or Git push was performed by this agent.

## Completed local evidence

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Database transport and durable saves | 24 passed |
| Workflow domain, v1 device upgrade, queue and exports | 32 passed |
| Backend workflow, journal recovery, permissions, files and numbering | 32 passed |
| Current backend contracts | 4 passed |
| Registration/authentication | 6 passed |
| Backend draft suite | Passed |
| Intake coordinator | 13 passed |
| Intake parser | Passed |
| Original save/intake/navigation/theme browser suite | 30 passed |
| Built workflow browser suite | 9 passed |
| Production PWA cache/offline/update/iPhone-guidance suite | 3 passed |
| Original PDF samples | 36 of 36 generated; layout audit 0 findings |
| Original PDF field spans | 24 checks, 0 failures |
| Workflow PDF fixtures | 16 tests passed; Poppler rendered; every workflow page and original water packet visually reviewed |
| Production web build | Passed; existing pdfjs eval and large-bundle warnings remain |
| Electron bundle | Built; native download smoke test remains unresolved and was stopped |
| Backend paste artifact | Regenerated; 2234 ASCII lines, byte-identical to Code.gs |

Workflow browser coverage includes two editors refreshing progress, same-item conflict review,
notes surviving offline reload, selection approval reset, mobile dark/light keyboard controls,
recovery from a lost file-upload acknowledgment without duplicates, viewer restrictions, and
final closeout ZIP/manifest equality with separate explicit completion. Those APIs are mocked;
they are not evidence of live signed-in Sheets/Drive round trips.

The first baseline legacy backend/registration harnesses failed because they referenced removed
helpers. They were migrated to current supported routes; replacement checks now pass. Initial
workflow browser failures identified inaccessible labels, missing cached capabilities after an
offline reload, and files queued during an in-flight flush waiting for another poll. Those issues
were fixed and the final nine-case workflow run passed. A later change additionally included all
prior change revisions and payloads in frozen change-order source snapshots; the production build
passed afterward. No further tests were run after the user's stop request.

## External verification still required

The supplied /exec responds to ping. An unauthenticated getCapabilities request is correctly
rejected with unauthorized. This does not establish that the current local backend was deployed.
There is no authenticated gws/clasp connection or Apps Script editor/project link available here.
Do not claim deployment of Code.gs, revision-protection activation, or live two-user/private-Drive
round trips. Do not add fabricated jobs to production for smoke tests.

Physical iPhone installation/camera/export, real-device standalone behavior, and an actual native
Electron Save As round trip are not verified. Browser/PWA emulation is reported separately.

Try progress, updates with a supporting PDF/photo, selections, changes, handoff, and closeout.
If the workflow sections do not appear after signing in, the backend capability deployment is the
next operational step; see rollout.md. Further checks should target user-reported problems.
