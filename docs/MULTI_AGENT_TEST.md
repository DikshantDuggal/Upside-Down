# Phase5 communication verification

## Real evidence: 2026-11-04

Dedicated project: `phase5-acceptance-20261104` in DikshantDuggal/Upside-Down.

- [Coordinator issue15](https://github.com/DikshantDuggal/Upside-Down/issues/15).
- [Backend task16](https://github.com/DikshantDuggal/Upside-Down/issues/16), DikshantDuggal.
- [Frontend task17](https://github.com/DikshantDuggal/Upside-Down/issues/17), ArhaanArora.

Only DikshantDuggal's credentials were used (actual numeric GitHub ID188999359).
Arhaan was resolved through GitHub and invited through an actual mention, never
impersonated. Assignment creation alone does not prove the recipient received it.

| Observed action | Actual comment |
| --- | --- |
| Registration | [6619046703](https://github.com/DikshantDuggal/Upside-Down/issues/15#issuecomment-6619046703) |
| Backend assignment | [6619026328](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619026328) |
| Backend ACK | [6619050498](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619050498) |
| Backend started | [6619054869](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619054869) |
| Backend progress | [6619058485](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619058485) |
| Handoff request to Arhaan | [6619062067](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619062067) |
| Historical PR metadata submission | [6619114945](https://github.com/DikshantDuggal/Upside-Down/issues/16#issuecomment-6619114945) |

Handoff request UUID: `d2e63265-810a-4ce5-8c83-be30992a60c4`. Independent Arhaan
ACK/response is pending; no complete real two-developer round trip is claimed.
Each CLI update ran in a separate process, and later reads recovered prior
history. PR3 files, commits, reviews and checks were actually fetched; the
retrospective fixture remains submitted, policy valid, CI `not_configured`.
This is historical metadata, not fresh coding execution or passing CI.

Ignored `.board/phase5/` holds sanitized live logs, PR evidence, browser JSON/
screenshot and test logs. Final results are in PHASE5_VERIFICATION.md.

## Fixtures versus independent developers

`npm run test:github` tests three simulated numeric identities using an injected
fake API: assignments, authorization, ACK/start/progress, correlated handoffs,
stale ownership, replay, ambiguous sends, edits/deletions, locks, pagination,
PR/CI/file policy, signature verification, pairing/cookies/CSRF and failure
checkpoints. Simulated identities are not external AI assistants.

`node scripts/test-github-browser.mjs` is a deliberately live authenticated test
of coordinator15 on loopback5180. It uses the protected local key in memory,
checks task/source links and manual prompt export, posts a host message, drops
its accepted response, retries the original UUID, verifies one remote comment,
reloads and checks credential isolation/anonymous rejection. It writes to the
dedicated issue and must not be run against unrelated projects.

## Finish the independent pilot

Each developer uses their own authorized GitHub CLI login:

```powershell
node scripts/agent-bridge.mjs whoami
node scripts/agent-bridge.mjs attach --repo DikshantDuggal/Upside-Down --issue 15
node scripts/agent-bridge.mjs read --repo DikshantDuggal/Upside-Down --project phase5-acceptance-20261104
node scripts/agent-bridge.mjs prompt --repo DikshantDuggal/Upside-Down --project phase5-acceptance-20261104 --task phase5-frontend
```

Arhaan can explicitly `ack ... --task phase5-frontend`. Handoff ACK/response uses
`post --file message.json` with actual sender, fresh UUID/ISO time, the request's
UUID as correlationId, a participating task ID and valid payload. See
AGENT_BRIDGE.md and UD_IC_2_PROTOCOL.md. No --agent-id or --pr-url aliases exist.

Use one bounded `poll ... --seconds 30`, never an unlimited shell loop. Verify
real author/comment IDs. To finish the full coding pilot, both developers need
new authorized PRs and observed configured CI before exact-SHA host approval.
Do not start unassigned implementation or merge as part of this metadata fixture.
Native scheduled monitoring stays paused and independent of the CLI bridge.
