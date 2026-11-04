# Standalone GitHub agent bridge

Prerequisites: Node24.20+ and an authenticated GitHub CLI. Use each developer's own
account. No local coordination server, database sharing or LAN URL is needed.
The bridge communicates only with GitHub and keeps its own protected local cache.
It does not run coding instructions from issues or automatically execute an agent.

From the repository:

```powershell
node scripts/agent-bridge.mjs whoami
node scripts/agent-bridge.mjs attach --repo OWNER/REPO --issue COORDINATOR_NUMBER
node scripts/agent-bridge.mjs discover --repo OWNER/REPO
node scripts/agent-bridge.mjs read --repo OWNER/REPO --project PROJECT_ID
node scripts/agent-bridge.mjs prompt --repo OWNER/REPO --project PROJECT_ID --task TASK_ID
```

Use the **coordinator** issue for attach; task issue numbers are discovered from
host assignment messages. A fresh cache can reconstruct the mission via attach.
If a different local cache directory is needed, add `--state ABSOLUTE_DIRECTORY`.
Never point it at another agent's cache or tools/board state.

## Register and acknowledge

Save `register.json` containing your approved role and selected coding tool:

```json
{"role":"backend","tool":"codex"}
```

```powershell
node scripts/agent-bridge.mjs register --repo OWNER/REPO --project PROJECT_ID --payload register.json
node scripts/agent-bridge.mjs ready --repo OWNER/REPO --project PROJECT_ID
node scripts/agent-bridge.mjs ack --repo OWNER/REPO --project PROJECT_ID --task TASK_ID
node scripts/agent-bridge.mjs started --repo OWNER/REPO --project PROJECT_ID --task TASK_ID
```

The bridge derives sender identity from `gh api user` and looks up the current
assignment ID. It never impersonates another developer. Registration/ready means
that account reported readiness; it is not proof that Codex, Claude Code,
Antigravity, OpenCode or Cursor is connected through a proprietary direct API.
Tool changes can be reported by another AGENT_REGISTER while preserving the role.

## Progress and handoffs

Save `progress.json` with `{"progress":25,"text":"Actual progress and evidence."}`:

```powershell
node scripts/agent-bridge.mjs progress --repo OWNER/REPO --project PROJECT_ID --task TASK_ID --payload progress.json
node scripts/agent-bridge.mjs blocked --repo OWNER/REPO --project PROJECT_ID --task TASK_ID --payload blocker.json
```

For `handoff.json`, provide `targetTaskId`, `text`, optional `contract`, and optional
absolute ISO deadline (or a bounded-duration string such as `2h`). Then:

```powershell
node scripts/agent-bridge.mjs handoff --repo OWNER/REPO --project PROJECT_ID --task SOURCE_TASK --to OTHER_LOGIN --payload handoff.json
```

ACK/response/completion use the generic `post --file message.json` command with a
complete UD-IC/2.0 envelope. See `UD_IC_2_PROTOCOL.md`. Correlate to the **request's
message UUID**, not its GitHub numeric comment ID. Use either participating task
context and the matching task issue; do not post into an unrelated task.

## Actual PR submission

Save `evidence.json` with real values (never use these placeholders as evidence):

```json
{"branch":"AUTHORIZED_TASK_BRANCH","prNumber":123,"commitHash":"FULL_40_CHARACTER_REAL_HEAD_SHA","text":"Actual implementation/test report."}
```

```powershell
node scripts/agent-bridge.mjs complete --repo OWNER/REPO --project PROJECT_ID --task TASK_ID --payload evidence.json
node scripts/agent-bridge.mjs checks --repo OWNER/REPO --project PROJECT_ID --task TASK_ID
```

Only the host may dispatch checks, and an explicit active GitHub workflow must be
configured for the mission. No server-side execution of submitted code occurs.
PR existence or a developer's success text never means verified completion.

## Recovery and bounded reads

```powershell
node scripts/agent-bridge.mjs poll --repo OWNER/REPO --project PROJECT_ID --seconds 30
node scripts/agent-bridge.mjs outbox
node scripts/agent-bridge.mjs post --repo OWNER/REPO --project PROJECT_ID --file message.json
```

Polling is capped at60seconds/10cycles, with bounded individual API requests and
backoff. No unattended infinite shell/agent loop or scheduled task is installed.
To stop a running bridge, use Ctrl+C; leases expire after interrupted processes.
For an unknown write outcome, repeat the original command/payload, or retain the
original message file with its UUID/time. The bridge reconciles before retrying.
Changing an unresolved message ID's body is refused. Errors do not advance cursors.

The manual prompt includes project/architecture, contracts, dependencies, file
boundaries, branch, tests, submission and GitHub communication instructions.
A developer must approve execution in their coding tool. If the tool cannot use
GitHub, the developer can paste the serialized comment and submit a PR manually.
No future Local/WebSocket/MCP transport is implemented in this phase.
