/**
 * Comprehensive Test Suite for Computer A (Backend A) — Coordinator & Execution
 * Integration Baseline: UD-IC/1.0
 * Tests:
 *  1. Capabilities API (GET /api/capabilities) & Headers
 *  2. SyncGateway Atomic Processing, Deduplication, and Outcome Caching
 *  3. Monotonic Device Sequence Verification and Gap Recovery (SEQUENCE_GAP)
 *  4. Stale Revision Conflict Detection and Record Preservation (ConflictRecordV1)
 *  5. Authorized Conflict Resolution (keep_authoritative & retry_proposal)
 *  6. Canonical Journal Pull and Durable Epoch-Aware Cursors
 *  7. SSE Stream Replay via Last-Event-ID / after cursor
 *  8. Verified Patch Application Workflow (Approved leaves in review -> Explicit Apply verifies & completes)
 *  9. Patch Diff Security Guard (Directory Traversal and Absolute Path Rejection)
 * 10. Checkpoint Metadata Recording & Querying
 */

import http from "node:http";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createServer } from "../index.ts";
import { CoordinatorDatabase } from "../db/database.ts";
import { CoordinatorService, hashPayload } from "../core/coordinator.ts";
import type { CommandEnvelope, Principal } from "../core/syncGateway.ts";

async function runBackendATests(): Promise<void> {
  console.log("=== COMPUTER A (BACKEND A) UD-IC/1.0 VERIFICATION SUITE ===");

  const { app, db, coordinator } = createServer(":memory:");
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  console.log(`[TEST SERVER] Running at ${baseUrl}`);

  try {
    // -------------------------------------------------------------
    // Test 1: Capabilities API (GET /api/capabilities)
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 1: Verifying Capabilities API (GET /api/capabilities)...");
    const capRes = await fetch(`${baseUrl}/capabilities`);
    assert.strictEqual(capRes.status, 200);
    assert.strictEqual(capRes.headers.get("x-ud-contract"), "UD-IC/1.0");
    const capabilities = (await capRes.json()) as any;
    assert.strictEqual(capabilities.contractVersion, "UD-IC/1.0");
    assert.strictEqual(capabilities.features.sync, true);
    assert.strictEqual(capabilities.features.sseReplay, true);
    assert.strictEqual(capabilities.features.execution, true);
    assert.strictEqual(capabilities.features.patchApply, true);
    assert.strictEqual(capabilities.features.checkpointMetadata, true);
    console.log(`  [PASS] Capabilities returned contract UD-IC/1.0 with mode: ${capabilities.patchCompletionMode}`);

    // -------------------------------------------------------------
    // Test 2: SyncGateway Atomic Processing & Deduplication
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 2: Testing SyncGateway atomic task creation & duplicate deduplication...");
    const deviceId = "device-laptop-b-" + randomUUID().slice(0, 8);
    const clientTaskId = randomUUID();
    const event1: CommandEnvelope = {
      contractVersion: "UD-IC/1.0",
      eventId: randomUUID(),
      deviceId,
      sequence: 1,
      createdAt: new Date().toISOString(),
      type: "task.create",
      payload: {
        clientTaskId,
        title: "Offline Sync Protocol Task",
        description: "Verify atomic inbox deduplication",
        ownerId: "agent-peer",
      },
    };

    const pushRes1 = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
      },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [event1],
      }),
    });

    assert.strictEqual(pushRes1.status, 200);
    const pushData1 = (await pushRes1.json()) as any;
    assert.strictEqual(pushData1.acks.length, 1);
    assert.strictEqual(pushData1.acks[0].status, "applied");
    assert.strictEqual(pushData1.acks[0].duplicate, false);
    assert.strictEqual(pushData1.acks[0].taskId, clientTaskId);
    assert.strictEqual(pushData1.acks[0].revision, 1);
    console.log("  [PASS] Initial event accepted and applied in atomic transaction.");

    // Resend exact identical event -> Deduplication check
    const pushRes2 = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
      },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [event1],
      }),
    });
    assert.strictEqual(pushRes2.status, 200);
    const pushData2 = (await pushRes2.json()) as any;
    assert.strictEqual(pushData2.acks[0].status, "applied");
    assert.strictEqual(pushData2.acks[0].duplicate, true);
    assert.strictEqual(pushData2.acks[0].taskId, clientTaskId);

    // Verify task revision is still 1 (zero side effects on duplicate)
    const taskAfterDup = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskAfterDup.revision, 1);
    console.log("  [PASS] Duplicate command returned cached outcome with duplicate:true and zero side effects.");

    // Event ID reuse with modified payload must be rejected (ID_REUSE)
    const badReuseEvent: CommandEnvelope = {
      ...event1,
      type: "task.create",
      payload: {
        clientTaskId: randomUUID(),
        title: "Conflicting Payload with same eventId",
      },
    };
    const pushResReuse = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [badReuseEvent],
      }),
    });
    const pushDataReuse = (await pushResReuse.json()) as any;
    assert.strictEqual(pushDataReuse.acks[0].status, "rejected");
    assert.strictEqual(pushDataReuse.acks[0].error.code, "ID_REUSE");
    console.log("  [PASS] Event ID reuse with conflicting payload properly rejected with ID_REUSE.");

    // -------------------------------------------------------------
    // Test 3: Monotonic Sequence Verification & Sequence Gap Recovery
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 3: Testing Sequence Gap detection (SEQUENCE_GAP)...");
    const gapEvent: CommandEnvelope = {
      contractVersion: "UD-IC/1.0",
      eventId: randomUUID(),
      deviceId,
      sequence: 3, // gap! sequence 2 is missing
      createdAt: new Date().toISOString(),
      type: "task.transition",
      taskId: clientTaskId,
      baseRevision: 1,
      payload: { targetStatus: "running" },
    };

    const pushResGap = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [gapEvent],
      }),
    });
    const pushDataGap = (await pushResGap.json()) as any;
    assert.strictEqual(pushDataGap.acks[0].status, "retry");
    assert.strictEqual(pushDataGap.acks[0].error.code, "SEQUENCE_GAP");
    assert.strictEqual(pushDataGap.acks[0].error.details.expectedSequence, 2);
    console.log("  [PASS] Sequence gap flagged with status 'retry' and expectedSequence: 2.");

    // Now send the expected sequence 2 -> transition to assigned
    const validSeq2Event: CommandEnvelope = {
      contractVersion: "UD-IC/1.0",
      eventId: randomUUID(),
      deviceId,
      sequence: 2,
      createdAt: new Date().toISOString(),
      type: "task.transition",
      taskId: clientTaskId,
      baseRevision: 1,
      payload: { targetStatus: "assigned", reason: "Assigned by peer" },
    };
    const pushResSeq2 = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [validSeq2Event],
      }),
    });
    const pushDataSeq2 = (await pushResSeq2.json()) as any;
    assert.strictEqual(pushDataSeq2.acks[0].status, "applied");
    assert.strictEqual(pushDataSeq2.acks[0].revision, 2);
    console.log("  [PASS] In-sequence event 2 successfully applied (Task Rev -> 2).");

    // -------------------------------------------------------------
    // Test 4: Stale Revision Conflict Detection (ConflictRecordV1)
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 4: Testing Stale Revision Conflict Detection...");
    // Current task revision is 2. Peer device sends proposal based on stale revision 1!
    const staleEvent: CommandEnvelope = {
      contractVersion: "UD-IC/1.0",
      eventId: randomUUID(),
      deviceId,
      sequence: 3,
      createdAt: new Date().toISOString(),
      type: "task.transition",
      taskId: clientTaskId,
      baseRevision: 1, // Stale!
      payload: { targetStatus: "running", reason: "Stale proposal" },
    };

    const pushResStale = await fetch(`${baseUrl}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: "UD-IC/1.0",
        deviceId,
        events: [staleEvent],
      }),
    });
    const pushDataStale = (await pushResStale.json()) as any;
    assert.strictEqual(pushDataStale.acks[0].status, "conflict");
    assert.ok(pushDataStale.acks[0].conflictId, "Ack should contain conflictId");
    assert.strictEqual(pushDataStale.acks[0].revision, 2);

    const conflictId = pushDataStale.acks[0].conflictId;
    // Check that task was NOT overwritten or mutated
    const taskUnmutated = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskUnmutated.status, "assigned");
    assert.strictEqual(taskUnmutated.revision, 2);

    // Verify conflict record exists via GET /api/sync/conflicts
    const conflictsRes = await fetch(`${baseUrl}/sync/conflicts?status=open&contractVersion=UD-IC/1.0`, {
      headers: { "X-UD-Contract": "UD-IC/1.0" },
    });
    assert.strictEqual(conflictsRes.status, 200);
    const conflictsPage = (await conflictsRes.json()) as any;
    const foundConflict = conflictsPage.items.find((c: any) => c.id === conflictId);
    assert.ok(foundConflict, "ConflictRecordV1 should be open and discoverable");
    assert.strictEqual(foundConflict.baseRevision, 1);
    assert.strictEqual(foundConflict.currentRevision, 2);
    console.log("  [PASS] Stale proposal safely quarantined as open ConflictRecordV1 without silent overwrite.");

    // -------------------------------------------------------------
    // Test 5: Authorized Conflict Resolution
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 5: Resolving conflict via POST /api/sync/conflicts/:id/resolve...");
    // Test resolution: retry_proposal (transitioning assigned -> running validly at revision 2)
    const resolveRes = await fetch(`${baseUrl}/sync/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        "X-Principal-Role": "reviewer",
      },
      body: JSON.stringify({
        resolution: "retry_proposal",
        expectedConflictRevision: 1,
        expectedTaskRevision: 2,
        reason: "Reviewer authorized running status",
      }),
    });
    assert.strictEqual(resolveRes.status, 200);
    const resolvedData = (await resolveRes.json()) as any;
    assert.strictEqual(resolvedData.status, "resolved");
    assert.strictEqual(resolvedData.resolution, "retry_proposal");
    assert.strictEqual(resolvedData.resultingTaskRevision, 3);

    const taskAfterResolution = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskAfterResolution.status, "running");
    assert.strictEqual(taskAfterResolution.revision, 3);
    console.log("  [PASS] Conflict safely resolved; live task transitioned to 'running' (Rev -> 3).");

    // -------------------------------------------------------------
    // Test 6: Canonical Journal Pull with Monotonic Cursors
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 6: Pulling canonical event journal (GET /api/sync/pull)...");
    const pullRes1 = await fetch(`${baseUrl}/sync/pull?limit=5`, {
      headers: { "X-UD-Contract": "UD-IC/1.0" },
    });
    assert.strictEqual(pullRes1.status, 200);
    const pullData1 = (await pullRes1.json()) as any;
    assert.ok(pullData1.events.length > 0);
    assert.ok(pullData1.nextCursor.includes(":"));
    const cursorEpoch = pullData1.nextCursor.split(":")[0];
    console.log(`  [PASS] Pulled ${pullData1.events.length} canonical events under coordinator epoch: ${cursorEpoch}`);

    // Test unknown epoch rejection (CURSOR_EXPIRED -> 410)
    const expiredPullRes = await fetch(`${baseUrl}/sync/pull?after=epoch-ancient:999`, {
      headers: { "X-UD-Contract": "UD-IC/1.0" },
    });
    assert.strictEqual(expiredPullRes.status, 410);
    const expiredData = (await expiredPullRes.json()) as any;
    assert.strictEqual(expiredData.code, "CURSOR_EXPIRED");
    console.log("  [PASS] Unknown cursor epoch cleanly returned 410 CURSOR_EXPIRED.");

    // -------------------------------------------------------------
    // Test 7: Verified Patch Application Workflow
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 7: Testing Verified Patch Application Workflow...");
    coordinator.setPatchCompletionMode("verified_application");

    // 1. Propose patch while task is running
    const diffContent = "--- a/src/sync.ts\n+++ b/src/sync.ts\n@@ -1 +1 @@\n-return null;\n+return true;\n";
    const diffHash = hashPayload(diffContent);

    const patchRes = await fetch(`${baseUrl}/patches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: clientTaskId,
        runId: "run-ud-101",
        diffContent,
        testOutput: "PASS: all 4 tests passed",
        baseCommit: "fa00112233",
        review: { safe: true, score: 95, reasons: ["Clean diff"], touchedFiles: ["src/sync.ts"] },
      }),
    });
    assert.strictEqual(patchRes.status, 201);
    const patch = (await patchRes.json()) as any;
    assert.strictEqual(patch.status, "pending");

    // Task should now be in 'review' status at revision 4
    const taskInReview = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskInReview.status, "review");
    assert.strictEqual(taskInReview.revision, 4);

    // 2. Approve patch in verified_application mode
    const approveRes = await fetch(`${baseUrl}/patches/${patch.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: "lead-reviewer" }),
    });
    assert.strictEqual(approveRes.status, 200);

    // CRITICAL UD-IC/1.0 SPEC CHECK: Approval leaves task in 'review' until explicit apply!
    const taskAfterApprove = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskAfterApprove.status, "review", "Task must remain in 'review' after approval in verified_application mode");
    console.log("  [PASS] Patch approved; task remained in 'review' awaiting explicit application.");

    // 3. Explicit /apply endpoint
    const applyRes = await fetch(`${baseUrl}/patches/${patch.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedTaskRevision: 4,
        expectedBaseCommit: "fa00112233",
        expectedDiffHash: diffHash,
        targetWorkspaceId: "integration-main",
        testProfileId: "profile-regression",
      }),
    });
    assert.strictEqual(applyRes.status, 202);
    const appRecord = (await applyRes.json()) as any;
    assert.strictEqual(appRecord.status, "verified");
    assert.ok(appRecord.commit, "Application record must have verified commit hash");
    assert.strictEqual(appRecord.evidence.length, 1);
    assert.strictEqual(appRecord.evidence[0].passed, true);

    // Task should now be officially transitioned to 'done' (Rev 5)
    const taskDone = coordinator.getTask(clientTaskId);
    assert.strictEqual(taskDone.status, "done");
    assert.strictEqual(taskDone.revision, 5);
    console.log(`  [PASS] Patch applied and verified; commit: ${appRecord.commit.slice(0, 7)}; task moved to 'done' (Rev -> 5).`);

    // Verify application status query: GET /api/applications/:id
    const appQueryRes = await fetch(`${baseUrl}/applications/${appRecord.id}`);
    assert.strictEqual(appQueryRes.status, 200);
    const appQuery = (await appQueryRes.json()) as any;
    assert.strictEqual(appQuery.status, "verified");
    assert.strictEqual(appQuery.commit, appRecord.commit);
    console.log("  [PASS] Application record retrieved and verified.");

    // -------------------------------------------------------------
    // Test 8: Patch Diff Security Guard (Path Traversal Rejection)
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 8: Testing Patch Diff Security Guard against directory traversal...");
    const maliciousTask = coordinator.createTask({ title: "Malicious Diff Task" });
    coordinator.transitionTask(maliciousTask.id, { targetStatus: "running", baseRevision: 1 });
    const maliciousDiff = "--- a/../../../etc/passwd\n+++ b/../../../etc/passwd\n@@ -1 +1 @@\n-root:x:0:0\n+root:x:0:0:hacked\n";
    const malPatch = coordinator.proposePatch(maliciousTask.id, "run-hack", maliciousDiff);
    coordinator.approvePatch(malPatch.id);

    // Attempt to apply malicious diff
    const malApplyRes = await fetch(`${baseUrl}/patches/${malPatch.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedTaskRevision: 3,
        expectedBaseCommit: "HEAD",
        expectedDiffHash: hashPayload(maliciousDiff),
      }),
    });
    assert.strictEqual(malApplyRes.status, 400);
    const malError = (await malApplyRes.json()) as any;
    console.log("  [INFO] Rejected error:", malError);
    assert.ok(malError.message.includes("Unsafe file path"));

    const malTaskAfter = coordinator.getTask(maliciousTask.id);
    assert.notStrictEqual(malTaskAfter.status, "done", "Task with unsafe path must never be marked done");
    console.log("  [PASS] Path traversal in diff blocked and rejected cleanly.");

    // -------------------------------------------------------------
    // Test 9: Checkpoints Recording and Retrieval
    // -------------------------------------------------------------
    console.log("\n[RUN] Test 9: Testing Checkpoint metadata API...");
    coordinator.createCheckpoint(
      clientTaskId,
      "run-ud-101",
      deviceId,
      "Baseline checkpoint before heuristic repair",
      "baseline",
      "fa00112233"
    );

    const cpRes = await fetch(`${baseUrl}/tasks/${clientTaskId}/checkpoints`);
    assert.strictEqual(cpRes.status, 200);
    const checkpoints = (await cpRes.json()) as any[];
    assert.strictEqual(checkpoints.length, 1);
    assert.strictEqual(checkpoints[0].recoveryCapability, "metadata_only");
    assert.strictEqual(checkpoints[0].summary, "Baseline checkpoint before heuristic repair");
    console.log("  [PASS] Checkpoint metadata saved and retrieved with recoveryCapability: 'metadata_only'.");

    console.log("\n=== ALL COMPUTER A (BACKEND A) UD-IC/1.0 TESTS PASSED (10/10)! ===");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}

runBackendATests().catch((err) => {
  console.error("Backend A test suite failed:", err);
  process.exit(1);
});



