# Backend A implementation handoff

Contract reference: UD-IC/1.0, provided 4 November 2026. This is a
backward-compatible foundation for review, not a claim of full contract acceptance
or a finished offline-first MVP.

## Checkout and ownership

- Prepared on branch: `3-backend-a-contract-v1`.
- Publication target authorized by the owner: `dikshant/backend`; use Git history
  for the published commit SHA.
- Base: `origin/dikshant/backend`, `ec73ff7b1fcc16645484709ea92c51d9dfc46068`.
- The existing dirty `dikshat/backend-proto-g` checkout was preserved.
- Changes are confined to Backend A paths. Root config, `server/index.ts`, existing
  `server/tests/`, Backend B paths and frontend paths are unchanged.
- This handoff does not authorize a PR merge or deployment. Shared integration
  and the remaining contract work are still subject to the agreements below.
- Contract acceptance and shared-file handoffs requested at
  https://github.com/DikshantDuggal/Upside-Down/issues/1#issuecomment-6613045520.
  No Backend B/frontend acceptance or handoff was observed during implementation.

## Implemented

1. SQLite synchronous same-connection transactions, nested savepoints and after-commit
   notifications. Tasks, transitions, registry updates and compound patch decisions
   roll back with their events/journal on persistence failure.
2. Persistent coordinator epoch and ordered canonical event journal, including an
   idempotent migration of existing events. Opaque cursors page through tied timestamps
   and survive restart. Unknown/foreign cursors require reset.
3. Event ID deduplication with content checks. Identical retries do not rebroadcast;
   changed content under the same ID is rejected. Observers receive independent event
   copies and cannot roll back persisted mutations. Reentrant broadcasts preserve
   committed journal order. Entity snapshots are additive payload fields.
4. Opt-in SSE replay via `createApiRouter(coordinator, {sseReplay: true})`.
   Named `activity` frames and event UUID IDs remain compatible. `after` overrides
   `Last-Event-ID`; replay/live overlap is deduplicated. Bounded replay/backpressure
   resets slow or expired clients instead of silently dropping history.
5. Path policy checks old/new diff paths, Windows aliases, case collisions, protected
   tests/secrets, symbolic links/junctions and hard links. Review findings do not echo
   detected secret content.
6. Repair checks provider availability, bounds attempts/candidate size, gates unsafe
   candidates before test execution, restores source after provider exceptions and
   preserves independently changed files. Generated patches pass actual Git apply
   checks for LF, CRLF and missing final newlines.
7. Test subprocesses have bounded stdout/stderr, hidden Windows child consoles,
   cancellation and process-tree timeout handling. Spaced executable paths are
   preserved. npm uses its JS entrypoint when available; batch-shell execution
   requires an explicit trusted server-side profile and rejects shell metacharacters.
8. Pipeline review gates and task-revision guards prevent unsafe/stale repair runs
   from proposing patches or overwriting newer task work.

## Compatibility and deployment

Legacy startup, routes, response shapes, exported version constants and approval
defaults remain. In particular, default legacy approval still marks review tasks
done; this MUST NOT be described as verified code application. No capabilities
endpoint advertises UD-IC compliance. Replay is disabled unless explicitly enabled
by the approved integrator. Existing startup still does not instantiate the pipeline.

SQLite adds `coordinator_metadata` and `canonical_log`; it does not rewrite old task
or patch tables. Keep the database and WAL together when backing up. Old application
versions do not maintain the new journal, so a downgrade followed by new writes is
not a supported journal continuity strategy. No destructive down-migration was run.

Run code against disposable/trusted fixtures. Finally-based restoration does not
make direct legacy repair calls crash-safe or provide OS sandboxing. Durable run
worktrees and the registered execution/application worker remain pending. No
automatic watcher or application worker was started by this implementation.

## Validation

Node v24.20.0 / npm 11.19.0 on Windows. Reused installed dependencies through an
ignored node_modules junction; no package install, lockfile or root config edits.

```powershell
npm run typecheck
node --experimental-strip-types --test server/core/__tests__/durability.test.ts server/api/__tests__/eventReplay.test.ts server/agents/__tests__/safety.test.ts
npm test
```

New suites cover 14 durability, 7 HTTP/SSE and 12 execution safety scenarios.
Existing regressions cover 6 coordinator and 5 agent scenarios. HTTP/process tests
need localhost/process permissions; a sandbox EACCES was resolved by approved
execution outside the sandbox. Full final outputs are saved under ignored `.board/`.

## Pending agreement and implementation

- All three role owners' acceptance of UD-IC/1.0 and confirmed Backend B/frontend
  identities; shared startup/root/test handoffs.
- B-owned V1 sync types/router and the transactional command inbox/outcome/sequence,
  conflict-resolution gateway. A durable activity journal alone is not offline sync.
- Auth enrollment/revocation, separate reviewer authorization, restricted CORS and
  contract-version/error middleware. Legacy server remains unauthenticated.
- Durable run/cancel/checkpoint APIs, trusted workspace profiles, isolated run
  worktrees, worker startup/shutdown/restart reconciliation.
- Verified application jobs, immutable base/hash guards, dedicated integration
  worktree, Git/DB recovery and coordinated approval/completion semantics.
- Capability flags, startup mount, two-device HTTP integration and real frontend
  acceptance. No LAN/offline demo, local LLM, model recovery or production sandbox
  is claimed.

The GitHub monitor remains paused independently of this implementation. Manual
coordination reads/posts do not resume it or consume its checkpoint.
