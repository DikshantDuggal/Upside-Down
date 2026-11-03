# Frontend verification — 4 November 2026

Scope: `web/` dashboard foundation on branch `4-frontend-dashboard`, based on fresh `origin/main` at `19130abfcece0ad5f709d7fd34a3c2c81ada88f1`. Contract file SHA-256: `377ab00964ce777a40816a1debd9f666c3873f9ffad44f33ee0557960a88bd60` (UD-IC/1.0). Runtime and validation code use the declared wire formats without editing shared contracts.

Environment: Windows NT 10.0.26300.0, Node v24.21.0, npm 11.19.0. Chromium installed by Playwright 1.64.1. Frontend dependencies are exact versions in `package-lock.json`.

## Actual checks

| Check                                                                             | Result                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm --prefix web test`                                                           | Exit 0; **35 tests passed**, 6 files                        |
| `npm --prefix web run build`                                                      | Exit 0; TypeScript and Vite production build passed         |
| `npm --prefix web run test:e2e` with `UD_REAL_BACKEND=1` and `UD_REAL_LOCAL_ROOT` | Exit 0; **8 Chromium tests passed**                         |
| npm dependency audit during lockfile finalization                                 | **0 known vulnerabilities**                                 |
| Preview `GET http://127.0.0.1:5173/`                                              | HTTP 200                                                    |
| Real proxied `/api/health`                                                        | HTTP 200; legacy protocol 1.0                               |
| Existing backend `npm test`                                                       | Exit 0; **6 coordinator + 5 agent-engine scenarios passed** |
| Existing backend `npm run typecheck`                                              | Exit 0                                                      |

The initial older test-runner dependency was replaced with its patched release after audit findings. The final lockfile audit is clean. Rollup reports two third-party Zod comment-annotation warnings; these do not prevent the build. No application warnings/errors were suppressed to make checks pass.

The backend was copied unchanged from `ec73ff7b1fcc16645484709ea92c51d9dfc46068` into ignored `.board/backend-smoke/`, with dependencies installed without a lockfile or install scripts. Its own disposable database was used. Frontend source, root source, shared contracts, and another teammate's checkout were not modified by backend validation. The sandbox initially blocked the backend test's localhost connection with EACCES; the unchanged suite passed with approved localhost access.

The real backend browser smoke test reads health/tasks and verifies the dashboard receives the named SSE connection. It performs no backend mutation and does not claim a repair run or patch application occurred. The screenshot is an actual empty backend workspace, not seeded production activity.

After A published shared baseline `4db4c561caacd867c67a33d5cacb9c5494f8a774`, the same real REST/SSE browser smoke check was also rerun against that unchanged baseline and passed (exit 0). The 11 backend regression scenarios above were run on `ec73ff7`; the newer A-only tests were not rerun by this frontend task.

A second real integration test uses unchanged Backend B `ba17a47` in ignored `.board/local-smoke/`. It starts B queue-only on port 4100 with a new disposable SQLite database, pairs through the UI, submits an actual task command, verifies one queued receipt, terminates/restarts B, pairs again and confirms the same device ID/event ID/sequence and exactly one pending command. It stops its own processes. No coordinator token, gateway, or external service is involved. Browser traces are disabled for this test and credentials are absent from command storage.

## What fixture tests establish

Unit/component tests exercise runtime formats, HTML/non-JSON errors, version/freshness headers, message byte limits, session gating, idempotent retry records through reload and expired authorization, storage failure, receipt reconciliation, transition acknowledgement plus revision refresh, SSE named events/dedup/reset/cleanup, task filtering, safe diff escaping, structured test evidence, and independent connectivity states.

Six browser tests use explicitly labeled test-only HTTP fixtures. They cover UI navigation, task filtering, native dialogs, escaping script-like diff text, reviewer gating, lost-response retries using identical keys/payloads after reload, unavailable local services, guarded conflict resolution on HTTP 409 without automatic resubmission, 390px layout/focus restoration, and automated WCAG A/AA checks on the overview and create-task dialog. Fixtures never enter production source.

Browser testing found and fixed a scrolling-table containment issue, modal initial/return focus, insufficient secondary-text contrast, and sidebar overflow on short screens. These are verified fixes, not a claim of exhaustive accessibility certification.

## Remaining integration evidence

Full MVP acceptance is **not claimed**. Local/browser restart with a pending command has passed against real B. Required future evidence includes two-device delivery through A's gateway, lost coordinator ACK deduplication, internet disconnected while LAN remains active, real authorized conflict resolution, and actual verified Git application/test evidence.

Arhaan proposed additive `GET/POST /local/session` routes in `6613877596`; A accepted in `6614132100`, frontend in `6614135924`, and B confirmed exact response/Host rules in `6614142386`/`6614227630`. The approved handshake is now implemented and jointly exercised against the real B service. Reviewer authority remains separate and unavailable pending its A/B implementation; local pairing never elevates device authority.

Repository issue #4 tracks the dashboard foundation and agreed pairing integration. Issue #7 tracks remaining production gateway, reviewer-authority, two-device, and verified-application acceptance. See `README.md` for actual start/build/test commands and boundary details.
