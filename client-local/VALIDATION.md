# Backend B validation record

Date: 4 November 2026 (Asia/Calcutta).

Environment: Windows, Node v24.22.0, npm 11.19.1.
Source branch: `5-backend-b-sync`, based on `19130ab` (setup-only main).
Backend type fixture: `4db4c561caacd867c67a33d5cacb9c5494f8a774` (newly published A foundation).
The originally supplied `ec73ff7b1fcc16645484709ea92c51d9dfc46068` fixture also passed.
Input `contract.md` SHA-256:
`377ab00964ce777a40816a1debd9f666c3873f9ffad44f33ee0557960a88bd60`.

Final pre-commit checks:

| Command | Exit | Result |
|---|---:|---|
| `npm --prefix client-local test` | 0 | 17 tests passed; 0 failed/skipped |
| `npm --prefix server/sync test` | 0 | 4 tests passed; 0 failed/skipped |
| `npm --prefix client-local run typecheck:baseline` | 0 | Local service, router and tests compile against pinned A types |

Both `npm --prefix client-local start` and `npm --prefix client-local run dev` were
also launched with separate smoke databases on loopback ports 49161/49162. Both reached
the startup-ready message in queue-only mode. They were intentionally stopped with
Ctrl-C (wrapper exit 1); neither port remained listening afterward.

The first sandboxed HTTP run could not connect to loopback (`EACCES`). The recorded
passing HTTP runs used permitted loopback execution. A test cleanup-order failure and
a test's unsupported fetch Host override were corrected before the final passing run.

Evidence comes from executable assertions over separate temporary SQLite files and
real HTTP ports, plus a real child process that is force-killed/restarted:

- Process restart retains event/device/sequence and browser key mapping.
- After a fixture drops ACK following its transaction commit, local state stays queued;
  replay returns `duplicate:true` and the original canonical IDs, with one fixture task
  mutation. Two local services ultimately cache both fixture tasks.
- Injected local transaction abort leaves sequence/outbox/inbox/cache/cursor unchanged.
- SQLite writer contention fails within the configured bounded busy wait.
- Unknown coordinator epoch rebuilds caches before additional outbound work; replay
  does not add outbound commands.
- 401/403/426 stop the worker and retain the queue.
- Authentication, device match, batch validation, partial failures, cursor bounds,
  CSRF/origin/Host checks and SSE replay/forwarding have automated coverage.
- Online writes use a distinct reviewer bearer, preserve upstream 202, and neither
  retry nor create outbox entries after a dropped online response. Registry forwarding
  uses the device credential; missing reviewer configuration cannot elevate that token.

The coordinator in the replication test is a durable HTTP **fixture**. It is not
Backend A's production gateway. A's mutation/sequence/conflict/message semantics,
production enrollment/reviewer authorization, frontend behavior and a physical LAN
demo remain unverified. No root/backend regression suite was run on this setup-only
branch. Ordinary `typecheck` requires A-owned types from the eventual integrated backend;
the documented baseline check uses exact read-only copies in an ignored directory.

Test fixtures are removed after handles/processes close. No fixture device tokens or
runtime databases are committed. The final implementation commit SHA is published on
the board/PR with this validation record.
