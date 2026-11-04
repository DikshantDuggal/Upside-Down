# CONTRACT.md — AgentSync V1 Integration Contract

> **Freeze this document in the first 45 minutes.** All four contributors build against it. Proposed interface specification, not a claim that the code already implements it.

## 0. Non-negotiable ownership

- **P1** owns coordinator and SQLite implementation (`server/src/core`, `server/src/db`). Never implement Express routes.
- **P2** owns React UI (`web`). Never directly read `.db`, JSON storage, or GitHub tokens.
- **P3** owns HTTP handlers, validation, shared schemas, service interface and SSE (`server/src/http`, `shared`). Never query SQLite from route handlers.
- **P4** owns agent CLI, GitHub adapter, demo runner and E2E tests (`bridge`, `server/src/integrations`, `scripts`, `tests/e2e`). All agent writes pass through HTTP API.

PRs touching another person's owned code require explicit approval. Any incompatible change to this contract needs P1 + P3 approval and notification to P2 + P4.

## 1. System configuration

```env
API_HOST=127.0.0.1
API_PORT=4000
VITE_API_BASE_URL=http://127.0.0.1:4000
DATABASE_PATH=./server/data/agentsync.sqlite
GITHUB_TOKEN=                 # optional, server only
GITHUB_REPO=owner/repo        # optional, server only
GITHUB_SYNC_ENABLED=false    # opt-in
```

Endpoints use base `/api`. The API must send `Content-Type: application/json`. UI connects to SSE at `/api/stream`. For a 2-device LAN demo, explicitly set API_HOST to the host's LAN interface and update frontend API URL; do not expose outside trusted demo LAN.

## 2. Canonical IDs, enums and timestamps

- All IDs are stable, opaque strings (UUID recommended), except `sequence` which is a server-assigned increasing integer.
- Timestamps: ISO-8601 UTC with trailing `Z`.
- `agent.status`: `idle | working | blocked | offline`.
- `task.status`: `todo | in_progress | blocked | done`.
- `conflict.status`: `open | resolved | dismissed`.
- `outbox.status`: `pending | syncing | synced | failed`.
- `event.type`: `agent.registered | agent.status_changed | task.updated | file.claimed | file.released | contract.changed | message.sent | conflict.detected | conflict.resolved`.
- `event.source`: `cli | watcher | ui | system`.
- `filePath` is a **repository-relative POSIX path** (`src/api/types.ts`), never an absolute path. Reject paths containing `..` segments.
- Do not rename these values after G0.

## 3. Canonical JSON records

### Agent

```json
{
  "id": "agent-a",
  "name": "Backend Agent",
  "role": "backend",
  "status": "working",
  "lastSeenAt": "2026-11-04T00:00:00Z",
  "ownedPaths": ["server/src/core/**"]
}
```

### Task

```json
{
  "id": "task-1",
  "title": "Implement task API",
  "ownerAgentId": "agent-a",
  "status": "in_progress",
  "dependsOnTaskIds": [],
  "affectedPaths": ["server/src/http/tasks.ts"],
  "updatedAt": "2026-11-04T00:00:00Z"
}
```

### Event (server response)

```json
{
  "eventId": "evt-contract-001",
  "sequence": 42,
  "type": "contract.changed",
  "agentId": "agent-a",
  "source": "cli",
  "occurredAt": "2026-11-04T00:00:00Z",
  "receivedAt": "2026-11-04T00:00:01Z",
  "payload": {
    "contractId": "tasks-api",
    "oldVersion": "v1",
    "newVersion": "v2",
    "changedPaths": ["shared/openapi.yaml"],
    "summary": "GET /api/tasks now supports required status filter",
    "affectedAgentIds": ["agent-b"]
  }
}
```

### Conflict

```json
{
  "id": "conflict-001",
  "kind": "contract_dependency",
  "status": "open",
  "filePath": "shared/openapi.yaml",
  "agentIds": ["agent-a", "agent-b"],
  "eventIds": ["evt-contract-001"],
  "reason": "Consumer agent is using an older contract version",
  "createdAt": "2026-11-04T00:00:01Z",
  "resolutionNote": null,
  "resolvedAt": null
}
```

### Outbox entry

```json
{
  "id": "sync-001",
  "eventId": "evt-contract-001",
  "status": "pending",
  "attempts": 0,
  "lastError": null,
  "remoteUrl": null,
  "updatedAt": "2026-11-04T00:00:01Z"
}
```

Do not return secrets or absolute local paths in public API responses.

## 4. HTTP endpoints (P3 owns route implementations)

| Method | Path | Purpose | Request | Success |
|---|---|---|---|---|
| GET | `/api/health` | Server health | — | `200` `{ "ok": true, "mode": "local" }` |
| GET | `/api/agents` | List agent records | — | `200` `{ "items": Agent[] }` |
| POST | `/api/agents` | Register/update agent | Agent input, no `lastSeenAt` | `200` `{ "item": Agent }` |
| GET | `/api/tasks` | List tasks | — | `200` `{ "items": Task[] }` |
| POST | `/api/tasks` | Create task | Task input, server timestamps | `201` `{ "item": Task }` |
| PATCH | `/api/tasks/:id` | Edit task status/owner/title | Partial task fields | `200` `{ "item": Task }` |
| GET | `/api/events?afterSequence=0&limit=100` | Ordered event log | query | `200` `{ "items": Event[], "nextSequence": 42 }` |
| POST | `/api/events` | Append agent event idempotently | Event input | `201` or replay `200` `{ "item": Event, "duplicate": boolean }` |
| GET | `/api/conflicts` | List conflicts | optional `status` | `200` `{ "items": Conflict[] }` |
| PATCH | `/api/conflicts/:id` | Resolve/dismiss with note | `{ "status": "resolved", "resolutionNote": "..." }` | `200` `{ "item": Conflict }` |
| GET | `/api/outbox` | List queued sync items | — | `200` `{ "items": OutboxEntry[] }` |
| POST | `/api/sync` | Request one sync pass | `{}` | `202` `{ "accepted": true }` |
| GET | `/api/stream` | SSE live updates | `Accept: text/event-stream` | SSE stream |

### `POST /api/events` sample

```http
POST /api/events
Content-Type: application/json
```

```json
{
  "eventId": "evt-contract-001",
  "type": "contract.changed",
  "agentId": "agent-a",
  "source": "cli",
  "occurredAt": "2026-11-04T00:00:00Z",
  "payload": {
    "contractId": "tasks-api",
    "oldVersion": "v1",
    "newVersion": "v2",
    "changedPaths": ["shared/openapi.yaml"],
    "summary": "GET /api/tasks now requires status filter",
    "affectedAgentIds": ["agent-b"]
  }
}
```

Rules:
- Server supplies `sequence` and `receivedAt`; clients must not.
- Duplicate `eventId`: return original record as `200`, `duplicate: true`. Never duplicate conflicts/outbox items.
- An unknown `agentId`, illegal event type or malformed event-specific payload returns `422`.
- `limit` defaults to 100 and is capped at 200; `afterSequence` defaults to 0.
- `POST /api/agents` with an existing ID updates the existing agent rather than adding a duplicate.
- `POST /api/sync` enqueues/starts a sync pass; it must not block on GitHub API latency.

## 5. Event payload contracts (P1/P3/P4)

All events share `eventId`, `type`, `agentId`, `source`, `occurredAt`, `payload`.

| Type | Required payload | Behavior |
|---|---|---|
| `agent.registered` | `{ "name": string, "role": string }` | audit registration |
| `agent.status_changed` | `{ "status": AgentStatus }` | update agent status |
| `task.updated` | `{ "taskId": string, "status": TaskStatus }` | update task state |
| `file.claimed` | `{ "filePath": string }` | record claim; if already claimed by another active agent create conflict |
| `file.released` | `{ "filePath": string }` | release the caller's claim |
| `contract.changed` | `{ "contractId": string, "oldVersion": string, "newVersion": string, "changedPaths": string[], "summary": string, "affectedAgentIds": string[] }` | create affected-agent notice, and conflict if compatibility is explicitly flagged |
| `message.sent` | `{ "toAgentId": string, "text": string }` | route visible message to recipient |
| `conflict.detected` | `{ "kind": string, "agentIds": string[], "reason": string, "filePath": string|null }` | system/bridge conflict alert |
| `conflict.resolved` | `{ "conflictId": string, "resolutionNote": string }` | close conflict; server validates permissions in future production scope |

For `contract.changed`, optionally include `incompatibleAgentIds: string[]` to create a `contract_dependency` conflict for each listed affected agent. **Affected does not automatically mean incompatible.** The demo script must explicitly mark incompatibility or provide a deterministic version mismatch, not infer it from natural language.

## 6. SSE contract

`GET /api/stream` returns `text/event-stream`. Events have this form:

```text
id: 42
event: state.changed
data: {"sequence":42,"entity":"event","entityId":"evt-contract-001"}

```

- `entity`: `event | agent | task | conflict | outbox`.
- When any entity changes, P3 emits one `state.changed` with `entityId`. For changes not backed by a new event, `sequence` is the most recent event sequence.
- P2/P4 react by refetching the affected GET endpoint. This avoids synchronizing full object schemas inside SSE messages.
- On SSE reconnect, the UI calls `GET /api/events?afterSequence=<lastSeenSequence>` and refreshes lists to recover missed updates.
- If SSE is not available, poll relevant GET endpoints every 2 seconds while demo is open.

## 7. CoordinatorService interface (P1 implements, P3 consumes)

```ts
export interface CoordinatorService {
  health(): Promise<{ ok: true; mode: 'local' }>;
  listAgents(): Promise<Agent[]>;
  upsertAgent(input: AgentInput): Promise<Agent>;
  listTasks(): Promise<Task[]>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: TaskPatch): Promise<Task>;
  listEvents(afterSequence: number, limit: number): Promise<Event[]>;
  appendEvent(input: EventInput): Promise<{ item: Event; duplicate: boolean }>;
  listConflicts(status?: ConflictStatus): Promise<Conflict[]>;
  updateConflict(id: string, patch: ConflictPatch): Promise<Conflict>;
  listOutbox(): Promise<OutboxEntry[]>;
  requestSync(): Promise<void>;
  onChange(listener: (event: { sequence: number; entity: 'event'|'agent'|'task'|'conflict'|'outbox'; entityId: string }) => void): () => void;
}
```

P3 defines the concrete TypeScript types based on the JSON examples above. P1 returns domain objects, **never Express response objects**. P3 owns HTTP status mapping and validation. P4's worker may use a narrow `OutboxRepository` interface from P1 but must not reach into SQLite directly; P1 owns SQL and idempotent sync-state transitions.

## 8. Storage and sync guarantees

- Tables: `agents`, `tasks`, `events`, `file_claims`, `conflicts`, `outbox`.
- `events.event_id` has UNIQUE constraint; `events.sequence` is auto-increment PK.
- Outbox entries are created atomically with the event that requires cloud sync; `outbox.event_id` UNIQUE.
- Crash/restart retains accepted events, conflicts and pending outbox rows.
- P4 retries failures with attempts/status visible; no endless tight retry loop.
- GitHub sync is **best-effort**, not guaranteed exactly-once across a crash after remote creation. Embed `eventId` in GitHub issue/comment marker and check for it before posting to reduce duplicates.
- Without GitHub credentials or internet, show `pending` and explain that remote sync is unavailable; **never display a fake GitHub URL**.

## 9. UI acceptance contract (P2)

Five primary panels:
1. **Agents:** name, role, status, last seen, owned paths.
2. **Tasks:** title, owner, status and dependencies.
3. **Activity:** chronological typed events, filter by agent, latest first or oldest first toggle.
4. **Conflicts:** type, agents, affected file, reason, Resolve/Dismiss with note.
5. **Sync:** pending/synced/failed counts and manual `Sync now` button.

Required states: loading, empty, API error, SSE disconnected, internet-offline-but-local-server-online, and local-server-disconnected. Never represent loss of GitHub internet as a local server outage. Do not claim a conflict is auto-resolved. All sample fixtures must be visually labeled **DEMO DATA** until real events are received.

## 10. Agent bridge and GitHub sync contract (P4)

Bridge CLI examples:

```bash
npm run agent:demo -- --agent agent-a --scenario contract-change
npm run agent:demo -- --agent agent-b --scenario acknowledge
npm run demo:full
```

- Calls POST `/api/agents` once per agent, then POST `/api/events` with stable IDs.
- For true local file events, an optional file watcher can map file changes to a `file.claimed` or `contract.changed` signal; do not automatically declare breaking changes based solely on file modification.
- Simulator scenarios are clearly labeled as simulated agent activity, not autonomous AI agents.
- GitHub adapter uses server-side env token and `GITHUB_REPO`; disabled by default.
- If sync is enabled, publish a summary into an existing designated issue or create a dedicated issue using a stable marker; do not spam one issue per event by default.

## 11. Error format

All non-2xx JSON errors:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid event payload",
    "details": [{ "field": "type", "reason": "Unknown enum value" }]
  }
}
```

Codes: `VALIDATION_ERROR` (`400`/`422`), `NOT_FOUND` (`404`), `CONFLICT` (`409`), `INTERNAL_ERROR` (`500`), `SYNC_UNAVAILABLE` (`503`, only for a direct sync-preflight failure; normal queued offline sync returns `202`).

## 12. Contract acceptance tests — owners must run before merging

| Test | Owner | Expected |
|---|---|---|
| POST valid event → GET event log | P1 + P3 | event exists with sequence |
| POST identical event twice | P1 + P3 | second response `duplicate: true`, no extra outbox/conflict |
| Two agents claim same file | P1 | one open conflict with both agents |
| Change compatible contract | P1 + P4 | alert only; no false conflict |
| Mark incompatible dependent agent | P1 + P4 | open dependency conflict |
| SSE dashboard receives change | P2 + P3 | UI updates without refresh |
| Disconnect public internet | P4 | local events still accepted; cloud jobs pending |
| Restart server | P1 + P4 | events and queue survive |
| Restore network + sync configured | P4 | queued item becomes synced with real URL |
| GitHub disabled | P4 + P2 | pending state, no fake link |
| New clone, no secrets | All | basic local demo works |

## 13. Breaking-change procedure

1. Author opens `CONTRACT CHANGE` issue/message with before/after example and affected owners.
2. Affected owners approve; P3 edits this file and `shared/schemas.json` in the same PR.
3. P2/P4 update mocks and bridge; P1 updates service/storage where needed.
4. Run contract suite; only then merge.
5. During final 3 hours, **no breaking changes** unless the whole demo is blocked.

## 14. Demo fallback ladder

1. Live local coordinator + actual GitHub sync.
2. Live local coordinator + queued GitHub sync (no internet/token).
3. Live local coordinator + scripted simulator events.
4. If the server cannot run: static **clearly labeled** fixture walkthrough, not represented as working realtime software.

**Single final success criterion:** four separately owned modules integrate into a reproducible local-first collaboration demo with truthful offline/sync behavior and an auditable conflict workflow.
