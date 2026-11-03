# UPSIDE-DOWN — HACKATHON LAUNCH & OPERATOR GUIDE
**Protocol Baseline:** `UD-IC/1.0`  
**Integration Baseline:** `integration/final-mvp`  
**Author / Integration Lead:** `[DikshantDuggal's Antigravity]`  
**Status:** **ACTIVE / VERIFIED HACKATHON LAUNCHER** 🚀

---

## 1. Quick Start: The One-Command Launch

Upside-Down integrates the Authoritative Coordinator, the Client-Local Sync Service, and the Official React 19 Frontend under a single command:

```bash
# From repository root (C:\Users\diksh\OneDrive\Documents\ChatGPT\bruh\Upside-Down)
npm run dev:all
```

This single command automatically:
1. Validates Node.js (`>=20.0.0`) and npm (`>=11.0.0`).
2. Checks that port 4000, port 4100, and port 5173 are available (auto-clearing any stale processes).
3. Synchronizes zero-trust token credentials between services (`device-token.txt` and `reviewer-token.txt`).
4. Launches **Computer A (Authoritative Coordinator)** on port `4000`.
5. Launches **Computer B (Client-Local Sync Service)** on port `4100`.
6. Launches **Official Team Frontend (Vite / React 19)** on port `5173`.
7. Displays LAN discovery targets for connecting teammate laptops.

---

## 2. Integrated Ports & Service Endpoints

| Port | Service Component | Technology | Role & Ownership | Primary Purpose |
| :---: | :--- | :--- | :--- | :--- |
| **`:5173`** | **Official Team Frontend** | React 19, Vite, Tailwind | Guragam Singh (Role 3) | Primary interactive developer dashboard. Connects through port 4100. |
| **`:4100`** | **Client-Local Sync Engine** | Node.js, SQLite WAL | Arhaan Arora (Role 4) | Offline-first sync proxy, SQLite WAL outbox, session pairing, CSRF protection. |
| **`:4000`** | **Authoritative Coordinator** | Express, SQLite WAL | Dikshant Duggal (Role 1 & 2) | Canonical event journal, monotonic sequencing, conflict quarantine, repair engine. |
| **`:4000/`** | **Demo Cockpit (Fallback)** | Pre-bundled HTML/JS | Dikshant Duggal | Instant zero-downtime rollback cockpit managed via `scripts/frontend-manager.js`. |

---

## 3. Health Checks & Verification Endpoints

You can verify that all three services are actively responding using any browser or CLI tool:

### 1. Coordinator Health (Port 4000)
```bash
curl http://127.0.0.1:4000/api/health
# Response: {"status":"ok","timestamp":"..."}

curl http://127.0.0.1:4000/api/capabilities
# Response: {"contractVersion":"UD-IC/1.0","coordinatorEpoch":"...","features":{...}}
```

### 2. Client-Local Sync Service (Port 4100)
```bash
# Requires header X-UD-Contract: UD-IC/1.0
curl -H "X-UD-Contract: UD-IC/1.0" http://127.0.0.1:4100/local/session
# Response: {"contractVersion":"UD-IC/1.0"}
```

### 3. Official Web Frontend (Port 5173)
```bash
curl -I http://127.0.0.1:5173/
# Response: HTTP/1.1 200 OK (Content-Type: text/html)
```

---

## 4. Resetting Between Live Demonstrations

When giving multiple demonstrations to different judging panels, you can reset all disposable tasks, activity events, queued outbox commands, and conflict logs to a pristine clean state:

```bash
npm run demo:reset
```

### What `demo:reset` Does:
- **Clears Coordinator Data:** Empties `tasks`, `activity_events`, `conflicts`, `handoffs`, `patches`, `canonical_journal`, and `sync_outbox`.
- **Clears Client-Local Data:** Empties `outbox`, `requests`, `inbox`, `entities`, and `cache`.
- **Preserves Critical Infrastructure:** Keeps all source code, git branches, repository checkpoints, and enrolled device/reviewer authentication tokens intact so re-pairing is immediate.

---

## 5. Clean Shutdown and Restart Procedures

### Graceful Termination
Press **`Ctrl + C`** in the terminal where `npm run dev:all` is running.  
The orchestrator traps `SIGINT` and `SIGTERM` signals and cleanly terminates all child processes.

### Force-Clearing Lingering Ports (Troubleshooting)
If a process failed to release a port or was killed abruptly:

**On Windows (PowerShell):**
```powershell
# Clear any lingering listeners on 4000, 4100, or 5173
Get-NetTCPConnection -LocalPort 4000,4100,5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**On macOS / Linux:**
```bash
lsof -ti:4000,4100,5173 | xargs kill -9
```

---

## 6. Frontend Management & Rollback

Upside-Down includes a dedicated zero-downtime frontend controller:

```bash
# Check current active frontend
npm run frontend:status

# Activate official team frontend (web/)
npm run frontend:activate -- web

# Rollback immediately to demo cockpit (apps/demo-frontend)
npm run frontend:rollback
```
