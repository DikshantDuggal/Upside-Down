# Multi-Agent Test Runbook: Host + Dev A + Dev B

This runbook documents the end-to-end verification and demonstration procedure for 3 independent collaborating entities using **Upside-Down 2.0 Phase 5 (GitHub-Native Communication)**.

---

## 1. Test Participants

| Role | Entity ID | GitHub Handle | Responsibility | Primary Tool |
|---|---|---|---|---|
| **Host** | `host` | `@DikshantDuggal` | Mission orchestration, assignments, reviews, release approval | Upside-Down Web UI |
| **Developer A** | `dev-a` | `@agent-alice` | Frontend UI / Client implementation | Google Antigravity / Cursor |
| **Developer B** | `dev-b` | `@agent-bob` | Backend API / Service implementation | Claude Code / OpenAI Codex |

---

## 2. Automated Test Execution

You can execute the entire multi-agent test suite locally in under 1 second using the bundled Mock GitHub API harness:

```bash
# Run the Phase 5 GitHub Multi-Agent suite
npm run test:github

# Run full project hackathon suite
npm run test:hackathon

# Run all 14 end-to-end suites
npm test
```

Expected output:
```
▶ Phase 5: GitHub-Native Multi-Agent Communication Suite (UD-IC/2.0)
  ✔ Test A: UD-IC/2.0 Protocol Serialization & Schema Enforcement
  ✔ Test B: Workspace Initialization & Issue Generation
  ✔ Test C: Task Acknowledgment Workflow
  ✔ Test D: Cross-Agent Handoff Request & Response Exchange
  ✔ Test E: Progress Reporting & Monotonicity Guards
  ✔ Test F & G: PR Evidence Submission & Host Approval Gating
  ✔ Test H: Quarantine of Edited Comments & Idempotent Replay
✔ 10/10 tests pass (0 failures)
```

---

## 3. Live Hackathon Demonstration Workflow

### Step 1: Host Launches Mission Control
1. Start the Upside-Down stack:
   ```bash
   npm run dev:all
   ```
2. Open `http://localhost:5173` in your browser.
3. In **Hackathon Mission Control**:
   - Create project: `AI Study Planner MVP`.
   - Enter problem statement.
   - Click **Generate Ideas**, refine, and select the target concept.
   - Click **Generate Architecture** and approve technical boundaries.
   - Click **Start Mission**.

### Step 2: Workspace Creation on GitHub
The Host attaches the project to the repository:
```bash
node scripts/agent-bridge.mjs attach \
  --repo <owner>/<repo> \
  --project <project-id>
```
This generates:
- Coordinator Issue: `[UD-COORDINATOR] AI Study Planner MVP`
- Task Issue #1: `[UD-TASK] Frontend UI & Interactive Study Timers` (assigned to `@agent-alice`)
- Task Issue #2: `[UD-TASK] Backend Storage & REST APIs` (assigned to `@agent-bob`)

### Step 3: Developer A Ingests Assignment & Starts Work
Developer A (running on their machine):
```bash
# Ingest task instructions into assistant prompt
node scripts/agent-bridge.mjs prompt --repo <owner>/<repo> --issue <issue-1> --agent-id dev-a

# Acknowledge assignment
node scripts/agent-bridge.mjs ack --repo <owner>/<repo> --issue <issue-1> --agent-id dev-a --assignment-id <assign-id>

# Signal start of work
node scripts/agent-bridge.mjs started --repo <owner>/<repo> --issue <issue-1> --agent-id dev-a --task-id task-1 --branch feat/study-timers
```

### Step 4: Cross-Agent Handoff Exchange
Developer A needs an API contract from Developer B:
```bash
# Developer A requests handoff
node scripts/agent-bridge.mjs handoff \
  --repo <owner>/<repo> --issue <issue-1> \
  --agent-id dev-a --target dev-b \
  --action request \
  --summary "Need JSON payload specification for /api/timers/sync"
```
Developer B responds:
```bash
# Developer B completes handoff
node scripts/agent-bridge.mjs handoff \
  --repo <owner>/<repo> --issue <issue-2> \
  --agent-id dev-b --target dev-a \
  --action complete \
  --summary "Schema defined in src/types/api.ts with { id, duration, completedAt }" \
  --handoff-id <handoff-id>
```

### Step 5: Submission & Verification
1. Developer B creates Pull Request #10 and completes task:
   ```bash
   node scripts/agent-bridge.mjs complete \
     --repo <owner>/<repo> --issue <issue-2> \
     --agent-id dev-b --task-id task-2 \
     --pr-url "https://github.com/<owner>/<repo>/pull/10" \
     --head-sha "abc1234" \
     --summary "API endpoints and tests completed"
   ```
2. The Host reviews PR #10 in the **Agent Communication Center** on the Web Dashboard:
   - Verifies PR status and CI checks.
   - Clicks **Approve & Verify**.
   - State advances to `verified`.
