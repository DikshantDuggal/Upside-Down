# Upside-Down: Frontend Handoff & Replacement System Documentation

**Project:** Upside-Down — Offline-First Multi-Agent Coding Collaboration Platform  
**Target Architecture:** Isolated Demo Frontend + Command-Driven Official Frontend Replacement Engine  
**Version:** 1.0.0  
**Date:** November 4, 2026  

---

## 1. Overview & Architecture

To support live hackathon demonstrations without interfering with the teammate independently authoring the official frontend, Upside-Down implements a **dual-frontend architecture with non-destructive activation**:

1. **`DEMO FRONTEND` (`apps/demo-frontend/`):**
   A premium, dark-mode SaaS dashboard inspired by Linear and Vercel. Connects to real backend REST endpoints and live Server-Sent Events (SSE). Disposable and isolated.
2. **`TEAM FRONTEND` (`frontend/`):**
   The official frontend implementation developed independently by the assigned frontend engineer.

```
+-------------------------------------------------------------+
|             Frontend Activation Controller                  |
|            (server/core/frontendController.ts)              |
+-------------------------------------------------------------+
                              |
              +---------------+---------------+
              |                               |
              v                               v
    [ apps/demo-frontend ]             [ frontend/ ]
     Premium Demo Cockpit          Official Team Frontend
      (public/demo/app.js)          (public/team/app.js)
              |                               |
              +---------------+---------------+
                              |
                              v
                  [ Active Public Route ]
                      (GET / and static)
                              |
                              v
                +----------------------------+
                |    Express REST & SSE      |
                |   Coordinator Backend      |
                |   (data/upside_down.db)    |
                +----------------------------+
```

---

## 2. Safety & Data Preservation Guarantees

During frontend validation, activation, or rollback:

- **Backend Services:** Express server and API routes remain active and unchanged.
- **Database & Data:** SQLite database (`data/upside_down.db`), tasks, projects, handoffs, and activity events are **never modified or reset**.
- **Shared Contracts:** `contracts/task.ts`, `contracts/agent.ts`, `contracts/events.ts`, `contracts/sync.ts`, `contracts/project.ts`, and `contracts/handoff.ts` remain intact.
- **Demo Source:** `apps/demo-frontend/` is preserved in the repository; it is not deleted.
- **Git Safety:** Other teammates' working branches and cursors remain completely untouched.

---

## 3. Command Reference

The system supports 3 explicit commands via CLI or npm scripts.

### Command A: Check Frontend Status

**Codex / System Command:**
```text
UPSIDE-DOWN: FRONTEND_STATUS
```

**Terminal Execution:**
```powershell
npm run frontend:status
# or: node scripts/frontend-manager.js status
```

**Output Details:**
- Currently active frontend (`DEMO` or `TEAM`).
- Active frontend name, version, and source directory.
- Serving directory (`public/demo` or `public/team`).
- Bundle and HTML entrypoint status.
- Rollback availability and last activation timestamp.

---

### Command B: Activate Official Team Frontend

**Codex / System Command:**
```text
UPSIDE-DOWN: ACTIVATE_TEAM_FRONTEND
```

**Terminal Execution:**
```powershell
# Standard activation from default `frontend/` directory:
npm run frontend:activate

# Or specify a custom candidate directory:
node scripts/frontend-manager.js activate "C:\path\to\candidate\frontend"
```

**Validation & Safety Sequence (Executed Automatically):**
1. **Locates Candidate:** Verifies target directory exists.
2. **Validates Entrypoint:** Verifies presence of `src/index.tsx`, `src/index.ts`, `src/App.tsx`, or `index.html`.
3. **Pre-Flight Test Compile:** Executes a dry bundle check using `esbuild` to verify syntax and dependency resolution.
4. **Safety Abort:** If validation fails, activation is immediately rejected with error diagnostics, keeping the working demo frontend online.
5. **Rollback Snapshot:** Records the previous frontend identifier in `config/frontend.json`.
6. **Compiles Bundle:** Builds `public/team/app.js` and stages HTML entrypoint.
7. **Switches Active Route:** Express dynamically updates the serving path to `public/team` without requiring database restarts.

---

### Command C: Rollback Frontend

**Codex / System Command:**
```text
UPSIDE-DOWN: ROLLBACK_FRONTEND
```

**Terminal Execution:**
```powershell
npm run frontend:rollback
# or: node scripts/frontend-manager.js rollback
```

**Rollback Sequence:**
1. Verifies that `rollbackAvailable` is `true`.
2. Locates the previous known-good frontend configuration (`demo`).
3. Verifies that the previous bundle and HTML assets exist.
4. Restores active frontend to `demo` in `config/frontend.json`.
5. Re-arms Express static serving.

---

## 4. REST API Endpoints

The frontend replacement controller is also exposed via HTTP API for UI control:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/frontend/status` | `GET` | Returns JSON status of active frontend and rollback info |
| `/api/frontend/activate` | `POST` | Validates and activates team frontend (`{ candidatePath?: string }`) |
| `/api/frontend/rollback` | `POST` | Rolls back to the previously active frontend |

---

## 5. How to Run the Demo Frontend

### Step 1: Build the Demo Bundle
```powershell
npm run build:demo
```
This bundles `apps/demo-frontend/src/index.tsx` into `public/demo/app.js` (269 KB).

### Step 2: Start the Platform
```powershell
npm start
```
Starts Express on `http://localhost:4000/`.

### Step 3: Open in Browser
Navigate to **`http://localhost:4000/`**.

**Features Available in the Cockpit:**
- **Command Center:** Real-time metrics on agents, tasks, reviews, and sync health.
- **Multi-Agent Workspace:** Status cards for all 4 project roles, active task assignments, and topology links.
- **Kanban Board:** Linear-style columns (*Backlog, Assigned, In Progress, Review, Completed*), task creator modal, and task promotion buttons.
- **Handoff & Comms Center:** Inspect inter-agent contracts, dependencies, and payload schemas.
- **Live Timeline:** Real-time event stream via SSE.
- **Project & Contracts:** Shared architecture contracts and milestone progress.
- **Settings & Replacement:** Interactive 1-click team frontend activation, rollback, and offline outbox flusher.
- **Patch Reviewer:** Unified diff viewer with syntax highlights and human approval controls.
