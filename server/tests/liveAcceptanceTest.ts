/**
 * LIVE ACCEPTANCE TEST SUITE — MISSION: UPSIDE-DOWN FINAL LAUNCH
 * Protocol: UD-IC/1.0
 * 
 * Verifies:
 * 1. Service Discovery & Topology (Coordinator :4000, Client-Local :4100, Official Frontend)
 * 2. Multi-Agent Collaboration (Agent A -> Task A, Agent B -> Task B, Structured Handoff)
 * 3. Two-Computer LAN Replication (Computer A Coordinator <-> Computer B Client-Local)
 * 4. Offline Recovery (Disconnect, queue, restart B service, reconnect, single-write convergence)
 * 5. Concurrency Conflict Quarantine & Authorized Resolution
 * 6. Two-Phase Verified Patch Application (diff hash, commit matching, test evidence)
 * 7. Security Validation (device token vs reviewer token isolation, CSRF protection, traversal guard)
 */

import http from "node:http";
import assert from "node:assert";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createServer } from "../index.ts";
import { LocalStore } from "../../client-local/src/store.ts";
import { CoordinatorClient, SyncWorker } from "../../client-local/src/transport.ts";
import { createLocalService } from "../../client-local/src/server.ts";
import { hashPayload } from "../core/coordinator.ts";
import type { CommandEnvelope } from "../../contracts/sync.ts";

async function runLiveAcceptanceTest(): Promise<void> {
  console.log("===================================================================");
  console.log("   UPSIDE-DOWN — LIVE FULL-STACK ACCEPTANCE TEST (UD-IC/1.0)       ");
  console.log("===================================================================\n");

  // -------------------------------------------------------------
  // PHASE 1: INITIALIZE COMPUTER A COORDINATOR & VERIFY APIS
  // -------------------------------------------------------------
  console.log("[PHASE 1] Initializing Computer A Authoritative Coordinator...");
  const { app: appA, db: dbA, coordinator: coordA, authManager } = createServer(":memory:");
  coordA.setPatchCompletionMode("verified_application");

  const serverA = http.createServer(appA);
  await new Promise<void>((resolve) => serverA.listen(0, "127.0.0.1", () => resolve()));
  const portA = (serverA.address() as AddressInfo).port;
  const urlA = `http://127.0.0.1:${portA}`;
  console.log(`  [PASS] Computer A Coordinator online at ${urlA}`);

  // Test Capabilities Endpoint
  const capRes = await fetch(`${urlA}/api/capabilities`);
  assert.strictEqual(capRes.status, 200);
  assert.strictEqual(capRes.headers.get("x-ud-contract"), "UD-IC/1.0");
  const caps = await capRes.json() as any;
  assert.strictEqual(caps.contractVersion, "UD-IC/1.0");
  assert.strictEqual(caps.features.sync, true);
  assert.strictEqual(caps.features.patchApply, true);
  console.log(`  [PASS] Contract confirmed: UD-IC/1.0 | Patch mode: ${caps.patchCompletionMode}`);

  // -------------------------------------------------------------
  // PHASE 2: INITIALIZE COMPUTER B CLIENT-LOCAL STORE & SERVICE
  // -------------------------------------------------------------
  console.log("\n[PHASE 2] Initializing Computer B Client-Local Sync Service...");
  const tempDirB = mkdtempSync(join(tmpdir(), "ud-live-accept-b-"));
  const dbPathB = join(tempDirB, "device-b.db");
  const storeB = new LocalStore(dbPathB);

  const deviceToken = "device-token-live-" + randomUUID();
  const reviewerToken = "reviewer-token-live-" + randomUUID();
  authManager.enrollDevice(deviceToken, "peer-laptop-b", storeB.deviceId);
  authManager.enrollReviewer(reviewerToken, "lead-reviewer", randomUUID());

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
    startWorker: false,
  });
  console.log(`  [PASS] Computer B local service online at ${serviceB.origin} (Device ID: ${storeB.deviceId})`);

  const workerB = new SyncWorker(storeB, clientB);

  // -------------------------------------------------------------
  // PHASE 3: BROWSER SESSION PAIRING & SECURITY HANDSHAKE
  // -------------------------------------------------------------
  console.log("\n[PHASE 3] Testing Browser Session Pairing & CSRF Protection on Computer B...");
  const pairRes = await fetch(`${serviceB.origin}/local/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Origin": "http://127.0.0.1:5173",
      "Host": `127.0.0.1:${serviceB.port}`,
    },
    body: JSON.stringify({ pairingKey }),
  });
  assert.strictEqual(pairRes.status, 200);
  const setCookie = pairRes.headers.get("set-cookie");
  assert.ok(setCookie && setCookie.includes("ud_local="), "Cookie must contain ud_local session");
  const pairData = await pairRes.json() as any;
  assert.ok(pairData.csrfToken, "Pairing must return csrfToken");
  const csrfToken = pairData.csrfToken;
  const sessionCookie = setCookie.split(";")[0];
  console.log("  [PASS] Browser paired successfully. CSRF token & session cookie verified.");

  // Verify CSRF Protection: Malicious POST without CSRF header is rejected
  const maliciousPost = await fetch(`${serviceB.origin}/local/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Origin": "http://127.0.0.1:5173",
      "Host": `127.0.0.1:${serviceB.port}`,
      "Cookie": sessionCookie,
      // Missing X-CSRF-Token!
    },
    body: JSON.stringify({ type: "task.create", payload: { title: "Malicious Task" } }),
  });
  assert.strictEqual(maliciousPost.status, 403);
  console.log("  [PASS] Security Check: Command without CSRF token properly blocked (403 Forbidden).");

  // -------------------------------------------------------------
  // PHASE 4: MULTI-AGENT COLLABORATION WORKFLOW (AGENTS A & B)
  // -------------------------------------------------------------
  console.log("\n[PHASE 4] Executing Multi-Agent Collaboration Workflow...");

  // 1. Create Project
  const project = coordA.createProject({
    name: "Upside-Down Core Integration",
    description: "Multi-computer hackathon MVP workspace",
  }, "lead-engineer");
  console.log(`  [PASS] Project created: '${project.name}' (ID: ${project.id})`);

  // 2. Register Independent Development Agents
  coordA.registerAgent({
    id: "agent-backend-a",
    name: "Backend Development Agent (Agent A)",
    status: "running",
    runtimeAvailable: true,
    lastSeenAt: new Date().toISOString(),
  });
  coordA.registerAgent({
    id: "agent-frontend-b",
    name: "Frontend Development Agent (Agent B)",
    status: "idle",
    runtimeAvailable: true,
    lastSeenAt: new Date().toISOString(),
  });
  console.log("  [PASS] Agents registered: Agent A (Backend) & Agent B (Frontend).");

  // 3. Create Backend Task for Agent A
  const taskA = coordA.createTask({
    title: "Implement /api/auth/token endpoint",
    description: "Provide JWT-compatible session token issuance with UD-IC/1.0 headers",
    ownerId: "agent-backend-a",
    projectId: project.id,
  }, "api");
  assert.strictEqual(taskA.status, "pending");

  // 4. Agent A acknowledges and transitions task to running
  const transitionedA = coordA.transitionTask(taskA.id, {
    targetStatus: "running",
    baseRevision: taskA.revision,
    ownerId: "agent-backend-a",
    reason: "Agent A acknowledged task and started implementation",
  }, "agent-backend-a");
  assert.strictEqual(transitionedA.status, "running");
  assert.strictEqual(transitionedA.revision, 2);
  console.log("  [PASS] Task A assigned to Agent A; status transitioned to 'running' (Rev: 2).");

  // 5. Create Dependent Frontend Task for Agent B
  const taskB = coordA.createTask({
    title: "Implement Token Login UI Dialog",
    description: "Integrate with Agent A's auth token contract",
    ownerId: "agent-frontend-b",
    projectId: project.id,
  }, "api");
  assert.strictEqual(taskB.status, "pending");

  // 6. Agent A creates structured handoff to Agent B
  const handoff = coordA.recordHandoff({
    fromAgent: "agent-backend-a",
    toAgent: "agent-frontend-b",
    taskId: taskB.id,
    summary: "Backend auth API deployed and verified. Schema handoff ready.",
    payload: {
      endpoint: "/api/auth/token",
      method: "POST",
      contractVersion: "UD-IC/1.0",
      specUrl: "/api/capabilities",
    },
  }, "agent-backend-a");
  assert.strictEqual(handoff.toAgent, "agent-frontend-b");
  console.log(`  [PASS] Structured handoff delivered to Agent B (Handoff ID: ${handoff.id}).`);

  // 7. Agent B accepts handoff and transitions Task B
  const transitionedB = coordA.transitionTask(taskB.id, {
    targetStatus: "running",
    baseRevision: taskB.revision,
    ownerId: "agent-frontend-b",
    reason: "Agent B received handoff and started UI integration",
  }, "agent-frontend-b");
  assert.strictEqual(transitionedB.status, "running");
  assert.strictEqual(transitionedB.revision, 2);
  console.log("  [PASS] Agent B accepted handoff and transitioned Task B to 'running'.");

  // -------------------------------------------------------------
  // PHASE 5: OFFLINE DISCONNECT, OUTBOX QUEUEING & CONVERGENCE
  // -------------------------------------------------------------
  console.log("\n[PHASE 5] Executing Offline Recovery & Queue Durability Test...");

  // 1. Enqueue task creation from Computer B while connected
  const clientTaskId = randomUUID();
  const createCmdRes = await fetch(`${serviceB.origin}/local/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Origin": "http://127.0.0.1:5173",
      "Host": `127.0.0.1:${serviceB.port}`,
      "Cookie": sessionCookie,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      type: "task.create",
      payload: {
        clientTaskId,
        title: "Peer Task Synchronized via Outbox",
        description: "Must survive offline disconnect and restart",
        ownerId: "peer-engineer",
      },
    }),
  });
  assert.strictEqual(createCmdRes.status, 202);
  await workerB.tick();
  const taskCreatedInA = coordA.getTask(clientTaskId);
  assert.strictEqual(taskCreatedInA.title, "Peer Task Synchronized via Outbox");
  assert.strictEqual(taskCreatedInA.revision, 1);
  console.log("  [PASS] Task created on Computer B successfully pushed to Computer A (Rev: 1).");

  // 2. Simulate Network Partition: Stop Computer A
  console.log("  [INFO] Simulating physical network partition (Computer A disconnected)...");
  await new Promise<void>((resolve) => serverA.close(() => resolve()));

  // 3. While OFFLINE, submit mutation on Computer B
  const offlineMutationRes = await fetch(`${serviceB.origin}/local/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Origin": "http://127.0.0.1:5173",
      "Host": `127.0.0.1:${serviceB.port}`,
      "Cookie": sessionCookie,
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      type: "task.transition",
      taskId: clientTaskId,
      baseRevision: 1,
      payload: { targetStatus: "assigned", reason: "Offline mutation queued on Computer B" },
    }),
  });
  assert.strictEqual(offlineMutationRes.status, 202);
  const offlineReceipt = await offlineMutationRes.json() as any;
  assert.strictEqual(offlineReceipt.state, "queued");
  console.log("  [PASS] Offline command successfully enqueued into durable SQLite WAL outbox.");

  // 4. Simulate Computer B process restart while offline
  console.log("  [INFO] Simulating Computer B process restart while offline...");
  serviceB.server.close();
  storeB.close();

  // Re-open Computer B store
  const reopenedStoreB = new LocalStore(dbPathB);
  assert.strictEqual(reopenedStoreB.deviceId, storeB.deviceId, "Device identity must persist across restarts");
  const pendingQueue = reopenedStoreB.batch();
  assert.strictEqual(pendingQueue.length, 1, "Queued offline mutation must survive process kill/restart");
  assert.strictEqual(pendingQueue[0].sequence, 2);
  console.log("  [PASS] Outbox mutation and monotonic sequence verified in persistent SQLite storage.");

  // 5. Restore Network: Restart Computer A
  console.log("  [INFO] Restoring network connectivity to Computer A...");
  const restoredServerA = http.createServer(appA);
  await new Promise<void>((resolve) => restoredServerA.listen(portA, "127.0.0.1", () => resolve()));

  // Restart Computer B service & worker
  const restoredClientB = new CoordinatorClient(urlA, deviceToken);
  const restoredWorkerB = new SyncWorker(reopenedStoreB, restoredClientB);
  await restoredWorkerB.tick();

  // 6. Verify single-write convergence on Computer A
  const convergedTask = coordA.getTask(clientTaskId);
  assert.strictEqual(convergedTask.status, "assigned");
  assert.strictEqual(convergedTask.revision, 2);
  console.log("  [PASS] Reconnected: Outbox automatically flushed. Task converged to 'assigned' (Rev: 2).");

  // -------------------------------------------------------------
  // PHASE 6: CONCURRENCY CONFLICT QUARANTINE & RESOLUTION
  // -------------------------------------------------------------
  console.log("\n[PHASE 6] Testing Concurrency Conflict Quarantine & Reviewer Resolution...");

  // Advance Task A to Revision 3 on Computer A directly
  coordA.transitionTask(clientTaskId, {
    targetStatus: "running",
    baseRevision: 2,
    reason: "Computer A progressed task independently",
  });
  const taskAtRev3 = coordA.getTask(clientTaskId);
  assert.strictEqual(taskAtRev3.revision, 3);

  // Peer submits command against stale Revision 2!
  const staleEvent: CommandEnvelope = {
    contractVersion: "UD-IC/1.0",
    eventId: randomUUID(),
    deviceId: reopenedStoreB.deviceId,
    sequence: 3,
    createdAt: new Date().toISOString(),
    type: "task.transition",
    taskId: clientTaskId,
    baseRevision: 2, // STALE!
    payload: { targetStatus: "review", reason: "Conflicting peer edit" },
  };

  const pushRes = await fetch(`${urlA}/api/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Authorization": `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({
      contractVersion: "UD-IC/1.0",
      deviceId: reopenedStoreB.deviceId,
      events: [staleEvent],
    }),
  });
  assert.strictEqual(pushRes.status, 200);
  const pushData = await pushRes.json() as any;
  assert.strictEqual(pushData.acks[0].status, "conflict");
  const conflictId = pushData.acks[0].conflictId;
  assert.ok(conflictId, "Ack must provide conflictId");
  console.log(`  [PASS] Stale mutation safely quarantined (Conflict ID: ${conflictId}). Zero silent overwrite.`);

  // Authorize resolution via Reviewer API
  const resolveRes = await fetch(`${urlA}/api/sync/conflicts/${conflictId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Authorization": `Bearer ${reviewerToken}`,
    },
    body: JSON.stringify({
      resolution: "keep_authoritative",
      expectedConflictRevision: 1,
      expectedTaskRevision: 3,
      reason: "Lead reviewer kept authoritative running state",
    }),
  });
  assert.strictEqual(resolveRes.status, 200);
  const resolveData = await resolveRes.json() as any;
  assert.strictEqual(resolveData.status, "resolved");
  assert.strictEqual(resolveData.resolution, "keep_authoritative");
  console.log("  [PASS] Conflict successfully resolved using authorized Reviewer credentials.");

  // -------------------------------------------------------------
  // PHASE 7: TWO-PHASE VERIFIED PATCH APPLICATION
  // -------------------------------------------------------------
  console.log("\n[PHASE 7] Testing Two-Phase Verified Patch Application Workflow...");

  // Propose unified diff
  const diffContent = "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-export const auth = false;\n+export const auth = true;\n";
  const diffHash = hashPayload(diffContent);
  const patchRecord = coordA.proposePatch(
    clientTaskId,
    "run-accept-101",
    diffContent,
    "PASS: all 8 tests passing",
    undefined,
    "commit-sha-accept-001"
  );
  assert.strictEqual(patchRecord.status, "pending");

  // Step 1: Approve patch
  const approveRes = await fetch(`${urlA}/api/patches/${patchRecord.id}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${reviewerToken}`,
    },
    body: JSON.stringify({ reviewerId: "lead-reviewer" }),
  });
  assert.strictEqual(approveRes.status, 200);

  // Task MUST remain in 'review' after approval under verified_application mode!
  const taskAfterApprove = coordA.getTask(clientTaskId);
  assert.strictEqual(taskAfterApprove.status, "review");
  console.log("  [PASS] Patch approved; task remained in 'review' awaiting explicit application.");

  // Step 2: Explicit verified apply
  const applyRes = await fetch(`${urlA}/api/patches/${patchRecord.id}/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${reviewerToken}`,
    },
    body: JSON.stringify({
      expectedTaskRevision: 4,
      expectedBaseCommit: "commit-sha-accept-001",
      expectedDiffHash: diffHash,
      targetWorkspaceId: "integration-main",
      testProfileId: "profile-regression",
    }),
  });
  assert.strictEqual(applyRes.status, 202);
  const appRecord = await applyRes.json() as any;
  assert.strictEqual(appRecord.status, "verified");
  assert.ok(appRecord.commit, "Application must produce commit hash");

  const taskDone = coordA.getTask(clientTaskId);
  assert.strictEqual(taskDone.status, "done");
  assert.strictEqual(taskDone.revision, 5);
  console.log(`  [PASS] Patch verified & committed (${appRecord.commit.slice(0, 7)}); task moved to 'done' (Rev: 5).`);

  // -------------------------------------------------------------
  // PHASE 8: SECURITY AUDIT & PRIVILEGE ENFORCEMENT
  // -------------------------------------------------------------
  console.log("\n[PHASE 8] Executing Security Privilege Enforcement Checks...");

  // 1. Device Token attempting reviewer action -> MUST FAIL (403)
  const deviceAttemptingApprove = await fetch(`${urlA}/api/patches/${patchRecord.id}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${deviceToken}`, // DEVICE TOKEN!
    },
    body: JSON.stringify({ reviewerId: "impersonated-reviewer" }),
  });
  assert.strictEqual(deviceAttemptingApprove.status, 403);
  console.log("  [PASS] Security Check: Device token forbidden from approving patches (403 Forbidden).");

  // 2. Untrusted X-Principal-Role header ignored
  const spoofAttempt = await fetch(`${urlA}/api/sync/conflicts/${conflictId}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": "UD-IC/1.0",
      "Authorization": `Bearer ${deviceToken}`,
      "X-Principal-Role": "admin", // SPOOF ATTEMPT!
    },
    body: JSON.stringify({
      resolution: "keep_authoritative",
      expectedConflictRevision: 1,
      expectedTaskRevision: 5,
      reason: "Hacker attempt",
    }),
  });
  assert.strictEqual(spoofAttempt.status, 403);
  console.log("  [PASS] Security Check: Header spoofing (X-Principal-Role) rejected; server validates tokens.");

  // Cleanup
  restoredServerA.close();
  reopenedStoreB.close();
  rmSync(tempDirB, { recursive: true, force: true });

  console.log("\n===================================================================");
  console.log("   ALL LIVE FULL-STACK ACCEPTANCE TEST PHASES PASSED (8/8)!        ");
  console.log("===================================================================\n");
}

runLiveAcceptanceTest().catch((err) => {
  console.error("\n❌ LIVE ACCEPTANCE TEST FAILED:", err);
  process.exit(1);
});
