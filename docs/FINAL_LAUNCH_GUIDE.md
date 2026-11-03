# UPSIDE-DOWN — FINAL SYSTEM LAUNCH & OPERATOR GUIDE
**Baseline Protocol:** `UD-IC/1.0`  
**Repository Branch:** `integration/final-mvp`  
**Target Environment:** Node.js v24+ / Windows / macOS / Linux  
**Author:** `[DikshantDuggal's Antigravity]`

---

## 1. Quick Start (One Command Launch)

To launch the complete multi-computer collaboration platform with all services:

```bash
npm run dev:all
```

The unified orchestrator (`scripts/dev-all.js`) executes:
1. **Pre-flight verification:** Checks Node.js >= 20 and npm.
2. **Dependency validation:** Verifies packages in root, `client-local/`, and `web/`.
3. **Database access:** Confirms write permissions for SQLite databases in `data/` and `client-local/data/`.
4. **Port check & auto-clearing:** Frees ports `4000`, `4100`, and `5173`.
5. **Credential synchronization:** Generates/syncs device tokens and separate reviewer tokens.
6. **Coordinator startup (Computer A):** Starts authoritative coordinator on `http://localhost:4000`.
7. **Client-local startup (Computer B):** Starts offline synchronization service on `http://localhost:4100`.
8. **Official frontend (web/):** Starts Vite dev server on `http://localhost:5173`.
9. **Real-time color-coded logging:** Streams `[COORDINATOR:4000]`, `[LOCAL-SYNC:4100]`, and `[FRONTEND:5173]`.

---

## 2. Port Topology & Service Architecture

| Service | Port | Process / Path | Role & Technology |
| :--- | :---: | :--- | :--- |
| **Official Frontend** | `:5173` | `web/` | React 19 / Vite / Tailwind UI. Proxies `/api` & `/local` to `:4100`. |
| **Client-Local Service** | `:4100` | `client-local/` | Computer B offline engine. Durable SQLite WAL outbox, browser pairing, CSRF protection. |
| **Authoritative Coordinator** | `:4000` | `server/` | Computer A coordinator. Sequence validation, epoch journal, conflict quarantine, repair engine. |

```
Browser (:5173) 
     │ (Same-Origin / Proxy)
     ▼
Client-Local Service (:4100) 
     │ [Offline Outbox / SQLite WAL]
     │ (UD-IC/1.0 Sync: POST /api/sync/push, GET /api/sync/pull)
     ▼
Authoritative Coordinator (:4000)
     │ [Authoritative SQLite WAL / Execution Engine]
```

---

## 3. Multi-Computer LAN Configuration (Computer A <-> Computer B)

When running on separate physical machines (Computer A: Dikshant, Computer B: Arhaan):

### On Computer A (Coordinator Host — Dikshant)
1. Find your local IPv4 address (e.g. `192.168.1.105`):
   ```powershell
   ipconfig | findstr "IPv4"
   ```
2. Start the coordinator listening on all interfaces:
   ```bash
   npm start
   # Or using PowerShell:
   .\scripts\start-coordinator.ps1
   ```
3. Share your coordinator URL with Computer B:
   `http://192.168.1.105:4000`

### On Computer B (Sync Client — Arhaan)
1. Configure `client-local` to point to Computer A's LAN IP:
   ```powershell
   $env:UD_COORDINATOR_URL = "http://192.168.1.105:4000"
   npm --prefix client-local start
   # Or using PowerShell:
   .\scripts\start-client-local.ps1 -CoordinatorUrl "http://192.168.1.105:4000"
   ```
2. Launch the frontend:
   ```powershell
   npm --prefix web run dev
   ```
3. Open `http://localhost:5173` in your browser. Mutations created on Computer B will sync over the local network to Computer A!

---

## 4. Authentication & Security Architecture

### Zero-Trust Credential Model
- **Device Tokens (`role: "device"`):** Used exclusively by `client-local` background workers to push and pull sync batches. Device tokens are strictly forbidden from executing reviewer operations (patch approval, patch apply, conflict resolution).
- **Reviewer Tokens (`role: "reviewer"`):** Separate, high-privilege credentials. Stored securely in `data/reviewer-token.txt` and `client-local/data/reviewer-token.txt`.
- **Elimination of Untrusted Headers:** The server never trusts client-supplied `X-Principal-Role` or string pattern matching. All tokens are verified server-side against enrolled credentials in `server/core/auth.ts`.
- **Protected Actions:**
  - `POST /api/patches/:id/approve` -> Requires verified reviewer credentials (`AuthManager.requireReviewer()`).
  - `POST /api/patches/:id/apply` -> Requires verified reviewer credentials + valid checksum & revision.
  - `POST /api/sync/conflicts/:id/resolve` -> Requires verified reviewer or admin credentials.

---

## 5. Offline Outbox & Conflict Resolution Protocol

### Offline Durability
1. When disconnected from Computer A, user commands on Computer B are committed into local SQLite WAL outbox (`client-local/data/device-b.db`).
2. Each command receives a monotonic sequence number (`1, 2, 3...`) and local receipt.
3. Upon network reconnection, `SyncWorker` automatically flushes pending items using atomic push batches (`POST /api/sync/push`).
4. Computer A validates sequence monotonicity:
   - Duplicate events -> Returns cached ACK with `duplicate: true`, zero side-effects.
   - Sequence gaps -> Returns `status: "retry"` with `error.code: "SEQUENCE_GAP"` and `expectedSequence`.

### Concurrency Conflicts
- When mutations are submitted against a stale task revision, Computer A does NOT overwrite data.
- The mutation is quarantined into `conflicts_v1` as an open `ConflictRecordV1`.
- A reviewer inspects the conflict on the dashboard and resolves it using `POST /api/sync/conflicts/:id/resolve` (`keep_authoritative`, `retry_proposal`, or `custom_transition`).

---

## 6. Frontend Management & Rollback Operations

The platform supports seamless switching between the official team frontend (`web/`) and the demo cockpit (`apps/demo-frontend/`):

```bash
# Check active frontend status
npm run frontend:status

# Activate Official Team Frontend (web/)
npm run frontend:activate

# Rollback to Demo Frontend (apps/demo-frontend/)
npm run frontend:rollback
```

All switches preserve backend SQLite state and active task revisions without downtime.

---

## 7. Verification Test Suite Commands

Run automated verification across all layers:

```bash
# 1. Full Root Integration Suite (9 suites / 58 tests)
npm test

# 2. Multi-Computer Integration Test
npm run test:multi-computer

# 3. Client-Local Sync Suite (17 tests)
npm --prefix client-local test

# 4. Canonical Sync Gateway Router Suite (4 tests)
npm --prefix server/sync test

# 5. Web Frontend Vitest Suite (35 tests)
npm --prefix web test

# 6. Web Production Build
npm --prefix web run build
```

**Total: 114/114 passing automated tests with zero failures.**
