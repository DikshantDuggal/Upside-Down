# Backend A: UD-IC/1.0 implementation and verification

UD-IC/1.0 means **Upside-Down Integration Contract, version 1.0**. It specifies
shared task/message types, HTTP routes, authentication, durable acknowledgements,
revision/conflict rules, replay, execution evidence and patch application. A version
header alone is not proof of compliance; the behavior below must pass.

## Source and ownership

Backend A work continues from `4db4c56` on `3-backend-a-contract-v1`, with publication
target `dikshant/backend` (PR #3). The separate original checkout/branches and the
other session's `e322c3b` implementation remain untouched. No merge or deployment
is performed here. Main already contains the independently owned frontend from PR #8.

B-owned `contracts/sync.ts`, `server/sync/`, and `client-local/` are imported **unchanged**
from `55307ada287f0e0c7242be689e62da0d5acc7e33` (PR #6). All new gateway/adapter,
enrollment, execution, tests and this handoff live in A-owned paths. Accepted
integration handoffs cover startup and root scripts. B's public `SyncGateway`,
`Principal`, execution and error types are used directly, without a parallel API.

Board agreements: contract request #6613045520; B acceptance/handoff #6613787525;
pairing agreement #6613877596, #6614132100, #6614135924 and #6614142386.
Updated integration/reviewer request: #6614708645.

## Implemented behavior

- Same-connection SQLite transactions atomically commit task/message changes,
  canonical events, sync outcome and contiguous device progress. Persistent epoch,
  opaque cursor, event/sequence identity checks and original durable ACKs survive restart.
- B's real router is mounted at `/api/sync`. An adapter translates A's safe error
  classes, including expired cursors, into B's nominal `ProtocolError` class.
- Stale proposals become persisted conflicts without changing task owner/revision.
  Reviewer resolution checks live task and conflict revisions. Private messages are
  filtered from unrelated devices' pull, history and live/replayed SSE.
- Manual enrollment produces 256-bit device or separately scoped reviewer/admin
  credentials; only hashes persist in A. Revocation is enforced. Token output files
  are exclusive-create and restricted with Windows ACLs, containing only the bearer
  string expected by B. No token is printed or sent to the browser.
- Standalone startup defaults to authenticated, loopback, replay-enabled,
  `verified_application` mode. Configured CORS is explicit. Programmatic legacy
  `createServer()` behavior remains available for compatibility.
- Durable run/cancel/read/checkpoint APIs use registered workspace/test IDs,
  bounded heuristic repair, disposable Git worktrees, ownership/path checks, bounded
  actual subprocess evidence and a restricted environment. Tests changing source,
  Git HEAD or the index invalidate evidence. Interrupted runs become blocked;
  checkpoints explicitly advertise `metadata_only`, never model-state recovery.
- Approval and application are separate. In verified mode approval leaves `review`
  and changes no source. Explicit apply verifies immutable diff/base/task revision,
  retests in an isolated worktree, commits with immutable job/hash markers and
  fast-forwards only the registered clean dedicated integration worktree.
- Only durable verified application with passing evidence can set the task `done`.
  Git-advanced/DB-failed jobs retain locks and reconcile their known commit once;
  inconsistent recovery stays locked for human inspection. No blind reapplication,
  forced branch reset, PR merge or Git push occurs in an execution job.
- Online run/cancel/decision/apply mutations use principal+route+key+body idempotency.
  Same key/body returns the original response/job; changed bodies return 409.
- `/api/capabilities` reports actual configured features and completion mode.
  Execution/apply remain unavailable without trusted local workspace configuration.

## Run the automated checks (PowerShell)

From the checkout containing these changes, with Node 24.20+ and installed root
dependencies (`npm install` if needed; root has no tracked lockfile):

```powershell
npm run typecheck
npm run test:contract
npm test
npm --prefix client-local test
npm --prefix server/sync test
```

`test:contract` covers durability, gateway/auth, SSE replay, execution safety, durable
jobs and joined HTTP acceptance. It creates disposable SQLite databases and Git
fixtures; it does not use your active source checkout as an execution target. It
requires permission to listen on localhost and spawn Node/Git child processes.
`npm test` is the existing sequential regression suite using its legacy fixed port.
Do not run several copies of that legacy suite concurrently.

For the joined acceptance tests alone:

```powershell
node --experimental-strip-types --test server/api/__tests__/integration.test.ts
```

The joined tests use **A's actual server and B's unchanged actual local HTTP services**,
not a fake gateway. They prove disconnected queueing, local process/service reopen,
separate device identities, eventual delivery, stale conflict and authorized
resolution, private messages, lost ACK followed by coordinator restart, original
outcome deduplication, enrollment/token-file interoperability, and the complete
HTTP run/review/approve/apply/verified-commit flow. The failure suites exercise real
SQLite aborts and Git-advanced/DB-failed reconciliation.

Final observed checks on Windows / Node v24.20.0 / npm 11.19.0:
`npm run typecheck` exited 0; **61/61 contract checks**, **11/11 legacy checks**,
**17/17 B local-service tests**, and **4/4 B router tests** passed. `git diff --check`
exited 0. The final expanded contract suite includes actual CLI/Windows ACL,
restricted subprocess environment, test-side Git mutation and joined HTTP/Git cases.
The final contract run took approximately 41 seconds; timing varies by machine.

## Start A and enroll a local device

Use separate PowerShell terminals, the agreed backend checkout, and **absolute local
disk paths outside source control**. These examples do not change global account or
Git settings.

Terminal A:

```powershell
$env:UD_DB_PATH = "$env:LOCALAPPDATA\UpsideDown\coordinator.db"
$env:UD_HOST = '127.0.0.1'
$env:PORT = '4000'
$env:UD_PATCH_COMPLETION_MODE = 'verified_application'
npm start
```

No workspace config means sync/read APIs work but execution/apply capabilities are
false. Auth is required, including `/api/health`. Stop with Ctrl+C; startup performs
durable recovery before draining queued jobs. The finite queue drain executes only
accepted jobs; no automatic file-watcher repair is enabled by this bootstrap.

Terminal B, first queue-only boot:

```powershell
$env:UD_DEVICE_DB = "$env:LOCALAPPDATA\UpsideDown\device-b.db"
$env:UD_LOCAL_PORT = '4100'
$env:UD_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
npm --prefix client-local start
```

Record the printed persistent device UUID, then stop B with Ctrl+C. On A's machine,
replace `DEVICE_UUID_FROM_B` with that actual UUID and enroll it into the same A DB:

```powershell
npm run enroll -- --db "$env:LOCALAPPDATA\UpsideDown\coordinator.db" --device DEVICE_UUID_FROM_B --role device --out "$env:LOCALAPPDATA\UpsideDown\device-b.token"
```

Distribute the protected token file to that device through your trusted local
setup, never the board/browser/repository. On the same computer it is already at
that path. Restart B with the additional settings:

```powershell
$env:UD_COORDINATOR_URL = 'http://127.0.0.1:4000'
$env:UD_DEVICE_TOKEN_FILE = "$env:LOCALAPPDATA\UpsideDown\device-b.token"
npm --prefix client-local start
```

A second B instance needs `device-c.db`, port `4101`, its own printed UUID and its
own separately enrolled credential. Never copy a device database or reuse its token.
For a reviewer service, enroll a DIFFERENT UUID with `--role reviewer`, a different
protected output file, and configure B's `UD_REVIEWER_TOKEN_FILE` with that file.
Revocation uses `npm run enroll -- --db ABSOLUTE_DB --revoke PRINCIPAL_ID`; the
nonsecret principal ID is printed at enrollment. Output files are never overwritten.

For a real LAN test, explicitly bind A with `UD_HOST=0.0.0.0`, use A's actual private
LAN IP in B's coordinator URL, and keep local services loopback-bound. This trusted
private demo transport uses HTTP; no physical internet/LAN cut has been observed
by these tests. Do not copy an active SQLite DB without its WAL/SHM or claim that
plain file copies constitute a live backup.

## Trusted execution configuration

Set `UD_WORKSPACE_CONFIG` in A's terminal to an absolute local JSON configuration.
It is admin-controlled; HTTP accepts IDs, never shell commands or filesystem roots.
Example (replace every path with your trusted fixture paths; `executable` is the
actual absolute result of `(Get-Command node).Source`):

```json
{
  "runtimeDirectory": "C:/Users/you/AppData/Local/UpsideDown/runtime",
  "workspaces": [
    { "id": "source", "repositoryPath": "C:/demo/source", "repairTargetFile": "source.cjs", "allowedPaths": ["source.cjs"], "testProfileIds": ["check"] },
    { "id": "integration", "repositoryPath": "C:/demo/integration", "integrationBranch": "demo-integration", "allowedPaths": ["source.cjs"], "testProfileIds": ["check"] }
  ],
  "testProfiles": [
    { "id": "check", "executable": "C:/Program Files/nodejs/node.exe", "args": ["check.cjs"], "timeoutMs": 5000 }
  ]
}
```

Source must be a clean Git fixture. Create the dedicated integration worktree from
its known base with `git -C C:/demo/source worktree add -b demo-integration C:/demo/integration HEAD`.
Allow only A-owned source paths, not tests or secrets. The registered check must be
fully local. Worktrees isolate edits; they are not a hostile-code OS sandbox.
The automated joined fixture demonstrates the configuration without requiring any
manual source checkout changes.

## Frontend and remaining acceptance

Frontend is on main (`web/`, PR #8); do not replace it with the older B branch.
In a combined checkout follow `web/README.md`: Vite at 127.0.0.1:5173 proxies to B
4100, with matching B origin allowlist. Pair using the private local
`<UD_DEVICE_DB>.session.json` pairing key. Device and reviewer bearers stay on B;
browsers receive an HttpOnly local session and CSRF token.

A now returns authenticated capability `authorization: {role, canReview}`. A device
credential always returns false; reviewer/admin returns true. This is an additive
proposal posted in #6614708645. B must probe with the separately enrolled reviewer
credential before advertising browser authority; frontend must consume the agreed
server advertisement. Normal pairing continues to disable reviewer UI. No owner
handoff/implementation of that B/frontend bridge has yet been observed.

Outstanding team acceptance: joined browser reviewer controls against this A/B
combination, physical three-laptop LAN/internet-off rehearsal, and team review/merge
of the unmerged backend work. Automatic file-triggered durable runs remain a
separate follow-up; manual durable runs are wired and tested. Historical legacy
`done` tasks remain unverified. No real LLM, cloud-to-local runtime recovery,
automatic coordinator failover or full MVP acceptance is claimed.

The GitHub coordination monitor remains paused as requested. Manual board reads
and handoff posts do not resume it or consume unread/wait/heartbeat checkpoints.
