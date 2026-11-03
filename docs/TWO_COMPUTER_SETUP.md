# UPSIDE-DOWN — TWO-COMPUTER PHYSICAL SETUP & ONBOARDING GUIDE
**Protocol Baseline:** `UD-IC/1.0`  
**Target Roles:** Computer A (Dikshant Duggal / Coordinator) & Computer B (Arhaan Arora / Sync Engine)  
**Branch:** `integration/final-mvp`  
**Author:** `[DikshantDuggal's Antigravity]`  

---

## 1. Physical Node Architecture

```
+-------------------------------------------------------------+        +-------------------------------------------------------------+
|               PHYSICAL COMPUTER A (Dikshant)                |        |                 PHYSICAL COMPUTER B (Arhaan)                |
|               Authoritative Coordinator Host                |        |              Offline Client-Local & UI Node                 |
|                                                             |        |                                                             |
|   +-----------------------------------------------------+   |        |   +-----------------------------------------------------+   |
|   |         Coordinator Service (Port 4000)             |   |        |   |       Client-Local Sync Service (Port 4100)         |   |
|   |   - Canonical Event Journal (/api/sync/pull)        |   |  LAN   |   |   - Native SQLite WAL Outbox (device-b.db)          |   |
|   |   - Monotonic Sequence Guard (/api/sync/push)       |<===========|   |   - Full-Jitter Background Reconnect Worker         |   |
|   |   - Concurrency Conflict Quarantine (conflicts_v1)  |   | (HTTP) |   |   - Local Browser Pairing & CSRF Engine             |   |
|   |   - Verified Two-Phase Patch Application Engine     |   |        |   +-----------------------------------------------------+   |
|   +-----------------------------------------------------+   |        |                              ^                              |
|                              ^                              |        |                              | HTTP/SSE (Port 4100)         |
|                              |                              |        |                              v                              |
|   +-----------------------------------------------------+   |        |   +-----------------------------------------------------+   |
|   |     Live Web Cockpit (http://localhost:4000/)       |   |        |   |      Official Team Web Frontend (Port 5173)         |   |
|   |          (Fallback / Demonstration UI)              |   |        |   |           (http://localhost:5173/)                  |   |
|   +-----------------------------------------------------+   |        |   +-----------------------------------------------------+   |
+-------------------------------------------------------------+        +-------------------------------------------------------------+
```

---

## 2. Pre-Requisites & Network Configuration

1. **Shared Wi-Fi Network / Hotspot:**
   Both laptops must be connected to the same Wi-Fi router or mobile phone hotspot.
2. **Node.js Runtime:**
   Node.js version **>= 20.0.0** (Node v24 recommended) installed on both machines.
3. **Firewall Inbound Access on Computer A (Dikshant):**
   Windows Defender Firewall must allow incoming TCP traffic on port `4000`.
   
   To quickly allow port 4000 on Computer A in PowerShell (Run as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "Upside-Down Coordinator" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow
   ```

---

## 3. Computer A Setup (Dikshant Duggal)

1. **Navigate to Repository Root:**
   ```powershell
   cd C:\Users\diksh\OneDrive\Documents\ChatGPT\bruh\Upside-Down
   git checkout integration/final-mvp
   ```
2. **Start the Authoritative Coordinator:**
   ```powershell
   .\scripts\start-coordinator.ps1
   ```
   *Alternatively, if running the unified full stack on Computer A: `npm run dev:all`*

3. **Identify Coordinator LAN IPv4 Address:**
   The startup script will print the detected local IP addresses:
   ```
   Detecting local IPv4 addresses for Computer B (Arhaan's client-local):
     -> Coordinator LAN Target: http://192.168.69.195:4000
   ```
   **Share this IP address with Arhaan (Computer B).**

---

## 4. Computer B Setup (Arhaan Arora)

1. **Pull Latest Code on Computer B:**
   ```bash
   git clone https://github.com/DikshantDuggal/Upside-Down.git
   cd Upside-Down
   git checkout integration/final-mvp
   git pull origin integration/final-mvp
   ```

2. **Install Local Dependencies:**
   ```bash
   npm --prefix client-local install
   npm --prefix web install
   ```

3. **Launch the Client-Local Sync Service:**
   Pass Computer A's LAN IP address to the startup script:

   **On Windows (PowerShell):**
   ```powershell
   .\scripts\start-client-local.ps1 -CoordinatorUrl "http://192.168.69.195:4000" -LocalPort 4100
   ```

   **On macOS / Linux (Bash):**
   ```bash
   export UD_COORDINATOR_URL="http://192.168.69.195:4000"
   export UD_LOCAL_PORT="4100"
   export UD_DEVICE_DB="./data/device-b.db"
   cd client-local
   npm start
   ```

4. **Launch the Official Team Frontend on Computer B:**
   In a second terminal window on Computer B:
   ```powershell
   .\scripts\start-frontend.ps1
   ```
   *Or:*
   ```bash
   cd web
   npm run dev
   ```

5. **Complete Browser Pairing:**
   - Open browser on Computer B at **`http://localhost:5173/`**.
   - When the pairing screen appears, copy the pairing key generated on Computer B located at:
     `client-local/data/device-b.db.session.json`
   - Paste the `pairingKey` string into the browser pairing input and click **Pair Device**.
   - The green badge **"Device Paired & Connected"** will illuminate.

---

## 5. Live Two-Computer Demonstration Runbook

### Step 1: Real-Time Synchronization (Both Laptops Online)
1. On Computer B (Arhaan), create a new task:
   - Title: `Implement Distributed Cache Layer`
   - Owner: `agent-backend-antigravity`
2. Click **Queue task**.
3. **Observe Computer A:** Look at Computer A's dashboard (`http://localhost:4000/`) or terminal logs. The task appears immediately without manual page refresh, streamed via live SSE events!

### Step 2: Live Message Passing Across Laptops
1. In the **Messages** pane on Computer B, type:
   `"Hey Dikshant! Client-Local outbox is active on Computer B. Ready for handoff."`
2. Click **Queue message**.
3. Notice Computer A's activity journal displays the message event with monotonic sequence and origin device ID.

### Step 3: Offline Disconnection & Durability Demonstration
1. **Disconnect Wi-Fi on Computer B (Arhaan):** Turn off Wi-Fi or unplug Ethernet.
2. The UI on Computer B updates the network badge to **"Offline (Queueing locally)"**.
3. Create two new tasks on Computer B while offline:
   - Task 1: `Audit In-Memory Store Serialization`
   - Task 2: `Add Checkpoint Rollback Tracing`
4. Inspect Computer B's terminal or run `npm --prefix client-local test`: the tasks are durably recorded in SQLite WAL (`client-local/data/device-b.db`) with monotonic sequence numbers (e.g. sequence 2, sequence 3).
5. **Simulate Crash:** Kill the terminal process running `client-local` on Computer B, then restart it. Notice zero tasks were lost.

### Step 4: Reconnection & Zero-Loss Outbox Flush
1. **Reconnect Wi-Fi on Computer B:** Turn Wi-Fi back on.
2. The background transport on Computer B detects connectivity with exponential jitter.
3. Computer B pushes the batched outbox envelopes to Computer A's `/api/sync/push`.
4. Computer A validates monotonic sequence continuity (`expectedSequence`), commits tasks in a single database transaction, and returns ACK `status: "applied"`.
5. Computer A broadcasts canonical events; Computer B pulls and converges authoritative state exactly once.

### Step 5: Concurrency Conflict Quarantine & Resolution
1. On Computer A, transition a task to revision 3.
2. On Computer B, attempt to transition the same task using stale baseRevision 2.
3. Computer A detects the revision mismatch and **quarantines** the mutation into `conflicts_v1` (zero silent overwrite).
4. Reviewer on Computer A (or authorized reviewer interface) resolves the conflict:
   - Choose `keep_authoritative` or `apply_proposal`.
5. Both machines update and converge cleanly.

---

## 6. Physical vs. Loopback Verification Status

- **Loopback Two-Node Verification:** **PASS ✅ (Automated)**
  Fully verified across independent HTTP processes with disk-isolated databases via `npm run test:multi-computer` and `npm run test:acceptance`.
- **Physical LAN Verification:** **READY FOR HARDWARE PAIRING ⚠️**
  Follow the steps in Section 3 and 4 above when Arhaan's physical laptop is present on the same network.
