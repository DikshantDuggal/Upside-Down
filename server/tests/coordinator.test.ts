/**
 * Comprehensive Test Suite for Role 1 — Core Backend & Coordinator
 * Tests:
 *  1. Task persistence across restarts
 *  2. Valid and invalid state transitions
 *  3. Revision conflict detection (409)
 *  4. Full HTTP API contract adherence
 *  5. Real-time Server-Sent Events (SSE) delivery
 *  6. Patch proposal and approval lifecycle
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { createServer } from "../index.ts";
import { CoordinatorDatabase } from "../db/database.ts";
import { CoordinatorService, ConflictError, ValidationError } from "../core/coordinator.ts";
import type { ActivityEvent } from "../../contracts/events.ts";

async function runTests(): Promise<void> {
  console.log("=== ROLE 1 VERIFICATION TEST SUITE ===");

  const testDbDir = path.resolve(process.cwd(), "data", "test");
  const testDbFile = path.join(testDbDir, "persistence_test.db");
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }

  // -------------------------------------------------------------
  // Test 1: Task Persistence Across Database Restarts
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 1: Task persistence across restarts...");
  {
    const db1 = new CoordinatorDatabase(testDbFile);
    const service1 = new CoordinatorService(db1);
    const task = service1.createTask({
      title: "Offline Sync Engine Implementation",
      description: "Build SQLite outbox and LAN sync",
      ownerId: "agent-role4",
    });

    assert.strictEqual(task.status, "pending");
    assert.strictEqual(task.revision, 1);
    db1.close();

    // Reopen from same file
    const db2 = new CoordinatorDatabase(testDbFile);
    const service2 = new CoordinatorService(db2);
    const retrieved = service2.getTask(task.id);

    assert.ok(retrieved, "Task should exist after DB reopening");
    assert.strictEqual(retrieved.id, task.id);
    assert.strictEqual(retrieved.title, "Offline Sync Engine Implementation");
    assert.strictEqual(retrieved.status, "pending");
    assert.strictEqual(retrieved.revision, 1);
    db2.close();
    console.log("  [PASS] Task persisted and restored successfully across restart.");
  }

  // -------------------------------------------------------------
  // Test 2: State Machine Transitions
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 2: Valid and invalid state transitions...");
  {
    const db = new CoordinatorDatabase(":memory:");
    const service = new CoordinatorService(db);
    const task = service.createTask({ title: "Parser bugfix" });

    // Valid: pending -> assigned
    const t1 = service.transitionTask(task.id, {
      targetStatus: "assigned",
      baseRevision: 1,
      ownerId: "agent-role2",
    });
    assert.strictEqual(t1.status, "assigned");
    assert.strictEqual(t1.revision, 2);

    // Valid: assigned -> running
    const t2 = service.transitionTask(task.id, {
      targetStatus: "running",
      baseRevision: 2,
    });
    assert.strictEqual(t2.status, "running");
    assert.strictEqual(t2.revision, 3);

    // Invalid: running -> pending (not allowed by state machine)
    assert.throws(
      () => {
        service.transitionTask(task.id, {
          targetStatus: "pending",
          baseRevision: 3,
        });
      },
      ValidationError,
      "Should reject invalid transition from running to pending"
    );

    // Valid: running -> review
    const t3 = service.transitionTask(task.id, {
      targetStatus: "review",
      baseRevision: 3,
    });
    assert.strictEqual(t3.status, "review");
    assert.strictEqual(t3.revision, 4);

    // Valid: review -> done
    const t4 = service.transitionTask(task.id, {
      targetStatus: "done",
      baseRevision: 4,
    });
    assert.strictEqual(t4.status, "done");
    assert.strictEqual(t4.revision, 5);

    db.close();
    console.log("  [PASS] Valid transitions incremented revisions; invalid transitions rejected.");
  }

  // -------------------------------------------------------------
  // Test 3: Revision Conflict Detection
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 3: Revision conflict detection...");
  {
    const db = new CoordinatorDatabase(":memory:");
    const service = new CoordinatorService(db);
    const task = service.createTask({ title: "Concurrent task" });

    // Transition once: revision is now 2
    service.transitionTask(task.id, {
      targetStatus: "assigned",
      baseRevision: 1,
    });

    // Attempt concurrent transition with stale revision 1
    assert.throws(
      () => {
        service.transitionTask(task.id, {
          targetStatus: "running",
          baseRevision: 1, // Stale!
        });
      },
      ConflictError,
      "Should throw ConflictError on stale baseRevision"
    );

    try {
      service.transitionTask(task.id, {
        targetStatus: "running",
        baseRevision: 1,
      });
    } catch (err) {
      const conflict = err as ConflictError;
      assert.strictEqual(conflict.currentRevision, 2);
      assert.strictEqual(conflict.baseRevision, 1);
    }

    db.close();
    console.log("  [PASS] Stale mutations caught with ConflictError (revision mismatch).");
  }

  // -------------------------------------------------------------
  // Test 4: HTTP REST API & Status Codes
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 4: HTTP REST API Integration...");
  const TEST_PORT = 49152;
  const { app, db } = createServer(":memory:");
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 4.1 Health Check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthData = await healthRes.json() as Record<string, unknown>;
    assert.strictEqual(healthData.status, "ok");

    // 4.2 Create Task
    const createRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Build API Gateway",
        description: "Express router with revision support",
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createdTask = await createRes.json() as Record<string, unknown>;
    assert.ok(createdTask.id);
    assert.strictEqual(createdTask.revision, 1);
    assert.strictEqual(createdTask.status, "pending");

    // 4.3 Stale Transition -> Expect 409 Conflict
    const staleRes = await fetch(`${baseUrl}/api/tasks/${createdTask.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetStatus: "assigned",
        baseRevision: 999, // Stale!
      }),
    });
    assert.strictEqual(staleRes.status, 409);
    const conflictData = await staleRes.json() as Record<string, unknown>;
    assert.strictEqual(conflictData.error, "Conflict");
    assert.strictEqual(conflictData.currentRevision, 1);

    // 4.4 Valid Transition -> Expect 200 OK
    const validRes = await fetch(`${baseUrl}/api/tasks/${createdTask.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetStatus: "assigned",
        baseRevision: 1,
        ownerId: "agent-1",
      }),
    });
    assert.strictEqual(validRes.status, 200);
    const updatedTask = await validRes.json() as Record<string, unknown>;
    assert.strictEqual(updatedTask.status, "assigned");
    assert.strictEqual(updatedTask.revision, 2);

    // 4.5 Register and Query Agent
    const agentRes = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "agent-codex-1",
        name: "Repair Worker Alpha",
        status: "running",
        runtimeAvailable: true,
        currentTaskId: createdTask.id,
      }),
    });
    assert.strictEqual(agentRes.status, 200);

    const listAgentsRes = await fetch(`${baseUrl}/api/agents`);
    const agents = await listAgentsRes.json() as Record<string, unknown>[];
    assert.ok(agents.some((a) => a.id === "agent-codex-1"));

    console.log("  [PASS] REST API endpoints returned expected HTTP status codes (200, 201, 409).");
  } finally {
    // Keep server open for Test 5
  }

  // -------------------------------------------------------------
  // Test 5: Real-time SSE Event Delivery
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 5: Server-Sent Events (SSE) Stream...");
  {
    const receivedEvents: ActivityEvent[] = [];

    // Connect to SSE stream
    const sseReq = http.request(`${baseUrl}/api/events/stream`, {
      headers: { Accept: "text/event-stream" },
    });

    const sseConnected = new Promise<void>((resolve) => {
      sseReq.on("response", (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers["content-type"], "text/event-stream");

        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            if (block.includes("event: connected")) {
              resolve();
            } else if (block.includes("event: activity")) {
              const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine) {
                const parsed = JSON.parse(dataLine.replace("data: ", ""));
                receivedEvents.push(parsed);
              }
            }
          }
        });
      });
    });

    sseReq.end();
    await sseConnected;

    // Trigger an activity event via API
    await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "SSE Broadcast Test Task" }),
    });

    // Wait briefly for delivery
    await new Promise((r) => setTimeout(r, 200));
    sseReq.destroy();

    assert.ok(receivedEvents.length > 0, "Should have received live SSE event");
    const taskEvent = receivedEvents.find((e) => e.type === "task_created");
    assert.ok(taskEvent, "Received event should be task_created");
    assert.strictEqual((taskEvent.payload as Record<string, unknown>).title, "SSE Broadcast Test Task");

    console.log("  [PASS] Live SSE event streamed to client without refresh.");
  }

  // -------------------------------------------------------------
  // Test 6: Patch Proposal & Approval Lifecycle
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 6: Patch Proposal and Approval Lifecycle...");
  {
    const tRes = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Fix division by zero in auth.ts" }),
    });
    const task = await tRes.json() as Record<string, unknown>;

    await fetch(`${baseUrl}/api/tasks/${task.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStatus: "running", baseRevision: 1 }),
    });

    // Propose patch
    const patchRes = await fetch(`${baseUrl}/api/patches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        runId: "run-402",
        diffContent: "--- a/auth.ts\n+++ b/auth.ts\n@@ -10,3 +10,3 @@\n-return x / 0;\n+return x / 1;",
        testOutput: "PASS: all 12 tests passed",
      }),
    });
    assert.strictEqual(patchRes.status, 201);
    const patch = await patchRes.json() as Record<string, unknown>;
    assert.strictEqual(patch.status, "pending");

    // Task should now be in 'review' status
    const reviewTaskRes = await fetch(`${baseUrl}/api/tasks/${task.id}`);
    const reviewTask = await reviewTaskRes.json() as Record<string, unknown>;
    assert.strictEqual(reviewTask.status, "review");

    // Approve patch
    const approveRes = await fetch(`${baseUrl}/api/patches/${patch.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: "human-lead" }),
    });
    assert.strictEqual(approveRes.status, 200);
    const approvedPatch = await approveRes.json() as Record<string, unknown>;
    assert.strictEqual(approvedPatch.status, "approved");

    // Task should now be 'done'
    const doneTaskRes = await fetch(`${baseUrl}/api/tasks/${task.id}`);
    const doneTask = await doneTaskRes.json() as Record<string, unknown>;
    assert.strictEqual(doneTask.status, "done");

    console.log("  [PASS] Patch proposed -> task moved to review -> approved -> task moved to done.");
  }

  // Clean up server
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();

  // Clean test files
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }

  console.log("\n=== ALL ROLE 1 TESTS PASSED SUCCESSFULLY! ===");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
