# Verification before publishing to dikshant/backend

Date: 4 November 2026 (Asia/Kolkata).
Tested code: `a963504b804663cf0fc1c42455ae3cae94506ec5`.
The publication commit adds only this verification record and report updates.
User authorization: test the complete integration and push it to `dikshant/backend`
afterwards. This does not authorize merging into main or public deployment.

## Current source and preservation

- Source worktree: `codex/final-launch`, derived from required integration baseline
  `775942e`, including canonical main `892e65d` and the human-approved narrow
  project/handoff UI/proxy work.
- Fetched publication target: `437383c897aa96fa5d13d013a484124e3ca566eb`.
- Target is an ancestor of the tested release. The rebase check with merge-history
  preservation completed and kept the exact tested code SHA/tree.
- Original checkout, unrelated active services, device DBs, branches and account
  settings remain preserved. Only normal fast-forward publication is allowed.
- The recurring GitHub monitor remains disabled. Checks were manually triggered
  and bounded; no new recurring agent or shell polling loop was created.

## Executed verification

| Command or check | Observed result |
| --- | --- |
| `node scripts/verify-release.mjs` | All 13 groups PASS |
| Root and client-local TypeScript | PASS |
| `npm run test:contract` | 61 PASS: durability, authentication, sequence/dedup, conflicts, replay, safety, jobs and joined real HTTP/Git |
| `npm test` | 11 existing backend checks PASS |
| `npm run test:sync` | 5 storage checks PASS |
| `npm run test:demo` | 8 scripted transport/lifecycle stages PASS; not independent AI execution |
| `npm run test:launch` | 5 PASS: real activation, actual stop/restart, state preservation, auth/sender safety and occupied-port protection |
| `npm --prefix client-local test` | 21 PASS |
| `npm --prefix server/sync test` | 4 PASS |
| Official frontend production build | PASS |
| `npm --prefix web test` | 40 PASS |
| Environment checks | 5 assertions PASS |
| `npm run test:collaboration-browser` | PASS with two real independent local device DBs/services/browser contexts: projects, assigned agents/tasks, structured handoff, receiver ACK, spoof rejection, reload, outage/reconnect |
| Official Chromium suite on web5197/local4197 | 7 PASS, 1 explicitly skipped legacy backend smoke |
| `node client-local/scripts/test-website.mjs` | PASS: real pairing/reviewer authority, actual run/approval/application/Git commit, stale peer conflict and revocation |
| `npm run test:rollback-live` | PASS: actual browser official -> read-only demo -> official, same real task retained |
| `npm run build:demo` | PASS; preserved fallback assets reproduce |
| Frontend status/rollback/activation CLI | PASS in `.board/prepush-selection`; live user selection untouched |

The skipped case requires intentionally unauthenticated legacy backend mode.
The hardened authenticated product was exercised by the real-service browser
scenarios instead. Fixture browser checks are not represented as physical tests.

## Remaining physical-machine acceptance

The selected remote endpoint `http://192.168.137.242:4001` previously returned401
without credentials. Its owner confirmed fresh enrollment of device
`e14609f1-282f-4795-b347-8f401797d976`, but the corresponding protected token file
has not been transferred to this installation. No existing local token was sent
there. Authenticated physical sync, physical interruption/recovery and internet-off
LAN rehearsal are NOT TESTED/BLOCKED by that missing transfer. Local two-device
results do not substitute for physical acceptance.

## Evidence

Detailed outputs are retained locally in `.board/evidence/`:
`release-checks.json`, the individual release logs, `prepush-chromium.log`,
`prepush-reviewer-browser.log`, and `prepush-browser-rollback.log`.
Runtime state, bearer tokens, pairing keys, SQLite files, browser profiles and
traces containing credentials are excluded from Git. The public report records
only outcomes and nonsecret source identifiers.
