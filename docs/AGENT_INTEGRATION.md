# Upside-Down 2.0: Agent Integration Guide
## Multi-Agent Tool Bridges & Execution Protocol

Upside-Down 2.0 supports diverse AI coding tools across a 3-tier integration model:

1. **Level 1: GitHub / Pull Request Workflow** (Universal, zero-install)
2. **Level 2: Structured Prompt Bridges** (Tailored CLI prompts for Antigravity, Claude Code, Codex, Cursor, Aider)
3. **Level 3: Direct Coordinator API** (Programmatic REST / Webhooks)

---

## 1. Supported Coding Agents & Prompt Bridges

When a task contract is claimed, Upside-Down's Prompt Bridge (`GET /api/hackathon/tasks/:id/prompt-bridge/:tool`) transforms the contract into an optimized prompt for each tool:

### 1.1 Google Antigravity (`agy`)
- Injects AGY-specific agent rules, slash command recommendations (`/plan`, `/compact`), KaTeX formatting constraints, and file link syntax (`file:///...`).
- Explicitly enforces bounded edits within `allowedPaths`.

### 1.2 Claude Code (`claude`)
- Targets the Anthropic Claude CLI terminal workflow.
- Directs Claude to inspect existing code with `View`, implement edits within whitelisted files, execute local test suites, and generate a Git branch `feat/task-<id>`.

### 1.3 OpenAI Codex / ChatGPT
- Generates a concise markdown specification with step-by-step instructions, typescript type stubs, and unit test requirements.

### 1.4 Cursor / Windsurf
- Formats `.cursorrules` and Composer context with file whitelist boundaries and task criteria.

### 1.5 Aider
- Generates exact CLI shell commands adding only allowed files:
  ```bash
  aider --file server/api/routes.ts --file server/tests/routes.test.ts --message "Implement TASK-002: REST endpoints"
  ```

---

## 2. Cross-Agent Handoff Workflow

When Developer A (Frontend) needs an API endpoint that Developer B (Backend) hasn't finished:

1. **Create Handoff:**
   - In the Upside-Down UI or via API:
     ```http
     POST /api/hackathon/projects/:id/handoffs
     Content-Type: application/json

     {
       "sourceTaskId": "TASK-001",
       "sourceRole": "frontend",
       "targetTaskId": "TASK-002",
       "targetRole": "backend",
       "requestSummary": "Need POST /api/auth/register returning JWT token and user profile"
     }
     ```
2. **Live Broadcast:**
   - The coordinator records the handoff in SQLite and emits `HANDOFF_CREATED` via Server-Sent Events.
3. **Backend Resolution:**
   - Developer B's agent finishes the endpoint, runs backend tests, and marks the handoff resolved:
     ```http
     POST /api/hackathon/handoffs/:handoffId/resolve
     Content-Type: application/json

     {
       "status": "resolved",
       "resolutionNotes": "Endpoint committed in branch feat/task-002 with passing integration tests."
     }
     ```
4. **Unblocking Frontend:**
   - Developer A's task transitions from `blocked` to `in_progress`.

---

## 3. Direct REST API for Autonomous Agents

Agents running headlessly can interact with the coordinator directly:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hackathon/projects/:id/tasks` | List all task contracts |
| `POST` | `/api/hackathon/tasks/:id/claim` | Lease task for 60 minutes |
| `POST` | `/api/hackathon/tasks/:id/progress` | Report progress percent and status |
| `POST` | `/api/hackathon/tasks/:id/submit` | Submit PR URL and test passing evidence |
| `POST` | `/api/hackathon/projects/:id/handoffs` | Create cross-agent dependency handoff |
| `POST` | `/api/hackathon/handoffs/:id/resolve` | Resolve cross-agent dependency handoff |
