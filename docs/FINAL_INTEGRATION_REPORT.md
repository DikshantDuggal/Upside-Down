# UPSIDE-DOWN — FINAL MVP REPORT

Date: 4 November 2026 (Asia/Kolkata).

## Source and working tree

Local release branch: `codex/final-launch`, in the isolated `final-mvp` worktree.
Source baseline: `integration/final-mvp` at `775942e`; original local checkout
was at `66aa6ce` with pre-existing modifications and was preserved.
Canonical A/B/frontend source: merged main `892e65d`, including A `437383c`,
B `55307ad`, frontend `742bba2` and owner website fixes `05696bc`.
Exact final local SHA/tree is recorded in `.board/evidence/final-release.json`
and can be checked with `git log -3 --oneline`. No remote push/main merge occurs.

The human explicitly approved the narrow project/handoff UI/proxy exception.
Board records: #6617052077, endpoint scope #6616311809/#6616364660.
All other frontend/B fixes were imported unchanged before those narrow additions.

## Actual application architecture

`web/` official React/Vite build -> same-origin host -> authenticated B local
service -> canonical B sync router/A transactional gateway -> one authoritative
SQLite and canonical journal. Each peer has a separate local DB/identity/outbox.
Execution uses registered argv profiles and disposable Git worktrees; application
requires separate reviewer authority, safe immutable metadata, passing real tests
and a verified commit on the dedicated integration worktree.

The root launch command validates prerequisites, builds the actual official app,
checks state/ports, enrolls only its local device, verifies protected service health
and launches the components. Graceful stop uses protected local lifecycle control.
Existing unrelated port owners are preserved. The home launcher now uses
A4001/local4110/UI5175 alongside the original checkout's 4000/4100/5173 stack.

## Feature-to-endpoint compatibility

| Official UI feature | Actual route/path | Result |
| --- | --- | --- |
| Pair/restore session | GET/POST `/local/session` | PASS, cookie/CSRF |
| Reviewer permissions | GET `/local/authorization`, separate A credential | PASS, revocation fails closed |
| Tasks/proposals | `/local/commands`, B push/pull, A task API | PASS, durable outbox and revisions |
| Projects | GET/POST `/api/projects`, bounded online B proxy | PASS, actual browser create/reload |
| Device agent registration | POST `/api/agents/register` | PASS, device ownership, no fabricated runtime |
| Task assignments | canonical ownerId on task commands | PASS, two distinct device-owned agent IDs |
| Structured handoff | GET/POST `/api/handoffs` | PASS, task/dependency/project context |
| Recipient ACK | existing handoff payload acknowledgement convention | PASS, receiver ownership and duplicate suppression |
| Team messages | canonical message.send, full payload hydration | PASS, real delivery and live update |
| Activity | local/remote SSE + canonical pull | PASS, replay/duplicate handling |
| Conflicts | canonical list/guarded resolve | PASS, actual reviewer UI resolution |
| Runs/checkpoints | A run/cancel/read/checkpoint APIs | PASS, bounded real tests and metadata-only checkpoints |
| Approval/application | separate decision/apply/application endpoints | PASS, real Git commit/evidence; approval alone changes no source |
| Frontend replacement | CLI + dynamic web host | PASS, actual browser official/demo/official with same data |

Projects/handoffs remain online-only extensions; they are not secretly added to
the canonical offline Command union. Cached views disclose stale state and disable
writes; native sync success revalidates them after reconnect. Task records remain
global workspace items; project context on a handoff is not an invented task field.

## Verification performed

See `LAUNCH_ACCEPTANCE_REPORT.md` for exact commands/counts and evidence files.
Clean root and web dependency installs passed. Root lockfile is portable and
contains no local machine/junction dependencies. Root/B types, contract/regression,
B service/router, frontend build/unit, launcher/rollback and actual browser tests pass.
Fixture UI tests are distinguished from real A/B/Git browser checks.

A reproduced named-pipe acknowledgement bug was fixed and retested with actual
stop/restart. A real redirected Windows profile EXDEV on replacing selection
metadata was fixed and verified by restarting the user's home launcher.
A stale project view after brief coordinator loss was caught by the new real
two-device browser test and fixed with bounded revalidation driven by native sync.

## Current launch and onboarding

From `PS C:\Users\diksh>`: `.\Start-UpsideDown.ps1`.
Official verified release URL: `http://127.0.0.1:5175`.
Stop: `.\Start-UpsideDown.ps1 -Stop`.
[Complete launch guide](FINAL_LAUNCH_GUIDE.md),
[walkthrough](HACKATHON_DEMO_GUIDE.md),
[Computer B commands](TWO_COMPUTER_SETUP.md).

The user later supplied remote `http://192.168.137.242:4001`; unauthenticated
health returned401. Arhaan confirmed fresh device enrollment for
`e14609f1-282f-4795-b347-8f401797d976` (principal
`8f1fb55e-913e-4e0e-8233-228c071f3986`). The newly issued token still needs trusted
file transfer from his protected file to this laptop. Authentication/sync over
that physical link is BLOCKED until transfer; reachability is not delivery proof.
No old local credential was sent following an automatic approval rejection.

## Readiness and limits

- LOCAL HACKATHON DEMO: GO for the verified canonical and narrow collaboration scope.
- TWO INDEPENDENT LOCAL DEVICES: PASS with actual A/B databases, HTTP and browser sessions.
- PHYSICAL TWO-COMPUTER DEMO: NOT TESTED; newly requested LAN authentication is pending token transfer.
- PUBLIC PRODUCTION: NOT AUTHORIZED / NOT ASSESSED.

The new home LAN wrapper is `C:\Users\diksh\Start-UpsideDown-LAN.ps1` and uses
fresh device state, local4111/UI5176. It refuses to reuse the old local token.
The recurring GitHub monitor remains disabled. No new scheduled agents or shell
polling loops are created. No live DB reset, source overwrite, force-push,
branch deletion, remote merge or public deployment occurs.

Actual independent AI implementation, real LLM/cloud-state recovery, automatic
leader failover and watcher-triggered durable execution remain outside the verified
scope. Worktrees isolate edits rather than providing a hostile-code OS sandbox.
HTTP is a trusted private demo-LAN assumption. Demo resets create a fresh marked
state and retain previous records/checkpoints. Rollback is documented and tested.
