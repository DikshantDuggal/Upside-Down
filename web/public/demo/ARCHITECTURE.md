# ARCHITECTURE.md — AgentSync (working name)

> Upside Down Hackathon · PS-03-first, with PS-02-style conflict awareness · 4 developers · 15-hour implementation window
>
> Working name is a placeholder. Inspiration: `azizu06/hackathon-agent-board`. We are **not** claiming its features are implemented in our project until tested.

## 1. Product in one sentence

A local-first control plane where multiple coding agents working on one repository publish progress, discover contract changes, avoid conflicting edits, keep functioning without internet, and synchronize an auditable activity digest to GitHub when connectivity returns.

## 2. The demo we must deliver

1. Open a local dashboard showing three simulated agents working on one repository.
2. Agent A modifies a shared API contract (for example `GET /api/tasks` now requires `status`).
3. The system emits a `contract.changed` event and flags Agents B and C as potentially affected.
4. Agent B acknowledges the change; an incompatible edit by Agent C creates a visible conflict requiring human resolution.
5. Turn off **internet access** while retaining localhost/LAN access. Agents continue communicating with the local server; events are stored durably; GitHub-sync jobs queue.
6. Restore internet. Trigger sync and show each queued item completing once, with a GitHub link if configured.
7. Show a clear chronological audit trail. **No automatic merge** in the MVP.

**Honesty boundary:** Offline means no cloud/internet connection, NOT that independent devices communicate with zero local network. Single-laptop localhost is the reliable demo fallback. The agents can be simulators/CLI scripts, not autonomous commercial LLM integrations.

## 3. Scope: Must / Should / Cut

| Priority | Deliverable |
|---|---|
| MUST | Local coordinator with persisted events, agents, tasks and conflict flags |
| MUST | API contract frozen before independent implementation |
| MUST | Dashboard: agent status, tasks, feed, conflicts, sync queue |
| MUST | `POST /api/events` with event IDs and idempotency |
| MUST | Live updates via Server-Sent Events (SSE) with polling fallback |
| MUST | CLI/event simulator used for reproducible demo |
| MUST | File/contract-change notification, initially rule-based from explicit event payload |
| MUST | Offline-capable local activity and persistent cloud-sync queue |
| SHOULD | GitHub issue/comment sync when token and network are available |
| SHOULD | File ownership and simple conflict detection |
| SHOULD | File watcher for actual local repo changes |
| CUT | Full autonomous agent orchestration, AI conflict adjudication, auto-merging, peer-to-peer mesh, multiple organizations, auth, production deployment |

**MVP differs from a basic agent message board through the combined live dependency warning, offline event persistence, queue replay and conflict review workflow.** These are planned claims, not verified results.

## 4. Four people, one owner per boundary

| Owner | Module | Owns | Must NOT change | Completion evidence |
|---|---|---|---|---|
| **P1 — Backend / coordinator (you)** | `server/src/core/**`, `server/src/db/**` | SQLite schema, persistence, agent/task registry, conflict rules, queue/outbox, coordinator service | API route handlers, UI, GitHub adapter | Unit tests for append, dedupe, conflicts, restart durability |
| **P2 — Frontend / UX** | `web/**` | React dashboard, agent cards, event stream, task board, conflicts and sync status, demo-friendly visuals | Server internals and schemas | Screenshots + browser demo driven by fixtures and then API |
| **P3 — API / realtime** | `server/src/http/**`, `shared/**` | Routes, runtime request validation, errors, SSE, `openapi.yaml`/fixtures, CORS, mocks | Database internals, UI, GitHub adapter | `curl`/API contract tests, SSE demo, validation coverage |
| **P4 — Agent integration / QA** | `bridge/**`, `server/src/integrations/**`, `scripts/**`, `tests/e2e/**` | CLI bridge, simulated agents, optional filesystem watcher, GitHub sync adapter, scenario automation, E2E | Coordinator logic, API routes, UI | One-command scenario passes offline/reconnect and restart tests |

**No shared-file editing without notifying the file owner.** Each developer works on a separate branch; the integrator does not become the only person responsible for merges. Owners merge their own tested PRs at planned checkpoints.

### Critical interface between P1 and P3

P3 calls the `CoordinatorService` interface in `shared/service-contract.ts` implemented by P1. P3 starts against an in-memory fake implementing that same interface. P1 does not implement HTTP. Every API calls a method on the service; only P1 touches database tables.

### Critical interface between P3 and P2/P4

P3 publishes `shared/schemas.json`, sample JSON response fixtures and API routes defined in `CONTRACT.md` within the first hour. P2 uses fixtures until the server is ready. P4 posts events through the public HTTP API; it does not import coordinator internals.

## 5. Reference structure

```text
agentsync/
├── ARCHITECTURE.md
├── CONTRACT.md
├── README.md
├── package.json               # npm workspace scripts
├── shared/
│   ├── schemas.json            # event/request/response definitions; P3
│   ├── service-contract.ts     # interface jointly frozen P1 + P3
│   └── fixtures/               # versioned mocks; P3
├── server/
│   ├── src/
│   │   ├── index.ts           # bootstrap wiring; P3
│   │   ├── core/              # coordinator logic; P1
│   │   ├── db/                # SQLite + migrations; P1
│   │   ├── http/              # Express routes, SSE; P3
│   │   └── integrations/      # GitHub adapter and outbox worker; P4
│   └── data/                  # local SQLite DB; gitignored
├── web/
│   └── src/                   # React/Vite; P2
├── bridge/                    # CLI simulator + optional watcher; P4
├── scripts/                   # setup, seed, demo, reset; P4
└── tests/
    ├── contracts/             # P3
    ├── core/                  # P1
    └── e2e/                   # P4
```

Suggested stack: TypeScript, React + Vite, Node + Express, SQLite (`better-sqlite3` if compatible with the installed Node version), SSE, `zod` or equivalent validation, native `fetch`, and optionally `chokidar` for file watching. No extra infra required for local demo.

## 6. Logical data flow

```text
Agent scripts / optional file watcher        React Dashboard
             |                                  ^  |
             | POST /api/events                 |  | GET/POST API
             v                                  |  v
         Express HTTP + validation + SSE broadcaster  [P3]
             |                 ^
             | CoordinatorService interface
             v                 |
       Coordinator logic [P1] ---- SQLite events, agents,
             |                    tasks, conflicts, outbox [P1]
             v
     Pending GitHub outbox entries
             |
             v
   GitHub sync worker / CLI [P4] ---> GitHub (online only)
```

- **Persist first, then broadcast.** A successful event POST means the event is durably accepted.
- **Source of truth:** local SQLite. GitHub is a synchronized outward projection, never required for local operation.
- **Ordering:** server assigns increasing `sequence`; client event timestamps are for display only.
- **Idempotency:** `eventId` uniquely identifies an event; a repeated POST returns the original record without duplicate side effects.
- **Realtime:** SSE for dashboard notifications; `GET /api/events?afterSequence=N` as recovery/poll fallback.
- **Conflict detection:** deterministic rules first: competing open file claims; contract-change dependency overlap; incompatible explicit contract versions. A conflict is a warning, not proof of a merge conflict.
- **Security:** bind server to `127.0.0.1` for a single-device demo; no production security promises. Store GitHub token only in backend environment variables, never in client code or JSON payloads.

## 7. Build schedule (15-hour engineering window)

| Time from kickoff | P1 | P2 | P3 | P4 | Gate |
|---|---|---|---|---|---|
| 0:00–0:45 | Approve service methods + schema | Wireframe five panels | Freeze endpoint names, sample fixtures | Create three-agent scenario script | **G0:** `CONTRACT.md` approved by all |
| 0:45–3:00 | SQLite + event append/dedupe | Layout with mock data | Implement validation + mocked routes + SSE | CLI emitter + scripted payloads | **G1:** mock full path works |
| 3:00–6:00 | State, queue, conflict rules | Connect live API + SSE | Replace mock service with P1 service | GitHub outbox worker stub + tests | **G2:** live dashboard with local writes |
| 6:00–9:00 | Persistence hardening | Conflict review + UX polish | Contract test suite + recovery API | Offline/reconnect scenario + optional watcher | **G3:** demo can run without internet |
| 9:00–12:00 | Fix core bugs only | Accessibility/responsive polish | End-to-end API checks | Optional GitHub live sync, or mock-mode output | **G4:** entire scripted walkthrough passes |
| 12:00–13:30 | Integration support | Demo walkthrough polish | Fix blockers only | Failure injection + demo seed/reset | **Feature freeze** at 13:30 |
| 13:30–15:00 | Test + presentation | Test + presentation | Test + presentation | Run demo twice + prepare fallback | **Code freeze** at scheduled cutoff |

**Hard deadline override:** if the event ends with coding freeze at **08:30** and submission at **08:45**, stop code changes at 08:30 regardless of the relative schedule; leave the last 15 minutes for packaging and submission.

## 8. Integration gates — observable, not verbal

- **G0** Four approvals, endpoint examples load, schema decisions recorded.
- **G1** `npm run demo:seed` emits three agents' events into mocked API; UI renders fixtures.
- **G2** Real event POST visible in UI within ~2 seconds on local machine (demo target, not a guaranteed SLA).
- **G3** Disable internet; event persists; restart server; event still exists and outbox says `pending`.
- **G4** Reconnect internet; if configured, GitHub sync transitions `pending → synced`; repeated sync does not duplicate created remote issues/comments.
- **Final** Fresh clone/install/start + one command to reproduce demo, with an offline/mock fallback.

## 9. Team working agreement

1. Each task has an owner, output artifact and short due time; no ambiguous “research something interesting” tasks.
2. Every 60–90 minutes, each person posts **commit/PR, evidence, blocker and next step**.
3. If blocked >20 minutes, raise it immediately. If a commitment is missed twice, cut that feature or reassign a specific bounded task.
4. **Contract changes require all affected owners' approval.** Additive fields are preferred; never silently rename endpoints or event types.
5. Keep `main` runnable. PRs are small; avoid simultaneous edits to someone else's module.
6. The leader should **not** silently absorb unfinished tasks. Reduce scope before expanding anyone else's workload.
7. If live GitHub sync threatens the working demo, disable it and demonstrate persisted outbox with clearly labeled simulation.

## 10. Definition of done

- Three distinct agent IDs can send events and appear on dashboard.
- Change to a shared contract visibly warns at least one subscribed agent.
- A detected competing edit/claim creates a reviewable conflict; user can resolve it with a note.
- Local operations survive simulated internet loss and server restart.
- Outbox sync status and audit timeline are visible; duplicate events do not duplicate records.
- E2E demo script and README explain exactly what is simulated versus real.
