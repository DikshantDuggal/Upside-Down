# UD-IC/2.0 Protocol Specification

**Upside-Down Inter-Agent Coordination Protocol Version 2.0 (`UD-IC/2.0`)** is a formalized, GitHub-native messaging protocol designed for multi-agent and multi-developer collaborative coding.

It embeds structured, machine-verifiable JSON envelopes within standard human-readable GitHub issue and pull request comments.

---

## 1. Message Envelope Format

Every `UD-IC/2.0` message posted to GitHub consists of two synchronized layers:
1. **Human-Readable Layer:** Markdown-rendered section with task summaries, instructions, mentions, and progress bars.
2. **Machine-Readable Layer:** An immutable, parseable JSON code fence tagged with ````ud-ic-json````.

```markdown
### 🚀 UD-IC/2.0: TASK_STARTED
> **Task:** `task-backend-auth`
> **Agent:** `@dev-bob`
> **Branch:** `feat/task-backend-auth`

Branch created and initial endpoints drafted.

```ud-ic-json
{
  "protocol": "UD-IC/2.0",
  "id": "msg-8f123456",
  "timestamp": "2026-11-04T05:30:00.000Z",
  "sender": {
    "agentId": "dev-bob",
    "githubHandle": "dev-bob",
    "role": "developer"
  },
  "recipient": {
    "agentId": "host",
    "githubHandle": "DikshantDuggal",
    "role": "host"
  },
  "type": "TASK_STARTED",
  "taskId": "task-backend-auth",
  "branch": "feat/task-backend-auth",
  "payload": {
    "baseBranch": "main"
  }
}
```
```

---

## 2. Complete Message Types (22 Total)

### A. Lifecycle & Registration
| Type | Sender | Recipient | Description |
|---|---|---|---|
| `AGENT_REGISTER` | Developer/Agent | Host | Registers an agent with its capabilities, supported tools, and handle |
| `AGENT_READY` | Developer/Agent | Host | Signals that the agent has loaded repository context and is ready for work |
| `AGENT_DISCONNECT` | Developer/Agent / Host | All | Notifies that an agent has disconnected or gone offline |
| `AGENT_RECONNECT` | Developer/Agent | Host | Signals that an agent has reconnected and re-established its lease |

### B. Task Assignments & Execution
| Type | Sender | Recipient | Description |
|---|---|---|---|
| `TASK_ASSIGNMENT` | Host | Developer | Dispatches a structured task contract to the developer on their issue |
| `TASK_ACK` | Developer | Host | Acknowledges receipt and understanding of the task contract |
| `TASK_STARTED` | Developer | Host | Confirms work has started on the specified git branch |
| `TASK_PROGRESS` | Developer | Host | Reports progress (percent 0-100) and step-by-step progress logs |
| `TASK_BLOCKED` | Developer | Host | Alerts host of missing dependencies, environment issues, or blockers |
| `TASK_COMPLETED` | Developer | Host | Submits evidence: PR URL, head commit SHA, and changelog for review |
| `TASK_FAILED` | Developer | Host | Reports fatal task failure with error logs and stack traces |

### C. Cross-Agent Handoffs
| Type | Sender | Recipient | Description |
|---|---|---|---|
| `HANDOFF_REQUEST` | Developer A | Developer B | Requests an API schema, interface definition, or data artifact |
| `HANDOFF_ACK` | Developer B | Developer A | Developer B confirms receipt of the handoff request |
| `HANDOFF_RESPONSE` | Developer B | Developer A | Developer B supplies the requested contract/mock/artifact |
| `HANDOFF_COMPLETED`| Developer A | Developer B & Host | Developer A verifies that the dependency is fulfilled |

### D. Contracts & Integration
| Type | Sender | Recipient | Description |
|---|---|---|---|
| `CONTRACT_UPDATE` | Host | Developer(s) | Broadcasts modified interface specifications or schema changes |
| `CONTRACT_ACK` | Developer | Host | Developer confirms compliance with the updated contract |
| `INTEGRATION_REQUEST`| Host | Integration Dev | Triggers multi-branch integration and conflict verification |
| `INTEGRATION_RESULT` | Integration Dev | Host | Reports integration test suite results, coverage, and merge status |

### E. Host Governance & Approvals
| Type | Sender | Recipient | Description |
|---|---|---|---|
| `HOST_MESSAGE` | Host | All / Developer | Broadcast guidance, announcements, or priority adjustments |
| `HOST_APPROVAL` | Host | Developer | Formal host acceptance of a task or release based on verified evidence |
| `HOST_REJECTION` | Host | Developer | Rejection with specific feedback and remediation criteria |

---

## 3. Reducer State Machine & Integrity Rules

The `UD-IC/2.0` reducer (`server/core/github/reducer.ts`) enforces strict deterministic state folding:

1. **Authorship Verification:**
   - Senders declared inside `ud-ic-json` must match the authenticated GitHub comment author (`comment.user.id`).
2. **Strict State Sequencing:**
   - Tasks must strictly transition through:
     $$\text{unassigned} \longrightarrow \text{awaiting\_ack} \longrightarrow \text{acknowledged} \longrightarrow \text{running} \longrightarrow \text{submitted} \longrightarrow \text{verified}$$
   - Direct jumps (e.g. from `unassigned` directly to `submitted`) are rejected.
3. **Monotonic Progress Guarantee:**
   - `percent` in `TASK_PROGRESS` must be $\ge$ the previous highest reported percent. Regressive progress updates are discarded.
4. **Evidence Gating on Approval:**
   - `HOST_APPROVAL` is strictly prohibited unless:
     - Task is in `submitted` state.
     - A valid Pull Request URL is registered.
     - The PR head SHA matches the submission.
     - All CI checks and integration tests are passing.
5. **Quarantine of Edited Comments:**
   - Any GitHub comment where `comment.updated_at !== comment.created_at` is flagged as quarantined and excluded from state calculation to prevent tamper attacks.
