# Website runtime fixes — 4 November 2026

Issue #11, based on integrated main `a0b0cefdc9cecb5f211ead135a53a2c3b0773a69`.
The human authorized frontend fixes, and the frontend owner explicitly handed off
the narrow reviewer-session/message-recovery work on board comment `6616106528`.
No Backend A source, contracts, existing `data/` files, prototype branches or
integration recovery tags were changed.

## Reproduced and fixed

1. Configuring a valid separate reviewer credential never enabled frontend review
   controls. B now provides paired `GET /local/authorization`, verifies A's live
   capability with the separate credential, and grants only explicit UD-IC/1.0
   reviewer/admin authority. Missing, revoked, malformed and unreachable authority
   returns false. Frontend starts unprivileged, rechecks on focus/every 30 seconds,
   clears failed grants, and prevents late responses from restoring expired sessions.
   GET/POST `/local/session` retains its original exact response.
2. After an explicit local rejection, the message composer stayed disabled even
   after correcting the text. It now allows correction when the response proves
   that this first attempt was never queued. Ambiguous/network/server failures
   remain blocked with instructions to retry the saved original key. Regression
   checks cover both outcomes.
3. Application/run events can identify a patch inside `payload.application.patchId`
   or `payload.run.patchId`. B previously considered only a top-level patch ID.
   Hydration now refreshes those nested references once per patch per page and
   invalidates the older cached detail inside the same pull transaction. This
   prevents stale application states from persisting in the device cache.

The reviewer endpoint and message-correction regressions failed before their
fixes (HTTP 404 and a permanently disabled button respectively). The nested-patch
regression also failed before its fix with zero hydrated snapshots.

## Actual checks

Windows, Node v24.22.0, npm 11.19.1. These checks passed:

| Check | Result |
| --- | --- |
| Root and client-local TypeScript checks | Passed |
| Frontend TypeScript + Vite production build | Passed |
| `npm run test:contract` | 61 passed |
| `npm --prefix client-local test` | 19 passed |
| `npm --prefix server/sync test` | 4 passed |
| `npm --prefix web test` | 40 passed |
| Six existing fixture Chromium checks | 6 passed, including mobile containment, keyboard/focus and automated accessibility |
| `node client-local/scripts/test-website.mjs` | Complete real browser flow passed |
| Live background website verification after restart | Paired, reviewer verified, coordinator reachable, zero pending commands |
| `git diff --check` | Passed |

The full website script uses the current real authenticated A, real B SQLite
service, actual Vite frontend and Chromium with an isolated Git source/integration
worktree. It checks all eight pages, pairing and automatically verified review
rights; correction after an explicitly labeled injected HTTP 400; actual message
delivery; UI task creation and execution; a safe repair diff; separate approval
without source changes; explicit application with actual passing tests and a Git
commit; persisted verified cache state and reload; a stale proposal from a second
enrolled device followed by reviewer UI conflict resolution; revocation removing
UI permission; no browser exceptions; and no credentials in localStorage.

Only the rejected-message response is injected in that script. The coordinator,
sync gateway, local queue, reviewer enforcement, execution, application, tests,
Git operations and conflict resolution all use production implementations. All
its databases/workspaces are bounded temporary fixtures and are removed after
services close. Port 5174 is used by default (`UD_TEST_WEB_PORT` overrides it).
No traces or credential screenshots are recorded. Existing third-party Zod
Rollup annotation warnings remain nonfatal.

## Running on this laptop

The website was left running in a hidden background Node process, serving:

- Dashboard: `http://127.0.0.1:5173`
- Local service: `http://127.0.0.1:4100`
- Authenticated coordinator: `http://127.0.0.1:4001`

Port 4000 was already occupied and its process was preserved. The stack uses its
own `.board/website-runtime` directory with current-account Windows ACLs. It
preserved its device identity/task across its restart. `runtime.json` records the
current PID/URLs; the adjacent `device.db.session.json` contains the private local
pairing key. Pair a new browser with that key; do not use either coordinator token.
No real project workspace was configured in the persistent instance, so execution
there correctly stays unavailable until a trusted `UD_WORKSPACE_CONFIG` is supplied.
The real execution acceptance above ran entirely in disposable workspaces.

Start a comparable instance interactively with:

```powershell
$env:PORT = '4001' # Choose a free port; do not start a second copy over the running instance.
node client-local/scripts/start-website.mjs --reviewer
```

Omit `--reviewer` for an unprivileged local instance. Stop an interactive instance
with Ctrl+C. Dependencies are installed separately; the helper never kills port
owners or rewrites existing credentials/databases.

Physical multi-laptop LAN/internet-disconnection rehearsal remains open in #7.
This does not implement the proposed future hackathon project/architecture workflow,
automatic file-watcher execution or real LLM recovery.
