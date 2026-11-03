# Backend B: local durability and synchronization

Implementation for issue #5, branch `5-backend-b-sync`, contract **UD-IC/1.0**.
This is an integration foundation. Backend A's production gateway, enrollment,
reviewer sessions, and the frontend handshake still need joint runtime integration.
Do not advertise the complete sync MVP as verified yet.

## Scope and current behavior

Arhaan owns `client-local/`, `server/sync/`, and `contracts/sync.ts`.
The branch starts at `origin/main` `19130ab`; it does not merge or modify A's backend.
Compatibility checks use read-only source types from backend
`4db4c561caacd867c67a33d5cacb9c5494f8a774`, published by A during this work.
The originally supplied `ec73ff7` baseline was also typechecked successfully.

- Native Node SQLite with WAL, FULL synchronous commits and a bounded busy timeout.
- Persistent device UUID, sequence allocation, immutable outbox, browser request keys,
  terminal acknowledgements, inbox, entity/read caches, cursors and local change log.
- Enqueue commits before returning 202. Repeated browser key/body returns the same event.
  Changed body under the same key fails; pending transitions on one task are blocked.
- One sender lease per database, ordered bounded batches, persisted attempts/backoff,
  full-jitter retries and Retry-After support. 401/403/426 and invalid envelope/identity
  failures pause synchronization. Restart after fixing credentials/configuration resumes.
- Acknowledgements are matched by device/event/sequence; `receivedThrough` never marks
  unmentioned commands delivered. Conflict/rejection are terminal transport outcomes.
- Pull writes inbox, complete fetched entity snapshots, cursor and invalidation together.
  Epoch expiration clears caches and replays before sending pending commands.
- Loopback HTTP, local browser sessions, Origin/Host checks, CSRF, version validation,
  explicit read-proxy allowlist and persisted local SSE bootstrap/replay.
- Remote SSE forwards existing frames/IDs with server-side credentials. It cannot add
  replay guarantees to a legacy upstream stream.

The local service does not execute code or accept authoritative task revisions.
Internet reachability remains `unknown`; coordinator reachability is separate.

## Install and run on Windows

Tested runtime: Windows, Node **v24.22.0**, npm **11.19.1**. Node's native `node:sqlite`
is required. Install dependencies before disconnecting the internet:

```powershell
Set-Location E:\Upside
npm --prefix client-local ci
npm --prefix server/sync ci
npm --prefix client-local test
npm --prefix server/sync test
npm --prefix client-local run typecheck:baseline
```

The client has no third-party runtime dependencies. Its install provides TypeScript
checks. The sync router has an isolated Express package so root config remains untouched.
A may consolidate dependencies later through the agreed shared-file handoff.

For an initial queue-only service:

```powershell
$env:UD_DEVICE_DB = 'E:\Upside\client-local\data\device-b.db'
$env:UD_LOCAL_PORT = '4100'
$env:UD_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
npm --prefix client-local start
# Development alternative: npm --prefix client-local run dev
```

The service binds only `127.0.0.1`. The default database is `data/device.db` relative
to the package's working directory; prefer an explicit absolute local disk path.
UNC paths are rejected. Never use a network-mounted drive or clone a device database.
Keep live DB/WAL/SHM files together; stop the service before making a file-copy backup.
No live-backup command is implemented.

The first boot creates the identity and `<UD_DEVICE_DB>.session.json`. Read the printed
device ID and have A manually enroll it. A must return a device-scoped bearer token;
put only that token in a private file outside source control. Then restart with:

```powershell
$env:UD_COORDINATOR_URL = 'http://192.168.1.10:4000'
$env:UD_DEVICE_TOKEN_FILE = 'C:\Users\LENOVO\AppData\Local\Upside\device-b.token'
npm --prefix client-local start
```

Use the team's actual coordinator address. Enrollment is an A dependency; these commands
do not create enrollment or make the unmerged backend support sync.

For a second isolated instance use another terminal, another database, another enrollment
token and port `4101`. For example, `UD_DEVICE_DB=...\device-c.db` and
`UD_LOCAL_PORT=4101`. Each new database receives a distinct identity and sequence space.
Never use the same token/device identity for both instances.

On Windows, restrict the token and `.session.json` files to the current OS account using
filesystem ACLs. The service requests mode 0600 on creation, which does not itself prove
Windows ACL protection. No credentials are placed in Vite variables or SSE URLs.
HTTP on a private trusted demo LAN is the current transport assumption.

## Accepted browser handshake

The board proposal is comment `6613877596`, accepted by A in `6614132100` and frontend
in `6614135924`. These additive bootstrap routes are agreed; joint runtime integration
and reviewer authority are still pending.

1. Through the same-origin Vite proxy, POST `/local/session` with
   `{ "pairingKey": "<value from the private local .session.json file>" }`.
   Include `Content-Type: application/json`, `X-UD-Contract: UD-IC/1.0` and an allowed
   browser Origin. This is a local pairing credential, never A's device bearer.
2. The service sets an HttpOnly, SameSite=Strict `ud_local` cookie and returns
   `{contractVersion, csrfToken}`. Session lifetime is 12 hours and sessions reset on
   local process restart. GET `/local/session` returns CSRF for an existing session.
3. Writes include `X-CSRF-Token`. POST `/local/commands` also requires a stable
   `Idempotency-Key`. Retrying after process/browser failure must reuse the same key/body.
4. Read `/local/state`, retain `localCursor`, and connect to
   `/local/events/stream?after=<cursor>&contractVersion=UD-IC%2F1.0` with cookies.
   Listen for `local_change`; refetch state. On `reset`, obtain a fresh snapshot.

All canonical local JSON routes are protected by the session and contract header.
202 means **stored locally**. Look up `/local/commands/:eventId` for the terminal outcome.
Do not interpret the absence of a pending receipt as proof of task success.
`LocalState.pending` contains queued/sending commands; terminal receipts remain in SQLite
and are accessible by event ID. The contract does not currently include command/task
association in receipts; frontend should retain that association when submitting.

Offline cached GET responses preserve the upstream JSON shape and include
`X-UD-Stale: true` and `X-UD-Cached-At`. Uncached reads return 503. Cache invalidation after
pull prevents an earlier proxy task snapshot from hiding a newer canonical task.

Online-only mutation proxies currently return 503 `REVIEWER_SESSION_UNAVAILABLE`,
including registry/run/patch/conflict writes. These are never queued. A must agree the
separate reviewer/online authority mechanism before enabling forwarding. Local pairing
does not turn the device token into reviewer authority.

## Backend A mount and gateway handoff

After installing `server/sync` dependencies, A integrates in its owned/approved startup:

```ts
import { createSyncRouter } from "./sync/router.ts";
app.use("/api/sync", createSyncRouter(gateway, authenticate));
```

`authenticate` must verify A's credentials/revocation and set `res.locals.principal` to
the exact contract `Principal`. The payload cannot supply the principal. Return/throw
`ProtocolError` from `server/sync/protocol.ts` for ErrorV1 status mapping, or adapt A's
errors to that class. Authentication runs before body processing. Mount the router before
an unbounded/shared JSON parser if A wants this module's 1 MiB parser limit to apply.

The router calls only `SyncGateway.process/pull/listConflicts/resolve`. A owns all
authoritative mutations, transactions, hashes, dedup outcomes, contiguous progress,
canonical logging, conflicts, lifecycle rules, direct-message filtering and resolution
authorization. A must preserve earlier commits when a later batch command fails.

Open integration details:

- A confirmed `4db4c56` as shared backend baseline in `6614132100`; the actual authenticated
  transactional gateway and startup mount remain pending.
- Wire the accepted local session handshake to frontend and verify against the running service.
- The existing gateway interface exposes no progress accessor. Router `receivedThrough`
  is currently a conservative confirmed prefix from terminal acks or SEQUENCE_GAP's
  `expectedSequence`, defaulting to 0 when it cannot know. Agree exact reporting if A
  requires the full current device watermark on every response; the sender ignores it.
- Resolve-request idempotency keys are not present in the supplied gateway signature.
  A must provide an approved request-scoped idempotency mechanism before claiming that
  repeated resolutions replay the original result.
- No message-read route exists. A accepted a complete `Message` in `payload.message` on
  `message_sent` in `6614132100` (the hydrator also recognizes `message.sent`).
  Missing/unauthorized snapshots stop cursor advancement.
- A's complete retained journal must represent all state needed to rebuild a device;
  legacy timestamp history is not an adequate substitute. Initial replay fetches current
  tasks/agents/patches/conflicts before committing a page.
- Exclude all local SQLite DB/WAL/SHM files, session files, caches and node_modules from A's
  project watcher. Enrollment, watcher configuration and root package wiring are A's work.

`contracts/sync.ts` retains the legacy `SYNC_CONTRACT_VERSION`, `SyncEvent`, and
`ConflictRecord` and adds the supplied UD-IC/1.0 declarations. It imports A-owned legacy
Task/ActivityEvent/AgentInfo/PatchRecord types; ordinary typecheck requires A's backend.
On setup-only main, `typecheck:baseline` extracts those four files at the pinned SHA into
ignored `.integration/backend` and checks through TypeScript rootDirs. This is a read-only
compatibility fixture, not a merge, production implementation, or claim of A approval.

## Validation and remaining acceptance work

Tests use temporary paths, ephemeral ports and fixture credentials. The suite covers:
durable identity/idempotency, real child-process kill/restart, failed commit rollback,
bounded busy failure, single-sender lease, immutable retries, same-task pending guard,
ack matching, atomic cache/cursor replay, local/remote SSE, session/CSRF/Origin/Host/version
checks, HTTP batch validation, partial gateway failure, sequence-gap stopping and role gates.

Two disk-isolated local HTTP services are tested against a durable SQLite HTTP **test
fixture**, including dropped ACK after commit, duplicate replay with original canonical
IDs, epoch reset and no echo. This is evidence for B's transport/persistence behavior,
not end-to-end verification of A's production coordinator.

Remaining joint acceptance: actual A enrollment/gateway, complete command/conflict/message
behavior, stale concurrent proposals and racing reviewer resolutions, direct-message
privacy, fault injection inside A's transaction, frontend UI integration, and the physical
internet-off/LAN-on demonstration. Disk-full behavior is modeled with a transaction abort;
an actual full filesystem/power-loss test has not been performed.
