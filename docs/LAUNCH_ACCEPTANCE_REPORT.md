# Launch acceptance evidence

Windows / Node v24.20.0 / npm11.19.0. Date: 4 November2026, Asia/Kolkata.
Exact local source SHA/tree is in `.board/evidence/final-release.json`.

## Executed checks

| Command/check | Result |
| --- | --- |
| Clean root registry dependency install + portable lockfile validation | PASS |
| Clean official web `npm ci --ignore-scripts` | PASS |
| `npm run typecheck` | PASS |
| `npm --prefix client-local run typecheck` | PASS |
| `npm run test:contract` | 61 PASS |
| `npm test` | 11 existing backend checks PASS |
| `npm run test:sync` | 5 legacy storage checks PASS |
| `npm run test:demo` | 8 SCRIPTED contract stages PASS; not autonomous AI work |
| `npm run test:launch` | 5 PASS: sender/ACK/restart, auth-forgery, actual asset switch, graceful launch restart, occupied-port safety |
| `npm --prefix client-local test` | 21 PASS |
| `npm --prefix server/sync test` | 4 PASS |
| `npm --prefix web run build` | PASS, actual production assets |
| `npm --prefix web test` | 40 PASS |
| `npm run test:env` | 5 environment assertions PASS |
| `npm run test:collaboration-browser` | PASS, actual two-device browser project/assignment/handoff/ACK, ownership, reload and outage recovery |
| `node client-local/scripts/test-website.mjs` | PASS, real reviewer run/approve/apply/Git commit, stale conflict UI and revocation |
| `npm run test:browser-live` | PASS against persistent launched app; actual task/message delivery and reload |
| `npm run test:live-execution` | PASS, persistent launched disposable fixture actually committed after real tests |
| `npm run test:rollback-live` | PASS, actual browser official -> read-only demo -> official with same real A/B task |
| Official Chromium fixture/local-service suite | 7 PASS, 1 skipped legacy backend compatibility smoke; isolated ports supported |

The bounded `npm run verify:release` records each command, exit code and log in
`.board/evidence/release-checks.json`. It runs thirteen checks including the actual
collaboration browser scenario. Evidence records: `live-browser.json`,
`live-verified-application.json`, `live-rollback.json`, `collaboration-browser.json`.
No token, pairing key, credential storage-state export or credential trace is recorded.
The reviewer browser script injects only an explicitly labeled HTTP400 to test
message correction; its execution/application/conflict paths use production services.
Other fixture UI tests remain labeled fixtures rather than physical integration.

## Browser isolation correction

The original opt-in B browser test used fixed port4100 and could observe another
service's401 before its own child started. Another checkout later occupied
4000/4100/5173. Tests now support `UD_TEST_WEB_PORT` and `UD_TEST_LOCAL_PORT`, with
matching fixture origins and B Origin policy. No unrelated process is killed.
For example:

```powershell
$env:UD_TEST_WEB_PORT='5197'
$env:UD_TEST_LOCAL_PORT='4197'
$env:UD_LOCAL_TARGET='http://127.0.0.1:4197'
$env:UD_API_TARGET='http://127.0.0.1:4197'
$env:UD_REAL_LOCAL_ROOT=(Get-Location).Path
npm --prefix web run test:e2e
```

Legacy browser REST smoke remains skipped because its unauthenticated mode is not
the normal hardened product. The actual authenticated reviewer and collaboration
browser scenarios provide application evidence separately.

## Physical LAN status

PASS: unauthenticated request to the user-supplied `192.168.137.242:4001` returned401.
PASS: remote owner confirmed fresh device enrollment on board #6617259985.
BLOCKED: newly issued credential file has not been transferred to this laptop.
NOT TESTED: authenticated physical sync, real-device interruption/convergence,
internet-off-but-LAN-on rehearsal, independent AI implementation.

Automatic approval rejected sending the existing local bearer to the new endpoint;
the user selected fresh enrollment. The old credential was not sent. The fresh token
must arrive through trusted file copy, not board/chat. Local two-device tests do not
substitute for this physical acceptance.
