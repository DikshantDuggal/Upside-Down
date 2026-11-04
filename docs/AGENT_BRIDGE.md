# Upside-Down Agent Bridge CLI Guide

The **Agent Bridge CLI** (`scripts/agent-bridge.mjs`) is a lightweight, zero-dependency Node.js bridge that connects AI coding assistants (Google Antigravity, Claude Code, OpenAI Codex, Cursor, Aider, OpenCode) to the GitHub-native Upside-Down 2.0 coordination protocol (`UD-IC/2.0`).

It allows agents and developers to interact with GitHub issues, receive assignments, post progress updates, trigger handoffs, inspect PR status, and participate in coordinated hackathon missions without requiring open ports or direct network connections.

---

## 1. Prerequisites

- **Node.js**: v18.0.0 or higher
- **GitHub CLI (`gh`)**: Authenticated with repository access
  ```bash
  gh auth status
  ```
  *(Alternatively, set the `GITHUB_TOKEN` environment variable).*

---

## 2. Basic Setup and Identity

Run commands from the repository root:

```bash
# Verify identity & GitHub authentication
node scripts/agent-bridge.mjs whoami

# Check active task issues and coordination state
node scripts/agent-bridge.mjs discover --repo <owner>/<repo>
```

---

## 3. CLI Command Reference

### Discover Workspace & Tasks
Find the coordinator issue and active tasks for a repository:
```bash
node scripts/agent-bridge.mjs discover --repo DikshantDuggal/Upside-Down
```

### Inspect Assigned Task & Prompt Generation
Generate the complete system prompt and instructions for an AI coding assistant:
```bash
node scripts/agent-bridge.mjs prompt \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a
```
This produces a structured prompt containing:
- Assigned task scope, boundaries, and acceptance criteria
- Permitted file patterns (strict edit boundary)
- Branch name conventions (`feat/<task-id>`)
- Required `UD-IC/2.0` comment format
- Upstream and downstream dependencies

---

### Task Lifecycle Commands

#### 1. Acknowledge Assignment (`ack`)
Signify that the agent/developer has accepted the assignment and understands the contract:
```bash
node scripts/agent-bridge.mjs ack \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --assignment-id <assignment-id>
```

#### 2. Start Work (`started`)
Signal that implementation work has begun on the dedicated task branch:
```bash
node scripts/agent-bridge.mjs started \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --task-id <task-id> \
  --branch feat/<task-id>
```

#### 3. Report Progress (`progress`)
Send monotonic progress updates (0 to 100) with descriptive milestone logs:
```bash
node scripts/agent-bridge.mjs progress \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --task-id <task-id> \
  --percent 50 \
  --message "Implemented auth middleware and unit tests"
```

#### 4. Report Blocker (`blocked`)
Flag missing dependencies or unexpected obstacles to the host and teammates:
```bash
node scripts/agent-bridge.mjs blocked \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --task-id <task-id> \
  --reason "Awaiting data schema confirmation from backend lead"
```

#### 5. Request or Complete a Handoff (`handoff`)
Coordinate with another developer via structured dependency contracts:
```bash
# Request data or an API contract from another developer
node scripts/agent-bridge.mjs handoff \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --target dev-b \
  --action request \
  --summary "Need auth response schema for user profile"

# Complete a handoff response
node scripts/agent-bridge.mjs handoff \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-b \
  --target dev-a \
  --action complete \
  --summary "Auth response schema published in shared types" \
  --handoff-id <handoff-id>
```

#### 6. Complete Task (`complete`)
Submit implementation evidence for host review and verification. Requires a Pull Request:
```bash
node scripts/agent-bridge.mjs complete \
  --repo DikshantDuggal/Upside-Down \
  --issue <task-issue-number> \
  --agent-id dev-a \
  --task-id <task-id> \
  --pr-url "https://github.com/DikshantDuggal/Upside-Down/pull/15" \
  --head-sha "8f3b2a1c0d4e" \
  --summary "Feature complete with 100% test coverage"
```

---

### Verification and Health Checks

#### Verify Pull Request Checks (`checks`)
Inspect commit status, CI workflows, and changed files against task boundaries:
```bash
node scripts/agent-bridge.mjs checks \
  --repo DikshantDuggal/Upside-Down \
  --pr <pull-request-number>
```

#### Inspect Offline Outbox (`outbox`)
Inspect or flush queued outgoing messages if running under intermittent network conditions:
```bash
node scripts/agent-bridge.mjs outbox \
  --repo DikshantDuggal/Upside-Down \
  --action list
```

---

## 4. Integration with Non-Bridge AI Assistants (Codex, Claude, Cursor)

For AI assistants that do not execute CLI scripts directly, developers can copy the output of `prompt` directly into the chat:

```bash
node scripts/agent-bridge.mjs prompt --repo <owner>/<repo> --issue <issue#> > prompt.txt
```

Paste `prompt.txt` into the assistant window. The assistant will format its comments with the `UD-IC/2.0` code fence, and the developer can post them directly to GitHub or via the bridge.
