/**
 * Multi-Computer End-to-End Integration Test Suite
 * Baseline: UD-IC/1.0
 * Architecture:
 *   - Computer A: Authoritative Coordinator & Execution Engine (Port 4000 / Test Port)
 *   - Computer B: Offline Sync Engine & Local SQLite Outbox (Port 4100 / Test Port)
 *   - Frontend: Official Team Web Dashboard & Demo Cockpit
 */

import http from "node:http";
import assert from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createServer } from "../index.ts";
import { LocalStore } from "../../client-local/src/store.ts";
import { CoordinatorClient, SyncWorker } from "../../client-local/src/transport.ts";
import { createLocalService } from "../../client-local/src/server.ts";

async function runMultiComputerTests(): Promise<void> {
  console.log("=== MULTI-COMPUTER END-TO-END INTEGRATION TEST SUITE (UD-IC/1.0) ===");

  // 1. Setup Computer A (Authoritative Coordinator)
  const { app: appA, db: dbA, coordinator: coordA } = createServer(":memory:");
  const serverA = http.createServer(appA);
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", () => resolve()));
  const portA = (serverA.address() as AddressInfo).port;
  const urlA = `http://127.0.0.1:${portA}`;
  console.log(`[COMPUTER A] Coordinator online at ${urlA}`);

  // 2. Setup Computer B (Offline Client Store & Local Service)
  const tempDirB = mkdtempSync(join(tmpdir(), "ud-comp-b-"));
  const dbPathB = join(tempDirB, "device-b.db");
  const storeB = new LocalStore(dbPathB);
  const deviceToken = "device-token-auth-" + randomUUID();
  const reviewerToken = "reviewer-token-auth-" + randomUUID();
  const pairingKey = randomBytes(32).toString("hex");

  const clientB = new CoordinatorClient(urlA, deviceToken);
  const reviewerClientB = new CoordinatorClient(urlA, reviewerToken);
  const serviceB = await createLocalService({
    store: storeB,
    client: clientB,
    reviewerClient: reviewerClientB,
    pairingKey,
    port: 0,
    allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"],
    startWorker: false, // We'll trigger ticks deterministically
  });
  console.log(`[COMPUTER B] Local service online at ${serviceB.origin} (Device: ${storeB.deviceId})`);

  const workerB = new SyncWorker(storeB, clientB);

  try {
    // -------------------------------------------------------------
    // Test 1: Discovery, Capabilities, and Health Handshake
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 1: Discovery & Protocol Verification (UD-IC/1.0)...");
    const capRes = await clientB.request("/api/capabilities");
    assert.strictEqual(capRes.contractVersion, "UD-IC/1.0");
    assert.strictEqual(capRes.features.sync, true);
    assert.strictEqual(capRes.features.patchApply, true);

    const healthRes = await clientB.request("/api/health");
    assert.strictEqual(healthRes.status, "ok");
    assert.strictEqual(healthRes.role, "Role 1: Core Backend & Coordinator");
    console.log("  [PASS] Computer B successfully verified Computer A contract and capabilities.");

    // -------------------------------------------------------------
    // Test 2: Local Session Pairing on Computer B
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 2: Browser Pairing & Session Bootstrap on Computer B...");
    const pairRes = await fetch(`${serviceB.origin}/local/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({ pairingKey }),
    });
    assert.strictEqual(pairRes.status, 200);
    const sessionData = (await pairRes.json()) as any;
    assert.ok(sessionData.csrfToken, "CSRF token must be issued on pairing");
    const csrfToken = sessionData.csrfToken;
    const cookie = pairRes.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(cookie.startsWith("ud_local="), "Cookie must be set on pairing");
    console.log(`  [PASS] Browser paired with Computer B. CSRF token & session cookie secured.`);

    // -------------------------------------------------------------
    // Test 3: Local Command Enqueue & Push to Computer A
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 3: Creating Task on Computer B -> Pushing to Authoritative Coordinator A...");
    const clientTaskId = randomUUID();
    const idempotencyKey = "req-" + randomUUID();

    const cmdRes = await fetch(`${serviceB.origin}/local/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        "X-CSRF-Token": csrfToken,
        Cookie: cookie,
        "Idempotency-Key": idempotencyKey,
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({
        type: "task.create",
        payload: {
          clientTaskId,
          title: "Distributed Pipeline Execution Task",
          description: "Integration across physical nodes under UD-IC/1.0",
          ownerId: "agent-coordinator",
        },
      }),
    });

    assert.strictEqual(cmdRes.status, 202);
    const receipt = (await cmdRes.json()) as any;
    assert.strictEqual(receipt.state, "queued");
    assert.strictEqual(receipt.sequence, 1);
    console.log("  [PASS] Task created locally on Computer B and enqueued into durable SQLite WAL outbox.");

    // Trigger worker tick to push outbox to Computer A
    await workerB.tick();

    // Verify task exists in Computer A coordinator database
    const taskOnA = coordA.getTask(clientTaskId);
    assert.ok(taskOnA, "Task must exist on Computer A");
    assert.strictEqual(taskOnA.title, "Distributed Pipeline Execution Task");
    assert.strictEqual(taskOnA.revision, 1);
    assert.strictEqual(taskOnA.status, "pending");
    console.log(`  [PASS] Task successfully pushed to and persisted by Computer A (Revision: ${taskOnA.revision}).`);

    // Verify outbox on Computer B is marked applied
    const outboxAfter = storeB.lookup(receipt.eventId);
    assert.strictEqual(outboxAfter.state, "applied");
    console.log("  [PASS] Computer B outbox marked applied following verified ACK from Computer A.");

    // -------------------------------------------------------------
    // Test 4: Canonical Pull and Hydration on Computer B
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 4: Pulling Canonical Event Journal and Hydrating Local Store on Computer B...");
    await workerB.pull();
    const cachedTask = storeB.entities("tasks").find((t: any) => t.id === clientTaskId);
    assert.ok(cachedTask, "Task snapshot must be hydrated in Computer B cache");
    assert.strictEqual(cachedTask.id, clientTaskId);
    assert.strictEqual(cachedTask.revision, 1);
    console.log("  [PASS] Computer B hydrated canonical task snapshot via GET /api/sync/pull.");

    // -------------------------------------------------------------
    // Test 5: Offline Queuing & Auto-Flush on Reconnection
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 5: Simulating Network Disconnection & Offline Outbox Durability...");
    // Stop Computer A temporarily to simulate offline network partition
    await new Promise<void>((resolve) => serverA.close(() => resolve()));
    console.log("  [INFO] Computer A simulated unreachable (Server closed).");

    // Computer B enqueues a state transition while completely offline
    const offlineKey = "req-offline-" + randomUUID();
    const offlineCmdRes = await fetch(`${serviceB.origin}/local/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        "X-CSRF-Token": csrfToken,
        Cookie: cookie,
        "Idempotency-Key": offlineKey,
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({
        type: "task.transition",
        taskId: clientTaskId,
        baseRevision: 1,
        payload: {
          targetStatus: "running",
          ownerId: "agent-coordinator",
          reason: "Resumed by peer worker offline",
        },
      }),
    });
    assert.strictEqual(offlineCmdRes.status, 202);
    const offlineReceipt = (await offlineCmdRes.json()) as any;
    assert.strictEqual(offlineReceipt.state, "queued");
    assert.strictEqual(offlineReceipt.sequence, 2);
    console.log("  [PASS] Mutation enqueued with monotonic sequence 2 in Computer B offline outbox.");

    // Worker attempts push while coordinator is down -> Should handle failure gracefully without dropping queue
    await workerB.tick();
    const queuedRow = storeB.lookup(offlineReceipt.eventId);
    assert.ok(queuedRow, "Queued row must exist");
    assert.ok(queuedRow.state === "queued" || queuedRow.state === "sending", "Must remain queued during network drop");
    console.log("  [PASS] Offline mutation retained in durable storage with zero data loss.");

    // Reopen Computer A coordinator on same port
    await new Promise<void>((resolve) => serverA.listen(portA, "127.0.0.1", () => resolve()));
    console.log("  [INFO] Computer A network connectivity restored.");

    // Trigger worker tick -> Auto flush
    await workerB.tick();

    // Verify task status transitioned to 'running' (revision 2) on Computer A
    const taskAfterFlush = coordA.getTask(clientTaskId);
    assert.strictEqual(taskAfterFlush.status, "running");
    assert.strictEqual(taskAfterFlush.revision, 2);
    console.log(`  [PASS] Outbox auto-flushed upon reconnection! Task is 'running' at Revision ${taskAfterFlush.revision}.`);

    // -------------------------------------------------------------
    // Test 6: Concurrency & Stale Revision Conflict Detection
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 6: Concurrency & Stale Revision Conflict Quarantine...");
    // On Computer A, mutate task to revision 3 ('review')
    coordA.transitionTask(
      clientTaskId,
      {
        targetStatus: "review",
        baseRevision: taskAfterFlush.revision,
        reason: "Staged for review on A",
      },
      "agent-coordinator"
    );
    const taskAtRev3 = coordA.getTask(clientTaskId);
    assert.strictEqual(taskAtRev3.revision, 3);

    // On Computer B, attempt to apply a command based on stale baseRevision: 2
    const conflictKey = "req-conflict-" + randomUUID();
    const conflictCmdRes = await fetch(`${serviceB.origin}/local/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        "X-CSRF-Token": csrfToken,
        Cookie: cookie,
        "Idempotency-Key": conflictKey,
        Origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({
        type: "task.transition",
        taskId: clientTaskId,
        baseRevision: 2, // Stale! Revision on coordinator is now 3
        payload: {
          targetStatus: "blocked",
          reason: "Concurrent conflicting decision",
        },
      }),
    });
    assert.strictEqual(conflictCmdRes.status, 202);

    // Push conflict to Computer A
    await workerB.tick();

    // Verify Computer A quarantined the conflict in conflicts_v1
    const conflictList = await coordA.listConflicts("open");
    assert.ok(conflictList.items.length >= 1, "Conflict must be recorded in open conflicts");
    const conflictRecord = conflictList.items.find((c) => c.taskId === clientTaskId);
    assert.ok(conflictRecord, "Conflict record must match taskId");
    assert.strictEqual(conflictRecord.baseRevision, 2);
    assert.strictEqual(conflictRecord.currentRevision, 3);
    assert.strictEqual(conflictRecord.status, "open");
    console.log(`  [PASS] Stale revision conflict safely quarantined (Conflict ID: ${conflictRecord.id}) without silent overwrite.`);

    // -------------------------------------------------------------
    // Test 7: Conflict Resolution via Reviewer Authority
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 7: Resolving Conflict via Authorized Reviewer Interface...");
    const resolveRes = await coordA.resolve(
      conflictRecord.id,
      {
        resolution: "keep_authoritative",
        expectedConflictRevision: 1,
        expectedTaskRevision: taskAtRev3.revision,
        reason: "Authoritative decision on Computer A confirmed",
      },
      { id: "lead-reviewer", deviceId: "reviewer-dev", role: "reviewer" }
    );
    assert.strictEqual(resolveRes.status, "resolved");
    assert.strictEqual(resolveRes.resolution, "keep_authoritative");

    const conflictAfterResolve = dbA.getConflictV1(conflictRecord.id);
    assert.strictEqual(conflictAfterResolve?.status, "resolved");
    console.log("  [PASS] Conflict successfully resolved using 'keep_authoritative' protocol.");

    // -------------------------------------------------------------
    // Test 8: Verified Patch Application Lifecycle
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 8: Testing Verified Patch Application with Checksum & Test Verification...");
    const testPatch = {
      id: randomUUID(),
      taskId: clientTaskId,
      runId: "run-integration-001",
      diffContent: `--- a/src/index.js\n+++ b/src/index.js\n@@ -1,2 +1,2 @@\n-const v = 1;\n+const v = 2;\n`,
      status: "pending" as const,
      diffHash: "diff-hash-" + randomUUID(),
      baseCommit: "commit-base-001",
      taskRevision: 3,
      createdAt: new Date().toISOString(),
    };
    dbA.savePatch(testPatch);
    coordA.setPatchCompletionMode("verified_application");
    coordA.approvePatch(testPatch.id, "lead-reviewer");

    // Task must remain in 'review' awaiting explicit application
    const taskBeforeApply = coordA.getTask(clientTaskId);
    assert.strictEqual(taskBeforeApply.status, "review");

    const appRecord = coordA.applyPatch(
      testPatch.id,
      {
        expectedTaskRevision: taskBeforeApply.revision,
        expectedBaseCommit: testPatch.baseCommit,
        expectedDiffHash: testPatch.diffHash,
        targetWorkspaceId: "integration-workspace",
        testProfileId: "default-tests",
      },
      "lead-reviewer"
    );
    assert.strictEqual(appRecord.status, "verified");
    const taskAfterApply = coordA.getTask(clientTaskId);
    assert.strictEqual(taskAfterApply.status, "done");
    console.log(`  [PASS] Patch verified and applied! Task moved to 'done' (Revision: ${taskAfterApply.revision}).`);

    console.log("\n=== ALL MULTI-COMPUTER END-TO-END INTEGRATION TESTS PASSED (8/8)! ===");
  } finally {
    await workerB.stop();
    await serviceB.close();
    storeB.close();
    await new Promise<void>((resolve) => serverA.close(() => resolve()));
    dbA.close();
    try {
      rmSync(tempDirB, { recursive: true, force: true });
    } catch {
      /* ignore temp cleanup errors */
    }
  }
}

runMultiComputerTests().catch((err) => {
  console.error("\n❌ MULTI-COMPUTER INTEGRATION TEST FAILED:", err);
  process.exit(1);
});
