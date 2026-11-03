# Joint integration — 4 November 2026

Issue #9 integrates the published canonical branches on `9-joint-integration`:

| Component | Source |
| --- | --- |
| Frontend | `4-frontend-dashboard` at `742bba23e62c56282fc0259d6d795e09f74134de` (same tree as starting main `bce2b36b7c0f8dacc2a50974d6527da8606bcadb`) |
| Backend B | `5-backend-b-sync` at `55307ada287f0e0c7242be689e62da0d5acc7e33` |
| Backend A | `dikshant/backend` at `437383c897aa96fa5d13d013a484124e3ca566eb` |

The three branches merged without source conflicts. A already included the exact B handoff. The separate `integration/final-mvp` prototype at `775942e3111e26e64f6f8722ad4e3808553515d6` is preserved separately; it is not the canonical backend handoff. A later fetch found `dikshant/backend-proto-g` at `66aa6ce89503abccba002219612ae3b37490d7f8`, adding automatic termination of processes on port 4000 to that prototype's startup script. This divergent branch remains separate as specified by A's published canonical handoff.

Combined installation exposed incompatible Express declarations: root used `@types/express` 5 while B used 4. B's manifest and tracked lockfile now use the same major as root. No runtime Express upgrade or teammate source edit was needed.

## Verification on this laptop

Windows, Node v24.22.0, npm 11.19.1. All commands exited successfully:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed with both backend packages installed |
| `npm --prefix client-local run typecheck` | Passed against the actual merged contracts |
| `npm run test:contract` | 61 passed |
| `npm test` | 6 coordinator + 5 agent scenarios passed |
| `npm --prefix client-local test` | 17 passed |
| `npm --prefix server/sync test` | 4 passed; repeated after a clean `npm ci --ignore-scripts` |
| `npm --prefix web run build` | TypeScript and production bundle passed |
| `npm --prefix web test` | 35 passed |
| `npm --prefix web run test:e2e` with both real-service opt-ins | 8 Chromium tests passed |
| `node client-local/scripts/test-dashboard.mjs` | Real authenticated A + B + browser flow passed |

The eight browser tests include six fixtures, an actual legacy A REST/SSE smoke check, and real B pairing/queue/process-restart recovery. The integration run used a disposable source snapshot under ignored `.board/integration-smoke`, with its own databases and credentials. Legacy mode was limited to the compatibility smoke check.

The additional committed dashboard script starts the current authenticated coordinator, enrolls a disposable device in memory, starts the real local service and Vite, and operates Chromium. It verifies browser pairing, task enqueue, one authoritative task, a pulled local task, visible dashboard state, reload without duplication, and absence of the pairing key/device credential from localStorage. It closes its services and deletes its bounded temporary directory. Install root, client-local and web dependencies, and run `npx playwright install chromium` from `web` before using it. Port 5173 must be free.

The coordinator integration suite separately verifies two real local databases/services, offline reopen, lost ACK and coordinator restart, deduplication, stale conflict/reviewer resolution, private message filtering, protected enrollment/revocation, and an actual run/review/approve/apply/verified Git commit.

Observed harmless output: two existing third-party Zod Rollup annotation warnings; expected proxy disconnects during browser tests that deliberately restart or omit B; a deliberate subscriber-failure test message. None caused failed tests.

## Recovery checkpoints

- `fallback/pre-integration-2026-11-04` preserves the original laptop branch at B `55307ad`, created and pushed before merging.
- `fallback/post-integration-2026-11-04` preserves the tested combined integration commit, created and pushed before publishing the main merge.
- The local, verified complete Git bundle is `.board/pre-integration-55307ad.bundle`. It includes the original refs and history; it is not a database backup.

Use a new branch to inspect or recover either point without rewriting shared history:

```powershell
git fetch origin --tags
git switch -c recovery/pre-integration fallback/pre-integration-2026-11-04
# Or use a different new branch for the working combined checkpoint:
git switch -c recovery/post-integration fallback/post-integration-2026-11-04
```

The bundle can be checked with `git bundle verify .board/pre-integration-55307ad.bundle`. Test credentials, databases, dependencies and browser output are not committed. No live application data was migrated or replaced.

## Remaining acceptance work

Issue #7 remains open. Physical separate-laptop LAN operation with internet disconnected has not been established by these loopback tests. Automatic frontend reviewer authorization is still gated off: A reports authenticated authorization, and B supports a separate reviewer credential for online actions, but the dashboard permission bridge requires the agreed follow-up. The browser test does not claim reviewer UI approval/application. Execution additionally requires an explicitly configured workspace/provider; no automatic watcher startup or live team deployment is claimed.
