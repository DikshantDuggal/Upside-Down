/**
 * Test Group E & F: Communication & Offline Functionality Test Suite
 * Protocol Version: 3.0
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CoordinatorDatabase } from "../db/database.ts";
import { CoordinatorService } from "../core/coordinator.ts";
import { SyncEngine } from "../sync/syncEngine.ts";
import { BoardAdapter } from "../sync/boardAdapter.ts";
import type { SyncEvent } from "../../contracts/sync.ts";

async function runSyncOfflineTests() {
  console.log("\n=== TEST GROUP E & F: COMMUNICATION & OFFLINE FUNCTIONALITY ===");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "upside-sync-test-"));
  const dbFile = path.join(tmpDir, "sync_test.db");

  try {
    // ----------------------------------------------------
    // Test 1: Durable Offline Outbox across process restarts
    // ----------------------------------------------------
    console.log("\n[RUN] Test 1: Durable Offline Outbox persistence across restarts...");
    {
      const db1 = new CoordinatorDatabase(dbFile);
      const coord1 = new CoordinatorService(db1);
      const sync1 = new SyncEngine(db1, coord1, { isOnline: false });

      // Enqueue 3 events while offline
      sync1.enqueueOutbox("peer-node-b", "TASK_MUTATION", { status: "running" }, "task-101", 1);
      sync1.enqueueOutbox("peer-node-b", "TASK_MUTATION", { status: "review" }, "task-101", 2);
      sync1.enqueueOutbox("board-issue-1", "AGENT_STATUS", { status: "working" });

      const pending1 = sync1.getPendingOutbox();
      assert.equal(pending1.length, 3, "Should have 3 pending outbox items");
      db1.close();

      // Restart: open fresh DB from the same file
      const db2 = new CoordinatorDatabase(dbFile);
      const coord2 = new CoordinatorService(db2);
      const sync2 = new SyncEngine(db2, coord2, { isOnline: false });

      const pending2 = sync2.getPendingOutbox();
      assert.equal(pending2.length, 3, "Outbox items must survive process restart in SQLite");
      assert.equal(pending2[0].destination, "peer-node-b");
      assert.equal(pending2[0].status, "pending");

      db2.close();
      console.log("  [PASS] Offline outbox successfully persisted across process restarts.");
    }

    // ----------------------------------------------------
    // Test 2: Outbox Flush and Reconnect Dispatch
    // ----------------------------------------------------
    console.log("\n[RUN] Test 2: Automatic flush on reconnection and retry tracking...");
    {
      const db = new CoordinatorDatabase(dbFile);
      const coord = new CoordinatorService(db);

      let dispatchedCount = 0;
      const mockTransport = async (item: { id: string }) => {
        dispatchedCount++;
        return true;
      };

      const sync = new SyncEngine(db, coord, {
        isOnline: false,
        transportSender: mockTransport,
      });

      assert.equal(sync.getOnlineStatus(), false);
      assert.equal(dispatchedCount, 0, "No dispatch while offline");

      // Reconnect
      sync.setOnlineStatus(true);
      assert.equal(sync.getOnlineStatus(), true);

      // Wait a tick for async flush
      await new Promise((r) => setTimeout(r, 100));

      const pendingAfter = sync.getPendingOutbox();
      assert.equal(pendingAfter.length, 0, "All items should be delivered after reconnect");
      assert.equal(dispatchedCount, 3, "Transport sender should have delivered all 3 items");

      db.close();
      console.log("  [PASS] Automatic outbox flush on reconnect verified.");
    }

    // ----------------------------------------------------
    // Test 3: Duplicate Suppression (Idempotency)
    // ----------------------------------------------------
    console.log("\n[RUN] Test 3: Duplicate suppression and idempotency guarantee...");
    {
      const db = new CoordinatorDatabase(path.join(tmpDir, "idempotency.db"));
      const coord = new CoordinatorService(db);
      const sync = new SyncEngine(db, coord);

      const syncEvent: SyncEvent = {
        eventId: "evt-unique-12345",
        deviceId: "dev-laptop-a",
        sequence: 1,
        taskId: "task-202",
        type: "TASK_CREATED",
        payload: { title: "Fix crash on boot", status: "pending" },
      };

      const res1 = sync.ingestIncomingEvent(syncEvent);
      assert.equal(res1.status, "applied");
      assert.equal(res1.applied, true);

      // Ingest the exact same event again
      const res2 = sync.ingestIncomingEvent(syncEvent);
      assert.equal(res2.status, "duplicate", "Second ingestion must be detected as duplicate");
      assert.equal(res2.applied, false);

      const tasks = coord.listTasks();
      assert.equal(tasks.filter((t) => t.id === "task-202").length, 1, "Must not create duplicate tasks");

      db.close();
      console.log("  [PASS] Duplicate events suppressed with zero side effects.");
    }

    // ----------------------------------------------------
    // Test 4: Concurrent Conflict Detection & Resolution
    // ----------------------------------------------------
    console.log("\n[RUN] Test 4: Conflict detection without silent overwrite and human resolution...");
    {
      const db = new CoordinatorDatabase(path.join(tmpDir, "conflict.db"));
      const coord = new CoordinatorService(db);
      const sync = new SyncEngine(db, coord);

      // Create initial task at revision 1
      const initialTask = coord.createTask({ title: "Concurrent Task" });
      assert.equal(initialTask.revision, 1);

      // Local node transitions task to assigned -> revision becomes 2
      coord.transitionTask(initialTask.id, {
        targetStatus: "assigned",
        baseRevision: 1,
        ownerId: "agent-local",
      });
      const localTask = coord.getTask(initialTask.id);
      assert.equal(localTask.revision, 2);
      assert.equal(localTask.status, "assigned");

      // Remote peer concurrently sends an update based on stale baseRevision 1
      const remoteEvent: SyncEvent = {
        eventId: "remote-evt-999",
        deviceId: "peer-desktop-c",
        sequence: 1,
        taskId: initialTask.id,
        baseRevision: 1, // Stale! Local is already 2
        type: "TASK_MUTATION",
        payload: { targetStatus: "running", ownerId: "agent-remote" },
      };

      const ingestRes = sync.ingestIncomingEvent(remoteEvent);
      assert.equal(ingestRes.status, "conflict", "Revision divergence must trigger conflict record");
      assert.equal(ingestRes.applied, false, "Must NOT silently overwrite local revision");

      // Verify local task was untouched
      const taskAfter = coord.getTask(initialTask.id);
      assert.equal(taskAfter.revision, 2);
      assert.equal(taskAfter.ownerId, "agent-local");

      // Check conflict record in database
      const conflicts = sync.getConflicts(false);
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0].taskId, initialTask.id);
      assert.equal(conflicts[0].localRevision, 2);
      assert.equal(conflicts[0].incomingRevision, 2);

      // Resolve conflict: accept incoming
      sync.resolveConflict(conflicts[0].id, "accepted_incoming");
      const resolvedConflicts = sync.getConflicts(false);
      assert.equal(resolvedConflicts.length, 0, "Conflict should be marked resolved");

      const resolvedTask = coord.getTask(initialTask.id);
      assert.equal(resolvedTask.status, "running", "Resolved status applied");
      assert.equal(resolvedTask.ownerId, "agent-remote");

      db.close();
      console.log("  [PASS] Conflict detected, protected from silent overwrite, and resolved cleanly.");
    }

    // ----------------------------------------------------
    // Test 5: Message Board Adapter Mentions & Simulated Offline
    // ----------------------------------------------------
    console.log("\n[RUN] Test 5: Board Adapter mention detection, parsing, and network simulation...");
    {
      const board = new BoardAdapter({ mockMode: true });

      // Add mock comments
      board.addMockComment({
        id: "c1",
        user: "ArhaanArora",
        createdAt: new Date().toISOString(),
        body: "[ArhaanArora's Codex] Hello @DikshantDuggal please check PR #3",
      });
      board.addMockComment({
        id: "c2",
        user: "SomeOtherDev",
        createdAt: new Date().toISOString(),
        body: "General progress update for @all",
      });
      board.addMockComment({
        id: "c3",
        user: "ThirdDev",
        createdAt: new Date().toISOString(),
        body: "Unrelated message without mention",
      });

      const comments = await board.readRecentComments(10, "DikshantDuggal");
      assert.equal(comments.length, 3);
      assert.equal(comments[0].isMention, true, "c1 should be flagged as mention for DikshantDuggal");
      assert.equal(comments[1].isMention, true, "c2 with @all should be flagged as mention");
      assert.equal(comments[2].isMention, false, "c3 without mention should not be flagged");

      // Test ACK parser
      const ackParsed = board.parseHandoffAck(
        "[ArhaanArora's AGENT] @DikshantDuggal HANDOFF-ACK\n\nTest-ID: TEST-999\nStatus: RECEIVED",
        "TEST-999"
      );
      assert.equal(ackParsed.isValid, true);
      assert.equal(ackParsed.status, "RECEIVED");

      // Test Simulated Offline Network Failure
      board.setSimulatedOffline(true);
      await assert.rejects(
        async () => {
          await board.postComment("Test comment");
        },
        /simulated offline mode/,
        "Should throw network error when offline"
      );

      console.log("  [PASS] Board Adapter mention detection and offline failure handling verified.");
    }

    console.log("\n=== ALL TEST GROUP E & F TESTS PASSED! ===");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runSyncOfflineTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
