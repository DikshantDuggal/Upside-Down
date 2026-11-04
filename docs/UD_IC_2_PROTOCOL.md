# UD-IC/2.0 protocol

GitHub comments are authoritative. `server/core/github/protocol.ts` contains the
strict parser/serializer; `reducer.ts` enforces identity and state transitions.
Human-only comments are readable but never mutate task state.

The serializer emits a human summary and exactly one `ud-ic-json` fence. Example:

```json
{"version":"UD-IC/2.0","id":"03a551e7-57bc-4ca2-ae0f-5f036ee1dd7d","projectId":"example-project","taskId":"backend-api","sender":"developer-login","recipient":"host","type":"TASK_ACK","createdAt":"2026-11-04T05:30:00.000Z","payload":{"assignmentId":"b65beed5-2521-4a98-865f-b5b70d417ca6","text":"Assignment received."}}
```

These are example IDs. Every envelope field above is required. `taskId` is null
for project-wide messages. Optional `correlationId` references a message UUID,
never a GitHub comment ID. Sender is a login string; recipient is a login, `host`
or `all`. Unknown fields, malformed UUIDs/timestamps, oversized payloads, invalid
progress and abbreviated commit SHAs are rejected. Messages are limited to24KB.
Known credential/private-key patterns are refused before publication.

## Supported payloads (22 types)

| Type | Payload/context |
| --- | --- |
| AGENT_REGISTER | approved `role`, supported `tool` |
| AGENT_READY, AGENT_DISCONNECT, AGENT_RECONNECT | optional `text` |
| TASK_ASSIGNMENT | `assignee`, isolated `branch`, numeric task `issue`; optional `reason`; host only |
| TASK_ACK, TASK_STARTED, TASK_BLOCKED, TASK_FAILED | current `assignmentId`; optional `text` |
| TASK_PROGRESS | current `assignmentId`, `progress` 0–100; optional `text` |
| TASK_COMPLETED | current `assignmentId`, `prNumber`, full `commitHash`, `branch`; optional `text` |
| HANDOFF_REQUEST | `targetTaskId`, `text`; optional `contract`, ISO `deadline` or duration such as `2h` |
| HANDOFF_ACK, HANDOFF_COMPLETED | optional `text`; correlate to request |
| HANDOFF_RESPONSE | optional `text`, `contract`, `prNumber`; correlate to request |
| CONTRACT_UPDATE | `text`, `contract` as applicable |
| CONTRACT_ACK | optional `text`; correlate to update |
| INTEGRATION_REQUEST, INTEGRATION_RESULT | `prNumber`, `expectedHeadSha`, `text` as applicable |
| HOST_MESSAGE | `text`; optional `action`; only `resolve_blocker` mutates blocker state |
| HOST_APPROVAL | submission: `prNumber`, `expectedHeadSha`, correlate to submission; handoff: correlate to response |
| HOST_REJECTION | optional `text`; correlate to submission |

The reducer imposes contextual rules beyond schema shape. Task/handoff messages
and host approval/rejection require a task ID. Handoff replies may use either
participating task on its corresponding issue. Clock-only deadlines such as
`12:00` are rejected. ACK/response/completion, CONTRACT_ACK and host
approval/rejection require correlation IDs.

## Authorship and transitions

Approved workspace members have GitHub logins and numeric user IDs independently
resolved through GitHub. Claimed sender must match the actual comment author and
approved identity. The bootstrap must be the issue creator's immutable comment.
This verifies API authorship; payloads are not cryptographically signed.

Only the host assigns/reassigns. Actual GitHub issue assignees are updated and the
issue is preserved. Each assignment has a new UUID; the old owner's stale updates
are rejected. Only the current owner can ACK/start/report progress. Dependencies
must be verified before starting.

Normal progression: awaiting_ack → acknowledged → running → submitted → verified.
Blocked/failed tasks require explicit recovery. Completion text creates a
submission. Host approval requires actual PR author/branch/base/head/file/review
policy, observed passing CI and the exact approved head SHA. Missing CI is
`not_configured`, never passed. Handoff approval reviews the response, not code.

## Replay and recovery

Edited protocol comments are quarantined. Bounded paginated conditional rereads
rebuild state after deletions/reordering. Duplicate UUIDs fold once; conflicting
content is rejected. Missing correlations are deferred. Semantic duplicate
handoff ACKs cannot trigger reply loops. No message executes shell commands or
coding tools.

The separate protected SQLite cache stores source IDs, decisions, cursors, leases
and pending sends. Snapshot/checkpoint commit atomically after a complete read;
network/auth failures never advance it. An ambiguous write retains the original
UUID/body/time and reconciles the actual remote comment before retry.
