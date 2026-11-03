# Upside-Down 2.0: AI Hackathon Mission Control
## System Architecture & Technical Specification

Upside-Down 2.0 transforms collaborative software engineering during hackathons from chaotic, uncoordinated code generation into a structured, autonomous multi-agent assembly pipeline.

---

## 1. High-Level Architecture Overview

The system operates as a **web-first, hosted coordination platform** with real-time streaming, strict contract boundaries, and human-in-the-loop release gates:

```
                    ┌─────────────────────────────────────────┐
                    │            Human Hackathon Host         │
                    │        (Idea Choice, Release Approval)   │
                    └────────────────────┬────────────────────┘
                                         │ HTTPS / SSE
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Official React 19 Frontend (Vite)                          │
│  • Mission Control Overview   • AI Idea Studio       • Architecture Blueprint   │
│  • Work Contracts 2.0 (Kanban)• Team & Tool Hub      • Cross-Agent Handoffs     │
│  • Collision Engine & Release Gatekeeper                                        │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ REST API & Server-Sent Events (SSE)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Node.js / Express Authoritative Coordinator                 │
│  • Hackathon API Routes (/api/hackathon/*)   • SSE Event Stream Broadcaster     │
│  • AI Engine (Heuristic Demo Mode / Gemini / OpenAI)                            │
│  • Prompt Bridge (Antigravity, Claude Code, Codex, Cursor, Aider, OpenCode)     │
│  • Integration Engine (Path Collision Detection, Contract Conformance, Signing) │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ SQL Statements (WAL Mode)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       Persistent SQLite Database Store                          │
│  • hackathon_projects    • hackathon_ideas          • hackathon_feedback        │
│  • hackathon_architecture• hackathon_team           • hackathon_tasks           │
│  • hackathon_handoffs    • hackathon_releases                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Functional Modules

### 2.1 AI Idea Studio (`server/core/aiCoordinator.ts`)
- **Input:** Problem statement, hackathon rules, available hours (e.g. 24h), team size (2 or 3 developers), skill level, constraints.
- **Output:** 3–5 distinct, feasible project ideas. Each idea specifies:
  - Problem & Pitch
  - Target Users & Unique Selling Proposition (USP)
  - Core Features & Suggested Tech Stack
  - MVP Difficulty (`Easy` | `Medium` | `Hard`) & Time Feasibility
  - Technical Risks & 2-Minute Demo Scenario
  - Hackathon Judging Alignment
- **Iterative Refinement:** Conversational feedback loop allowing the host to request adjustments ("make it more mobile-first", "use Python for backend", etc.) while preserving prior context.
- **Decision Locking:** Host clicks "Select Idea", creating an immutable choice that unlocks architecture generation.

### 2.2 AI Architecture Blueprint Generator (`server/core/aiCoordinator.ts`)
- Generates a concrete implementation specification based on the selected idea:
  - **Spec:** Objective, target users, user journeys, MVP features, optional features, non-functional requirements, success criteria.
  - **Technical Architecture:** Frontend framework, backend runtime, database, authentication, external APIs, AI model providers, hosting infrastructure, repository folder structure.
  - **API Contract Definitions:** REST endpoints (`GET`, `POST`, `PUT`, `DELETE`), URL paths, payloads, and responsibilities.
  - **7-Phase Roadmap:** Structured timeline from Phase 1 (Environment Setup) to Phase 7 (Final Polish & Submission) with estimated hours and deliverables.
- **Host Blueprint Approval:** Host reviews and clicks "Approve Architecture", advancing the project state and triggering multi-agent task decomposition.

### 2.3 Multi-Agent Work Division (`server/core/aiCoordinator.ts`)
- Partitions the architecture blueprint into isolated, bounded **Task Contracts 2.0** (`contracts/hackathon.ts`):
  - **2 Developers:** Developer A (Frontend & UI) + Developer B (Backend, Database & APIs).
  - **3 Developers:** Developer A (Frontend & Client Logic) + Developer B (Backend Core & Persistence) + Developer C (AI Integration, Data & Services).
- Each task contract enforces:
  - `allowedPaths`: Glob patterns the agent is explicitly allowed to modify.
  - `protectedPaths`: Glob patterns the agent must NEVER modify.
  - `dependencies`: Task IDs that must be completed before this task can begin.
  - `deliverables`: Concrete files and behaviors expected.
  - `acceptanceCriteria`: Objective checklists for task validation.

### 2.4 Agent Prompt Bridge (`server/core/promptBridge.ts`)
Translates Task Contracts 2.0 into copy-pasteable or API-deliverable prompt formats tailored to specific coding tools:
- **Google Antigravity (`agy`):** Formats task context with slash-command recommendations, strict file bounding, and artifact guidelines.
- **Claude Code:** Formats task context for the Anthropic Claude CLI with explicit tool calling and non-interactive bash boundaries.
- **OpenAI Codex / ChatGPT:** Markdown task brief with copyable code scaffolds.
- **Cursor:** `.cursorrules` and Composer task prompt with target file paths.
- **Aider:** File-adding shell invocations (`aider --file <path> ...`) with instructions.
- **OpenCode:** Clean CLI-oriented prompt specification.

### 2.5 Cross-Agent Handoff System (`server/api/hackathonRoutes.ts`)
- Structured dependency exchange between agents when one agent needs an API or schema created by another:
  - Frontend developer creates a handoff request: *"Need `GET /api/v1/profile` returning user avatar, bio, and role."*
  - The handoff is tracked in SQLite (`hackathon_handoffs`) with `pending` status.
  - Backend developer sees the request, implements the endpoint in their PR, and marks the handoff `resolved` with notes.
  - Frontend developer unblocks their task upon resolution.

### 2.6 Code Integration & Collision Engine (`server/core/integrationEngine.ts`)
- **Path Collision Detection:** Compares `allowedPaths` and git branches across all active tasks. If two tasks write to the same path (e.g., both claim `server/api/routes.ts`), the collision engine flags the conflict with involved task IDs and file list.
- **Contract Conformance Checking:** Verifies deliverables match the approved architecture contracts.
- **Test Verification:** Confirms all unit and integration tests pass before release candidate assembly.

### 2.7 Host Release Gatekeeper & Deployment (`server/core/integrationEngine.ts`)
- AI agents are not permitted to deploy code independently.
- The human Host must review the release candidate, verify test passing status, check for zero unresolved collisions, and click **"Approve Release"**.
- Signs the release with an immutable timestamp and `approvedBy` host name.
- Deployment trigger (`POST /api/hackathon/projects/:id/deploy`) transitions the project to `deployed` (Live Production).

---

## 3. Database Schema

All data is persistently stored in SQLite (`server/db/hackathonRepository.ts`) using Write-Ahead Logging (WAL):

1. **`hackathon_projects`**:
   - `id` (TEXT PRIMARY KEY)
   - `name` (TEXT)
   - `problem_statement` (TEXT)
   - `rules` (TEXT)
   - `available_time` (TEXT)
   - `developer_count` (INTEGER)
   - `skill_levels` (TEXT)
   - `technologies` (TEXT JSON)
   - `budget_constraints` (TEXT)
   - `judging_criteria` (TEXT)
   - `status` (TEXT: ideation, architecture, planning, development, integration, released, deployed)
   - `selected_idea_id` (TEXT)
   - `architecture_version` (INTEGER)
   - `host_id` (TEXT)
   - `created_at`, `updated_at` (TEXT ISO)

2. **`hackathon_ideas`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `name`, `pitch`, `problem`, `target_users`, `usp` (TEXT)
   - `core_features`, `suggested_tech`, `technical_risks` (TEXT JSON)
   - `mvp_difficulty` (TEXT)
   - `time_feasibility`, `demo_scenario`, `judging_alignment` (TEXT)
   - `version` (INTEGER)
   - `is_selected` (INTEGER BOOLEAN)
   - `created_at` (TEXT ISO)

3. **`hackathon_feedback`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `role` (TEXT: user, assistant)
   - `message` (TEXT)
   - `timestamp` (TEXT ISO)

4. **`hackathon_architecture`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `version` (INTEGER)
   - `is_approved` (INTEGER BOOLEAN)
   - `approved_at` (TEXT ISO)
   - `spec_json`, `technical_json`, `contracts_json`, `roadmap_json` (TEXT JSON)
   - `created_at` (TEXT ISO)

5. **`hackathon_team`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `name`, `email` (TEXT)
   - `role` (TEXT: host, member, viewer)
   - `assigned_slot` (TEXT: developer-a, developer-b, developer-c, host)
   - `connected_tool` (TEXT)
   - `invite_token` (TEXT)
   - `is_joined` (INTEGER BOOLEAN)
   - `last_heartbeat_at`, `joined_at` (TEXT ISO)

6. **`hackathon_tasks`**:
   - `task_id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `title`, `assigned_role`, `status`, `priority` (TEXT)
   - `objective` (TEXT)
   - `dependencies_json`, `allowed_paths_json`, `protected_paths_json` (TEXT JSON)
   - `inputs_json`, `deliverables_json`, `acceptance_criteria_json` (TEXT JSON)
   - `owner_json`, `evidence_json` (TEXT JSON)
   - `lease_expiration` (TEXT ISO)
   - `progress_percent` (INTEGER)
   - `created_at`, `updated_at` (TEXT ISO)

7. **`hackathon_handoffs`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `source_task_id`, `source_role`, `target_task_id`, `target_role` (TEXT)
   - `request_summary` (TEXT)
   - `contract_details_json` (TEXT JSON)
   - `status` (TEXT: pending, accepted, resolved, rejected)
   - `resolution_notes` (TEXT)
   - `created_at`, `updated_at` (TEXT ISO)

8. **`hackathon_releases`**:
   - `id` (TEXT PRIMARY KEY)
   - `project_id` (TEXT FK)
   - `target_version` (TEXT)
   - `colliding_files_json`, `tasks_included_json` (TEXT JSON)
   - `test_status` (TEXT: pending, passed, failed)
   - `test_summary` (TEXT)
   - `release_approved` (INTEGER BOOLEAN)
   - `approved_by` (TEXT)
   - `approved_at` (TEXT ISO)
   - `deployment_status` (TEXT: pending, in_progress, live, failed)
   - `deployment_url` (TEXT)
   - `deployed_at` (TEXT ISO)

---

## 4. Real-time Event Streaming (SSE)

Clients connect to `GET /api/hackathon/projects/:id/events/stream` via HTTP Server-Sent Events.
The coordinator emits real-time updates without polling:
- `PROJECT_UPDATED`
- `IDEAS_GENERATED`
- `IDEAS_REFINED`
- `IDEA_SELECTED`
- `ARCHITECTURE_GENERATED`
- `ARCHITECTURE_APPROVED`
- `TASKS_GENERATED`
- `TASK_CLAIMED`
- `TASK_PROGRESS`
- `TASK_SUBMITTED`
- `TASK_APPROVED`
- `HANDOFF_CREATED`
- `HANDOFF_RESOLVED`
- `INTEGRATION_CHECKED`
- `RELEASE_APPROVED`
- `RELEASE_DEPLOYED`

When an event is received, connected browsers automatically re-render without page refresh.
