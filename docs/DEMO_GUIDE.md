# Upside-Down 2.0: Hackathon Judge Demo Guide
## 5-Minute End-to-End Walkthrough Script

Follow this script to demonstrate the complete, autonomous lifecycle of Upside-Down 2.0 to hackathon judges.

---

## Pre-Demo Quickstart

1. Start the authoritative backend:
   ```bash
   npm start
   # Coordinator runs at http://127.0.0.1:4000
   ```
2. Start the Vite React frontend:
   ```bash
   npm --prefix web run dev
   # Frontend runs at http://127.0.0.1:5173
   ```
3. Open `http://127.0.0.1:5173` in your browser.

---

## Step-by-Step Demo Script

### 1. Mission Control Overview (1 Minute)
- **What to show:**
  - The header displaying **UPSIDE DOWN 2.0 • MISSION CONTROL**.
  - Project banner showing problem statement: *"Multi-agent coding collaboration suffers from fragmented context, merge conflicts, and uncoordinated task execution."*
  - Hackathon countdown timer (`23h remaining`) and 7-stage interactive pipeline progress bar.
- **Judge Talking Point:**
  > *"Most hackathon teams struggle not because they lack AI coding tools, but because their tools run uncoordinated — generating conflicting schemas, stomping on each other's code, and wasting critical hours. Upside-Down 2.0 is the autonomous mission control that guides a 2-3 developer team from problem statement to deployable software."*

### 2. Stage 1: AI Idea Studio & Feedback Refinement (1 Minute)
- **What to do:**
  - Navigate to **AI Idea Studio** in the left sidebar.
  - Click **"Generate 3–5 Ideas"** (instant response via built-in AI Coordinator).
  - Observe the 3 distinct concepts generated with Feasibility, MVP Difficulty, Core Features, and Judging Alignment.
  - In the refinement chatbox, type: *"Make concept #1 more mobile-friendly"* and click Send.
  - Observe the refined concept update in real time.
  - Click **"Select Idea & Lock Decision"** on your chosen concept.
- **Judge Talking Point:**
  > *"The platform doesn't just generate text; it establishes an immutable human-in-the-loop decision, unlocking the next engineering phase."*

### 3. Stage 2: Architecture Blueprint & API Contracts (45 Seconds)
- **What to do:**
  - The UI automatically transitions to **Architecture Blueprint**.
  - Show the 4 pillars:
    1. **System Specification:** User journeys, MVP features, success criteria.
    2. **Technical Architecture:** React 19, Express, SQLite, SSE.
    3. **Formal API Contracts Table:** Concrete endpoints (`POST /api/auth`, `GET /api/data`, etc.) with HTTP verbs and descriptions.
    4. **7-Phase Time-Aware Roadmap:** Hours breakdown from Phase 1 to Phase 7.
  - Click **"Approve Architecture & Decompose Tasks"**.
- **Judge Talking Point:**
  > *"Before writing any code, Upside-Down establishes concrete API contracts and a 7-phase roadmap, ensuring teammates and agents work to the exact same specifications."*

### 4. Stage 3: Multi-Agent Work Division & Prompt Bridges (1 Minute)
- **What to do:**
  - The UI automatically loads **Work Contracts (2.0)** (Kanban board).
  - Point out strict path boundaries on cards:
    - *Task 1 (Frontend):* Allowed paths `web/src/features/*`, protected paths `server/*`.
    - *Task 2 (Backend):* Allowed paths `server/api/*`, protected paths `web/*`.
    - *Task 3 (AI Integration):* Allowed paths `server/core/*`.
  - Click on Task 1 to open the Task Detail Modal.
  - Click **"Copy Prompt Bridge"** and switch tool dropdown between **Google Antigravity**, **Claude Code**, and **OpenAI Codex**.
  - Show how the generated prompt dynamically adapts instructions, tool constraints, and path whitelists for each AI CLI.
- **Judge Talking Point:**
  > *"Every task contract defines strict allowed file paths. The Prompt Bridge allows teammates to copy-paste mathematically bounded assignments into Antigravity, Claude Code, or Cursor without risking merge conflicts."*

### 5. Stage 4: Cross-Agent Handoffs (45 Seconds)
- **What to do:**
  - Navigate to **Agent Handoffs**.
  - Click **"Create Handoff Request"**:
    - Source: Frontend Task (`TASK-001`)
    - Target: Backend Task (`TASK-002`)
    - Summary: *"Need POST /api/auth/register returning JWT token and user profile"*
  - Click Create. Point out the live status badge `pending`.
  - Click **"Resolve Handoff"**, add notes *"Endpoint implemented and verified with tests"*, and submit.
  - The badge immediately updates to `resolved` across all connected browsers via Server-Sent Events.
- **Judge Talking Point:**
  > *"When an agent is blocked waiting for an interface, it doesn't get stuck in an hallucination loop. It registers a structured handoff that notifies the responsible developer or agent."*

### 6. Stage 5: Collision Engine, Host Release Approval & Deploy (45 Seconds)
- **What to do:**
  - Navigate to **Release & Deploy**.
  - Click **"Run Automated Collision Check"**.
  - Show the check results:
    - Collision status: **Passed (0 file collisions detected)**.
    - Contract conformance: **Verified**.
    - Unit & Integration Test Status: **Passed (12 test suites, 100% passing)**.
  - Demonstrate the **Host Release Gatekeeper**:
    - Point out that AI agents cannot deploy without host approval.
    - Type Host name: *"Dikshant Duggal"* and click **"Approve Release Candidate"**.
    - Click **"Deploy to Production"**.
    - The status badge in the top right immediately turns to **LIVE PROD**!
- **Judge Talking Point:**
  > *"Upside-Down guarantees safety: path collisions are detected mathematically before merging, automated test suites must pass, and the human host signs the release before triggering deployment."*
