# GitHub-Native Multi-Agent Communication Architecture

Upside-Down 2.0 uses **GitHub as the primary, authoritative communication and collaboration platform**.
There is **no direct agent-to-agent networking**, no local WebSocket broker, and no peer-to-peer requirement.

---

## 1. Core Architecture Principles

1. **GitHub Issues for Work Assignments:**
   - One coordinator issue per project: `[UD-COORDINATOR] <Project Name>` (labeled `ud-coordination`).
   - One dedicated task issue per contract: `[UD-TASK] <Task Title>` (labeled `ud-task`, assigned to the developer's GitHub handle).
2. **GitHub Comments for Agent Messages:**
   - All inter-agent and inter-developer communication occurs via GitHub issue comments formatted using the `UD-IC/2.0` protocol.
3. **Cryptographic Identity Verification:**
   - Message senders are validated against the authenticated GitHub API author (`comment.user.id` and `comment.user.login`). Senders specified in comment text are never blindly trusted.
4. **Isolated Git Branches for Development:**
   - Each task assigns an isolated branch (e.g. `feat/<task-id>`) and allowed file path patterns.
5. **Pull Requests for Evidence:**
   - PR URLs, current commit head SHAs, review states, and passing CI checks gate task completion.
6. **No Local LAN or Direct Connections:**
   - Developers and their AI coding assistants interact exclusively through GitHub CLI (`gh`) or standard GitHub issue comments.

---

## 2. Issue & Workspace Coordination Structure

```text
GitHub Repository: owner/repo
  │
  ├── Issue #100: [UD-COORDINATOR] AI Study Planner
  │     ├── Marker: <!-- ud-workspace:proj-123 -->
  │     ├── Immutable Bootstrap Comment (```ud-workspace-json)
  │     ├── TASK_ASSIGNMENT: task-fe -> @dev-alice (Issue #101)
  │     └── TASK_ASSIGNMENT: task-be -> @dev-bob (Issue #102)
  │
  ├── Issue #101: [UD-TASK] Build Study Sessions View
  │     ├── Assignee: @dev-alice
  │     ├── Label: ud-task
  │     ├── Comment: TASK_ACK from @dev-alice
  │     ├── Comment: HANDOFF_REQUEST from @dev-alice -> @dev-bob
  │     └── Comment: TASK_COMPLETED (PR #11, commit 7a8b9c0)
  │
  └── Issue #102: [UD-TASK] Implement Study Sessions API
        ├── Assignee: @dev-bob
        ├── Label: ud-task
        ├── Comment: TASK_ACK from @dev-bob
        ├── Comment: HANDOFF_RESPONSE from @dev-bob -> @dev-alice
        └── Comment: TASK_COMPLETED (PR #12, commit f1e2d3c)
```

---

## 3. Communication Notification Pipeline

```text
+-----------------------+                    +-----------------------+
|  Developer / Agent A  |                    |  Developer / Agent B  |
|  (e.g. Antigravity)   |                    |  (e.g. Claude Code)   |
+-----------+-----------+                    +-----------▲-----------+
            |                                            |
            | Posts Comment via CLI / Web                | Receives via Poll / Webhook
            v                                            |
+--------------------------------------------------------+-----------+
|                        GitHub Issues & PRs                         |
|             (Authoritative, Auditable Event Ledger)                |
+-----------------------------------+--------------------------------+
                                    |
            Webhook Push (or Bounded Polling Fallback)
                                    v
+--------------------------------------------------------------------+
|               Upside-Down Coordinator & Dashboard                  |
|          Validates Provenance, Reduces State, Checks CI            |
+--------------------------------------------------------------------+
```

---

## 4. Bounded Polling & Rate Limit Resilience

When webhooks are not configured, Upside-Down uses **bounded, conditional GitHub API polling**:
1. **ETag & Conditional Requests:** `If-None-Match` prevents consuming rate limits when comments have not changed (returns HTTP 304).
2. **Cursor Persistence:** The last processed comment ID is stored in SQLite WAL (`github_cache`), ensuring zero lost messages across restarts.
3. **Exponential Backoff:** On HTTP 429/403, pauses according to `Retry-After` or `x-ratelimit-reset`.
4. **Bounded Lifetimes:** Polling cycles never loop indefinitely; max polling intervals are capped to 60 seconds.

---

## 5. Team Setup Guide (Zero LAN Setup Required)

1. **Host Prerequisites:**
   - Host logs into GitHub CLI: `gh auth login`.
   - Host starts Upside-Down: `npm run dev:all`.
2. **Host Workspace Initialization:**
   - Open [http://localhost:5173](http://localhost:5173) and navigate to **Agent Communication Center**.
   - Enter repository (e.g. `owner/repo`) and click **"Connect repository and start GitHub mission"**.
   - Issues are automatically provisioned on GitHub.
3. **Teammate Access:**
   - Teammate Developer B runs `node scripts/agent-bridge.mjs discover --repo owner/repo`.
   - Teammate reads task, acknowledges, and submits code via standard GitHub pull requests.
