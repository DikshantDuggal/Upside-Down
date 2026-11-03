/**
 * SQLite Persistent Storage Engine
 * Role 1 — Core Backend & Coordinator / Architecture: UD-IC/1.0
 * Uses Node.js native DatabaseSync (node:sqlite)
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskStatus,
  PatchRecordV1,
  RunRecord,
  ApplicationRecord,
  Checkpoint,
  TestEvidence,
} from "../../contracts/task.ts";
import type { ActivityEvent, CanonicalEvent } from "../../contracts/events.ts";
import type { AgentInfo } from "../../contracts/agent.ts";
import type { SyncEvent, ConflictRecord } from "../../contracts/sync.ts";
import type { Project } from "../../contracts/project.ts";
import type { StructuredHandoff } from "../../contracts/handoff.ts";
import type {
  Ack,
  ConflictRecordV1,
} from "../core/syncGateway.ts";

export interface OutboxItem {
  id: string;
  eventId: string;
  destination: string;
  status: "pending" | "delivered" | "failed";
  payload: Record<string, unknown>;
  retryCount: number;
  createdAt: string;
  lastAttemptAt?: string;
  errorMessage?: string;
}

export interface PatchRecord {
  id: string;
  taskId: string;
  runId: string;
  status: "pending" | "approved" | "rejected";
  patchPath?: string;
  diffContent: string;
  testOutput?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewerId?: string;
  rejectionReason?: string;
  baseCommit?: string;
  taskRevision?: number;
  diffHash?: string;
  applicationStatus?: "not_applied" | "queued" | "applying" | "verified" | "failed" | "blocked";
  applicationId?: string;
}

export class CoordinatorDatabase {
  private db: DatabaseSync;
  private coordinatorEpoch: string = "";

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  public transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const res = fn();
      this.db.exec("COMMIT;");
      return res;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch (_) {}
      throw err;
    }
  }

  public getCoordinatorEpoch(): string {
    return this.coordinatorEpoch;
  }

  private initializeSchema(): void {
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        owner_id TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_task ON activity_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_events_time ON activity_events(timestamp);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        runtime_available INTEGER NOT NULL DEFAULT 1,
        current_task_id TEXT,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        patch_path TEXT,
        diff_content TEXT NOT NULL,
        test_output TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewer_id TEXT,
        rejection_reason TEXT,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_patches_task ON patches(task_id);

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        destination TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status);

      CREATE TABLE IF NOT EXISTS sync_events (
        event_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        task_id TEXT,
        base_revision INTEGER,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_device_seq ON sync_events(device_id, sequence);

      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        local_revision INTEGER NOT NULL,
        incoming_revision INTEGER NOT NULL,
        local_payload TEXT NOT NULL,
        incoming_payload TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolution TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conflicts_task ON conflicts(task_id);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        task_id TEXT,
        dependent_task_id TEXT,
        handoff_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_handoffs_to ON handoffs(to_agent);
      CREATE INDEX IF NOT EXISTS idx_handoffs_task ON handoffs(task_id);

      -- UD-IC/1.0 Canonical Gateway, Conflict, and Journal Tables --
      CREATE TABLE IF NOT EXISTS coordinator_inbox (
        event_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_device_seq ON coordinator_inbox(device_id, sequence);

      CREATE TABLE IF NOT EXISTS device_progress (
        device_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canonical_journal (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        epoch TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_journal_epoch_cursor ON canonical_journal(epoch, cursor);

      CREATE TABLE IF NOT EXISTS conflicts_v1 (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        current_revision INTEGER NOT NULL,
        proposed_json TEXT NOT NULL,
        current_task_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        resolution_revision INTEGER NOT NULL DEFAULT 1,
        detected_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT,
        resolution TEXT,
        resulting_task_revision INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_conflicts_v1_status ON conflicts_v1(status);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        cancellation_requested INTEGER NOT NULL DEFAULT 0,
        patch_id TEXT,
        evidence_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        patch_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expected_base_commit TEXT NOT NULL,
        target_workspace_id TEXT NOT NULL,
        diff_hash TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        commit_hash TEXT,
        evidence_json TEXT,
        error_json TEXT
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        task_revision INTEGER NOT NULL,
        stage TEXT NOT NULL,
        artifact_hash TEXT,
        summary TEXT NOT NULL,
        recovery_capability TEXT NOT NULL DEFAULT 'metadata_only',
        created_at TEXT NOT NULL
      );
    `);

    // Ensure additive columns in patches
    const patchCols = this.db.prepare("PRAGMA table_info(patches)").all() as { name: string }[];
    const names = new Set(patchCols.map((c) => c.name));
    if (!names.has("base_commit")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN base_commit TEXT;");
    }
    if (!names.has("task_revision")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN task_revision INTEGER;");
    }
    if (!names.has("diff_hash")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN diff_hash TEXT;");
    }
    if (!names.has("review_json")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN review_json TEXT;");
    }
    if (!names.has("application_status")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN application_status TEXT DEFAULT 'not_applied';");
    }
    if (!names.has("application_id")) {
      this.db.exec("ALTER TABLE patches ADD COLUMN application_id TEXT;");
    }

    // Initialize epoch
    const epochRow = this.db.prepare("SELECT value FROM system_meta WHERE key = 'coordinator_epoch'").get() as { value: string } | undefined;
    if (!epochRow) {
      const newEpoch = `epoch-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      this.db.prepare("INSERT INTO system_meta (key, value) VALUES ('coordinator_epoch', ?)").run(newEpoch);
      this.coordinatorEpoch = newEpoch;
    } else {
      this.coordinatorEpoch = epochRow.value;
    }
  }

  // --- Task Operations ---

  public saveTask(task: Task): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, owner_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.title,
      task.description || null,
      task.status,
      task.ownerId || null,
      task.revision,
      task.createdAt,
      task.updatedAt
    );
  }

  public getTask(id: string): Task | null {
    const stmt = this.db.prepare(`
      SELECT id, title, description, status, owner_id as ownerId, revision, created_at as createdAt, updated_at as updatedAt
      FROM tasks
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapTask(row);
  }

  public listTasks(statusFilter?: TaskStatus): Task[] {
    let stmt;
    if (statusFilter) {
      stmt = this.db.prepare(`
        SELECT id, title, description, status, owner_id as ownerId, revision, created_at as createdAt, updated_at as updatedAt
        FROM tasks
        WHERE status = ?
        ORDER BY created_at DESC
      `);
      return (stmt.all(statusFilter) as Record<string, unknown>[]).map((r) => this.mapTask(r));
    } else {
      stmt = this.db.prepare(`
        SELECT id, title, description, status, owner_id as ownerId, revision, created_at as createdAt, updated_at as updatedAt
        FROM tasks
        ORDER BY created_at DESC
      `);
      return (stmt.all() as Record<string, unknown>[]).map((r) => this.mapTask(r));
    }
  }

  public updateTaskWithRevision(
    id: string,
    targetStatus: TaskStatus,
    baseRevision: number,
    ownerId?: string,
    description?: string
  ): { success: boolean; task?: Task; currentRevision?: number } {
    const current = this.getTask(id);
    if (!current) {
      return { success: false };
    }

    if (current.revision !== baseRevision) {
      return { success: false, currentRevision: current.revision };
    }

    const nextRevision = current.revision + 1;
    const now = new Date().toISOString();
    const finalOwner = ownerId !== undefined ? ownerId : current.ownerId;
    const finalDesc = description !== undefined ? description : current.description;

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, owner_id = ?, description = ?, revision = ?, updated_at = ?
      WHERE id = ? AND revision = ?
    `);

    const result = stmt.run(
      targetStatus,
      finalOwner || null,
      finalDesc || null,
      nextRevision,
      now,
      id,
      baseRevision
    );

    if (result.changes === 0) {
      const rechecked = this.getTask(id);
      return { success: false, currentRevision: rechecked?.revision };
    }

    const updatedTask: Task = {
      id,
      title: current.title,
      description: finalDesc,
      status: targetStatus,
      ownerId: finalOwner,
      revision: nextRevision,
      createdAt: current.createdAt,
      updatedAt: now,
    };

    return { success: true, task: updatedTask };
  }

  // --- Event Operations ---

  public saveEvent(event: ActivityEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO activity_events (id, task_id, source, type, timestamp, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.taskId || null,
      event.source,
      event.type,
      event.timestamp,
      JSON.stringify(event.payload || {})
    );
  }

  public listEvents(taskId?: string, since?: string, limit: number = 100): ActivityEvent[] {
    let query = `SELECT id, task_id as taskId, source, type, timestamp, payload FROM activity_events WHERE 1=1`;
    const params: (string | number)[] = [];

    if (taskId) {
      query += ` AND task_id = ?`;
      params.push(taskId);
    }
    if (since) {
      query += ` AND timestamp > ?`;
      params.push(since);
    }

    query += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapEvent(r));
  }

  // --- Agent Operations ---

  public upsertAgent(agent: AgentInfo): void {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, status, runtime_available, current_task_id, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status,
        runtime_available = excluded.runtime_available,
        current_task_id = excluded.current_task_id,
        last_seen_at = excluded.last_seen_at
    `);
    stmt.run(
      agent.id,
      agent.name,
      agent.status,
      agent.runtimeAvailable ? 1 : 0,
      agent.currentTaskId || null,
      agent.lastSeenAt
    );
  }

  public listAgents(): AgentInfo[] {
    const stmt = this.db.prepare(`
      SELECT id, name, status, runtime_available as runtimeAvailable, current_task_id as currentTaskId, last_seen_at as lastSeenAt
      FROM agents
      ORDER BY last_seen_at DESC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: r.status as AgentInfo["status"],
      runtimeAvailable: Boolean(r.runtimeAvailable),
      currentTaskId: r.currentTaskId ? String(r.currentTaskId) : undefined,
      lastSeenAt: String(r.lastSeenAt),
    }));
  }

  // --- Patch Operations ---

  public savePatch(patch: PatchRecord | PatchRecordV1): void {
    const stmt = this.db.prepare(`
      INSERT INTO patches (id, task_id, run_id, status, patch_path, diff_content, test_output, created_at, reviewed_at, reviewer_id, rejection_reason, base_commit, task_revision, diff_hash, review_json, application_status, application_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const p1 = patch as PatchRecordV1;
    stmt.run(
      patch.id,
      patch.taskId,
      patch.runId,
      patch.status,
      patch.patchPath || null,
      patch.diffContent,
      patch.testOutput || null,
      patch.createdAt,
      patch.reviewedAt || null,
      patch.reviewerId || null,
      patch.rejectionReason || null,
      p1.baseCommit || null,
      p1.taskRevision || null,
      p1.diffHash || null,
      p1.review ? JSON.stringify(p1.review) : null,
      p1.applicationStatus || "not_applied",
      p1.applicationId || null
    );
  }

  public getPatch(id: string): PatchRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason,
             base_commit as baseCommit, task_revision as taskRevision, diff_hash as diffHash,
             application_status as applicationStatus, application_id as applicationId
      FROM patches
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapPatch(row);
  }

  public getPatchV1(id: string): PatchRecordV1 | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason,
             base_commit as baseCommit, task_revision as taskRevision, diff_hash as diffHash,
             review_json as reviewJson, application_status as applicationStatus, application_id as applicationId
      FROM patches
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapPatchV1(row);
  }

  public listPatchesByTaskId(taskId: string): PatchRecordV1[] {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason,
             base_commit as baseCommit, task_revision as taskRevision, diff_hash as diffHash,
             review_json as reviewJson, application_status as applicationStatus, application_id as applicationId
      FROM patches
      WHERE task_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.mapPatchV1(r));
  }

  public getPatchByTaskId(taskId: string): PatchRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason,
             base_commit as baseCommit, task_revision as taskRevision, diff_hash as diffHash,
             application_status as applicationStatus, application_id as applicationId
      FROM patches
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapPatch(row);
  }

  public updatePatchStatus(
    id: string,
    status: "approved" | "rejected",
    reviewerId?: string,
    rejectionReason?: string
  ): PatchRecord | null {
    const current = this.getPatch(id);
    if (!current) return null;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE patches
      SET status = ?, reviewed_at = ?, reviewer_id = ?, rejection_reason = ?
      WHERE id = ?
    `);
    stmt.run(status, now, reviewerId || null, rejectionReason || null, id);

    return this.getPatch(id);
  }

  public updatePatchApplication(
    id: string,
    applicationStatus: "not_applied" | "queued" | "applying" | "verified" | "failed" | "blocked",
    applicationId?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE patches
      SET application_status = ?, application_id = ?
      WHERE id = ?
    `);
    stmt.run(applicationStatus, applicationId || null, id);
  }

  // --- UD-IC/1.0 Inbox & Outcome Operations ---

  public getInboxEntry(eventId: string): { eventId: string; deviceId: string; sequence: number; payloadHash: string; status: string; outcome: Ack } | null {
    const stmt = this.db.prepare(`
      SELECT event_id as eventId, device_id as deviceId, sequence, payload_hash as payloadHash, status, outcome_json as outcomeJson
      FROM coordinator_inbox WHERE event_id = ?
    `);
    const row = stmt.get(eventId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      eventId: String(row.eventId),
      deviceId: String(row.deviceId),
      sequence: Number(row.sequence),
      payloadHash: String(row.payloadHash),
      status: String(row.status),
      outcome: JSON.parse(String(row.outcomeJson)) as Ack,
    };
  }

  public saveInboxEntry(
    eventId: string,
    deviceId: string,
    sequence: number,
    payloadHash: string,
    status: string,
    outcome: Ack
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO coordinator_inbox (event_id, device_id, sequence, payload_hash, status, outcome_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(eventId, deviceId, sequence, payloadHash, status, JSON.stringify(outcome), new Date().toISOString());
  }

  public getDeviceLastSequence(deviceId: string): number {
    const stmt = this.db.prepare("SELECT last_sequence as lastSequence FROM device_progress WHERE device_id = ?");
    const row = stmt.get(deviceId) as { lastSequence: number } | undefined;
    return row ? Number(row.lastSequence) : 0;
  }

  public setDeviceLastSequence(deviceId: string, sequence: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO device_progress (device_id, last_sequence, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET last_sequence = excluded.last_sequence, updated_at = excluded.updated_at
    `);
    stmt.run(deviceId, sequence, new Date().toISOString());
  }

  // --- Canonical Journal Operations ---

  public appendCanonicalEvent(event: CanonicalEvent): string {
    const stmt = this.db.prepare(`
      INSERT INTO canonical_journal (epoch, event_id, event_json, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(this.coordinatorEpoch, event.id, JSON.stringify(event), event.timestamp);
    const cursorId = Number(result.lastInsertRowid);
    const cursor = `${this.coordinatorEpoch}:${cursorId}`;
    event.cursor = cursor;
    event.coordinatorEpoch = this.coordinatorEpoch;
    event.contractVersion = "UD-IC/1.0";

    this.db.prepare("UPDATE canonical_journal SET event_json = ? WHERE cursor = ?").run(JSON.stringify(event), cursorId);
    return cursor;
  }

  public pullJournal(afterCursor: string | undefined, limit: number): { events: CanonicalEvent[]; nextCursor: string; hasMore: boolean } {
    const effectiveLimit = Math.min(Math.max(limit || 100, 1), 200);
    let afterCursorNum = 0;
    if (afterCursor) {
      const parts = afterCursor.split(":");
      if (parts.length === 2) {
        if (parts[0] !== this.coordinatorEpoch) {
          const err = new Error("Cursor belongs to expired or different epoch");
          (err as any).code = "CURSOR_EXPIRED";
          throw err;
        }
        afterCursorNum = parseInt(parts[1], 10) || 0;
      }
    }

    const stmt = this.db.prepare(`
      SELECT cursor, event_json as eventJson
      FROM canonical_journal
      WHERE epoch = ? AND cursor > ?
      ORDER BY cursor ASC
      LIMIT ?
    `);
    const rows = stmt.all(this.coordinatorEpoch, afterCursorNum, effectiveLimit + 1) as { cursor: number; eventJson: string }[];
    const hasMore = rows.length > effectiveLimit;
    const items = hasMore ? rows.slice(0, effectiveLimit) : rows;
    const events: CanonicalEvent[] = items.map((r) => JSON.parse(r.eventJson));

    const lastCursorNum = items.length > 0 ? items[items.length - 1].cursor : afterCursorNum;
    const nextCursor = `${this.coordinatorEpoch}:${lastCursorNum}`;

    return { events, nextCursor, hasMore };
  }

  // --- Conflicts V1 Operations ---

  public saveConflictV1(c: ConflictRecordV1): void {
    const stmt = this.db.prepare(`
      INSERT INTO conflicts_v1 (id, task_id, event_id, device_id, base_revision, current_revision, proposed_json, current_task_json, status, resolution_revision, detected_at, resolved_at, resolved_by, resolution, resulting_task_revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      c.id,
      c.taskId,
      c.eventId,
      c.deviceId,
      c.baseRevision,
      c.currentRevision,
      JSON.stringify(c.proposed),
      JSON.stringify(c.currentTask),
      c.status,
      c.resolutionRevision,
      c.detectedAt,
      c.resolvedAt || null,
      c.resolvedBy || null,
      c.resolution || null,
      c.resultingTaskRevision || null
    );
  }

  public getConflictV1(id: string): ConflictRecordV1 | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, event_id as eventId, device_id as deviceId, base_revision as baseRevision,
             current_revision as currentRevision, proposed_json as proposedJson, current_task_json as currentTaskJson,
             status, resolution_revision as resolutionRevision, detected_at as detectedAt, resolved_at as resolvedAt,
             resolved_by as resolvedBy, resolution, resulting_task_revision as resultingTaskRevision
      FROM conflicts_v1 WHERE id = ?
    `);
    const r = stmt.get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return this.mapConflictV1(r);
  }

  public listConflictsV1(status: "open" | "resolved" = "open", after?: string, limit: number = 100): ConflictRecordV1[] {
    let sql = `
      SELECT id, task_id as taskId, event_id as eventId, device_id as deviceId, base_revision as baseRevision,
             current_revision as currentRevision, proposed_json as proposedJson, current_task_json as currentTaskJson,
             status, resolution_revision as resolutionRevision, detected_at as detectedAt, resolved_at as resolvedAt,
             resolved_by as resolvedBy, resolution, resulting_task_revision as resultingTaskRevision
      FROM conflicts_v1 WHERE status = ?
    `;
    const params: (string | number)[] = [status];
    if (after) {
      sql += ` AND id > ?`;
      params.push(after);
    }
    sql += ` ORDER BY detected_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapConflictV1(r));
  }

  public updateConflictV1Resolution(
    id: string,
    resolutionRevision: number,
    resolvedBy: string,
    resolution: "keep_authoritative" | "retry_proposal" | "custom_transition",
    resultingTaskRevision?: number
  ): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE conflicts_v1
      SET status = 'resolved', resolution_revision = ?, resolved_at = ?, resolved_by = ?, resolution = ?, resulting_task_revision = ?
      WHERE id = ?
    `);
    const result = stmt.run(resolutionRevision, now, resolvedBy, resolution, resultingTaskRevision || null, id);
    return result.changes > 0;
  }

  // --- Runs Operations ---

  public saveRun(run: RunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, task_id, base_revision, workspace_id, base_commit, provider, status, stage, attempts, max_attempts, cancellation_requested, patch_id, evidence_json, error_json, created_at, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id,
      run.taskId,
      run.baseRevision,
      run.workspaceId,
      run.baseCommit,
      run.provider,
      run.status,
      run.stage,
      run.attempts,
      run.maxAttempts,
      run.cancellationRequested ? 1 : 0,
      run.patchId || null,
      JSON.stringify(run.evidence || []),
      run.error ? JSON.stringify(run.error) : null,
      run.createdAt,
      run.startedAt || null,
      run.endedAt || null
    );
  }

  public getRun(id: string): RunRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, base_revision as baseRevision, workspace_id as workspaceId,
             base_commit as baseCommit, provider, status, stage, attempts, max_attempts as maxAttempts,
             cancellation_requested as cancellationRequested, patch_id as patchId,
             evidence_json as evidenceJson, error_json as errorJson, created_at as createdAt,
             started_at as startedAt, ended_at as endedAt
      FROM runs WHERE id = ?
    `);
    const r = stmt.get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      taskId: String(r.taskId),
      baseRevision: Number(r.baseRevision),
      workspaceId: String(r.workspaceId),
      baseCommit: String(r.baseCommit),
      provider: r.provider as RunRecord["provider"],
      status: r.status as RunRecord["status"],
      stage: r.stage as RunRecord["stage"],
      attempts: Number(r.attempts),
      maxAttempts: Number(r.maxAttempts),
      cancellationRequested: Boolean(r.cancellationRequested),
      patchId: r.patchId ? String(r.patchId) : undefined,
      evidence: JSON.parse(String(r.evidenceJson || "[]")) as TestEvidence[],
      error: r.errorJson ? JSON.parse(String(r.errorJson)) : undefined,
      createdAt: String(r.createdAt),
      startedAt: r.startedAt ? String(r.startedAt) : undefined,
      endedAt: r.endedAt ? String(r.endedAt) : undefined,
    };
  }

  public updateRun(run: RunRecord): void {
    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = ?, stage = ?, attempts = ?, cancellation_requested = ?,
          patch_id = ?, evidence_json = ?, error_json = ?, started_at = ?, ended_at = ?
      WHERE id = ?
    `);
    stmt.run(
      run.status,
      run.stage,
      run.attempts,
      run.cancellationRequested ? 1 : 0,
      run.patchId || null,
      JSON.stringify(run.evidence || []),
      run.error ? JSON.stringify(run.error) : null,
      run.startedAt || null,
      run.endedAt || null,
      run.id
    );
  }

  // --- Applications Operations ---

  public saveApplication(app: ApplicationRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO applications (id, patch_id, task_id, status, expected_base_commit, target_workspace_id, diff_hash, requested_by, requested_at, started_at, ended_at, commit_hash, evidence_json, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      app.id,
      app.patchId,
      app.taskId,
      app.status,
      app.expectedBaseCommit,
      app.targetWorkspaceId,
      app.diffHash,
      app.requestedBy,
      app.requestedAt,
      app.startedAt || null,
      app.endedAt || null,
      app.commit || null,
      JSON.stringify(app.evidence || []),
      app.error ? JSON.stringify(app.error) : null
    );
  }

  public getApplication(id: string): ApplicationRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, patch_id as patchId, task_id as taskId, status, expected_base_commit as expectedBaseCommit,
             target_workspace_id as targetWorkspaceId, diff_hash as diffHash, requested_by as requestedBy,
             requested_at as requestedAt, started_at as startedAt, ended_at as endedAt,
             commit_hash as commitHash, evidence_json as evidenceJson, error_json as errorJson
      FROM applications WHERE id = ?
    `);
    const r = stmt.get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      patchId: String(r.patchId),
      taskId: String(r.taskId),
      status: r.status as ApplicationRecord["status"],
      expectedBaseCommit: String(r.expectedBaseCommit),
      targetWorkspaceId: String(r.targetWorkspaceId),
      diffHash: String(r.diffHash),
      requestedBy: String(r.requestedBy),
      requestedAt: String(r.requestedAt),
      startedAt: r.startedAt ? String(r.startedAt) : undefined,
      endedAt: r.endedAt ? String(r.endedAt) : undefined,
      commit: r.commitHash ? String(r.commitHash) : undefined,
      evidence: JSON.parse(String(r.evidenceJson || "[]")) as TestEvidence[],
      error: r.errorJson ? JSON.parse(String(r.errorJson)) : undefined,
    };
  }

  public updateApplication(app: ApplicationRecord): void {
    const stmt = this.db.prepare(`
      UPDATE applications
      SET status = ?, started_at = ?, ended_at = ?, commit_hash = ?, evidence_json = ?, error_json = ?
      WHERE id = ?
    `);
    stmt.run(
      app.status,
      app.startedAt || null,
      app.endedAt || null,
      app.commit || null,
      JSON.stringify(app.evidence || []),
      app.error ? JSON.stringify(app.error) : null,
      app.id
    );
  }

  // --- Checkpoints Operations ---

  public saveCheckpoint(cp: Checkpoint): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, task_id, run_id, device_id, base_commit, task_revision, stage, artifact_hash, summary, recovery_capability, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      cp.id,
      cp.taskId,
      cp.runId,
      cp.deviceId,
      cp.baseCommit,
      cp.taskRevision,
      cp.stage,
      cp.artifactHash || null,
      cp.summary,
      cp.recoveryCapability,
      cp.createdAt
    );
  }

  public listCheckpoints(taskId: string): Checkpoint[] {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, device_id as deviceId, base_commit as baseCommit,
             task_revision as taskRevision, stage, artifact_hash as artifactHash, summary,
             recovery_capability as recoveryCapability, created_at as createdAt
      FROM checkpoints WHERE task_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.taskId),
      runId: String(r.runId),
      deviceId: String(r.deviceId),
      baseCommit: String(r.baseCommit),
      taskRevision: Number(r.taskRevision),
      stage: String(r.stage),
      artifactHash: r.artifactHash ? String(r.artifactHash) : undefined,
      summary: String(r.summary),
      recoveryCapability: "metadata_only" as const,
      createdAt: String(r.createdAt),
    }));
  }

  // --- Sync & Outbox Operations (Legacy) ---

  public saveOutboxItem(item: OutboxItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_outbox (id, event_id, destination, status, payload, retry_count, created_at, last_attempt_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id,
      item.eventId,
      item.destination,
      item.status,
      JSON.stringify(item.payload),
      item.retryCount,
      item.createdAt,
      item.lastAttemptAt || null,
      item.errorMessage || null
    );
  }

  public getPendingOutbox(): OutboxItem[] {
    const stmt = this.db.prepare(`
      SELECT id, event_id as eventId, destination, status, payload, retry_count as retryCount,
             created_at as createdAt, last_attempt_at as lastAttemptAt, error_message as errorMessage
      FROM sync_outbox
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => {
      let payload = {};
      try {
        payload = JSON.parse(String(r.payload || '{}'));
      } catch {
        payload = {};
      }
      return {
        id: String(r.id),
        eventId: String(r.eventId),
        destination: String(r.destination),
        status: r.status as OutboxItem['status'],
        payload: payload as Record<string, unknown>,
        retryCount: Number(r.retryCount),
        createdAt: String(r.createdAt),
        lastAttemptAt: r.lastAttemptAt ? String(r.lastAttemptAt) : undefined,
        errorMessage: r.errorMessage ? String(r.errorMessage) : undefined,
      };
    });
  }

  public updateOutboxStatus(
    id: string,
    status: 'pending' | 'delivered' | 'failed',
    errorMessage?: string
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE sync_outbox
      SET status = ?, last_attempt_at = ?, retry_count = retry_count + 1, error_message = ?
      WHERE id = ?
    `);
    stmt.run(status, now, errorMessage || null, id);
  }

  public saveSyncEvent(event: SyncEvent): boolean {
    if (this.hasSyncEvent(event.eventId)) {
      return false; // Duplicate suppressed
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO sync_events (event_id, device_id, sequence, task_id, base_revision, type, payload, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.eventId,
      event.deviceId,
      event.sequence,
      event.taskId || null,
      event.baseRevision !== undefined ? event.baseRevision : null,
      event.type,
      JSON.stringify(event.payload),
      now
    );
    return true;
  }

  public hasSyncEvent(eventId: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM sync_events WHERE event_id = ?`);
    const row = stmt.get(eventId);
    return !!row;
  }

  public listSyncEvents(): SyncEvent[] {
    const stmt = this.db.prepare(`
      SELECT event_id as eventId, device_id as deviceId, sequence, task_id as taskId,
             base_revision as baseRevision, type, payload
      FROM sync_events
      ORDER BY received_at ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => {
      let payload = {};
      try {
        payload = JSON.parse(String(r.payload || '{}'));
      } catch {
        payload = {};
      }
      return {
        eventId: String(r.eventId),
        deviceId: String(r.deviceId),
        sequence: Number(r.sequence),
        taskId: r.taskId ? String(r.taskId) : undefined,
        baseRevision: r.baseRevision !== null ? Number(r.baseRevision) : undefined,
        type: String(r.type),
        payload: payload as Record<string, unknown>,
      };
    });
  }

  public saveConflict(conflict: ConflictRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO conflicts (id, task_id, local_revision, incoming_revision, local_payload, incoming_payload, detected_at, resolved, resolution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      conflict.id,
      conflict.taskId,
      conflict.localRevision,
      conflict.incomingRevision,
      JSON.stringify(conflict.localPayload),
      JSON.stringify(conflict.incomingPayload),
      conflict.detectedAt,
      conflict.resolved ? 1 : 0,
      conflict.resolution || null
    );
  }

  public getConflicts(resolved?: boolean): ConflictRecord[] {
    let sql = `
      SELECT id, task_id as taskId, local_revision as localRevision, incoming_revision as incomingRevision,
             local_payload as localPayload, incoming_payload as incomingPayload, detected_at as detectedAt,
             resolved, resolution
      FROM conflicts
    `;
    if (resolved !== undefined) {
      sql += ` WHERE resolved = ${resolved ? 1 : 0}`;
    }
    sql += ` ORDER BY detected_at DESC`;
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.taskId),
      localRevision: Number(r.localRevision),
      incomingRevision: Number(r.incomingRevision),
      localPayload: JSON.parse(String(r.localPayload || '{}')),
      incomingPayload: JSON.parse(String(r.incomingPayload || '{}')),
      detectedAt: String(r.detectedAt),
      resolved: Number(r.resolved) === 1,
      resolution: r.resolution as ConflictRecord['resolution'],
    }));
  }

  public resolveConflict(id: string, resolution: 'accepted_incoming' | 'kept_local' | 'custom_merge'): void {
    const stmt = this.db.prepare(`
      UPDATE conflicts
      SET resolved = 1, resolution = ?
      WHERE id = ?
    `);
    stmt.run(resolution, id);
  }

  public close(): void {
    this.db.close();
  }

  // --- Mapping Helpers ---

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: String(row.id),
      title: String(row.title),
      description: row.description ? String(row.description) : undefined,
      status: row.status as TaskStatus,
      ownerId: row.ownerId ? String(row.ownerId) : undefined,
      revision: Number(row.revision),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  private mapEvent(row: Record<string, unknown>): ActivityEvent {
    let payload = {};
    try {
      payload = JSON.parse(String(row.payload || "{}"));
    } catch {
      payload = {};
    }
    return {
      id: String(row.id),
      taskId: row.taskId ? String(row.taskId) : undefined,
      source: String(row.source),
      type: String(row.type),
      timestamp: String(row.timestamp),
      payload: payload as Record<string, unknown>,
    };
  }

  private mapPatch(row: Record<string, unknown>): PatchRecord {
    return {
      id: String(row.id),
      taskId: String(row.taskId),
      runId: String(row.runId),
      status: row.status as PatchRecord["status"],
      patchPath: row.patchPath ? String(row.patchPath) : undefined,
      diffContent: String(row.diffContent),
      testOutput: row.testOutput ? String(row.testOutput) : undefined,
      createdAt: String(row.createdAt),
      reviewedAt: row.reviewedAt ? String(row.reviewedAt) : undefined,
      reviewerId: row.reviewerId ? String(row.reviewerId) : undefined,
      rejectionReason: row.rejectionReason ? String(row.rejectionReason) : undefined,
      baseCommit: row.baseCommit ? String(row.baseCommit) : undefined,
      taskRevision: row.taskRevision ? Number(row.taskRevision) : undefined,
      diffHash: row.diffHash ? String(row.diffHash) : undefined,
      applicationStatus: (row.applicationStatus as any) || "not_applied",
      applicationId: row.applicationId ? String(row.applicationId) : undefined,
    };
  }

  private mapPatchV1(row: Record<string, unknown>): PatchRecordV1 {
    let review;
    if (row.reviewJson) {
      try {
        review = JSON.parse(String(row.reviewJson));
      } catch {}
    }
    return {
      id: String(row.id),
      taskId: String(row.taskId),
      runId: String(row.runId),
      status: row.status as PatchRecordV1["status"],
      patchPath: row.patchPath ? String(row.patchPath) : undefined,
      diffContent: String(row.diffContent),
      testOutput: row.testOutput ? String(row.testOutput) : undefined,
      createdAt: String(row.createdAt),
      reviewedAt: row.reviewedAt ? String(row.reviewedAt) : undefined,
      reviewerId: row.reviewerId ? String(row.reviewerId) : undefined,
      rejectionReason: row.rejectionReason ? String(row.rejectionReason) : undefined,
      baseCommit: row.baseCommit ? String(row.baseCommit) : undefined,
      taskRevision: row.taskRevision ? Number(row.taskRevision) : undefined,
      diffHash: row.diffHash ? String(row.diffHash) : undefined,
      review,
      applicationStatus: (row.applicationStatus as any) || "not_applied",
      applicationId: row.applicationId ? String(row.applicationId) : undefined,
    };
  }

  private mapConflictV1(row: Record<string, unknown>): ConflictRecordV1 {
    return {
      contractVersion: "UD-IC/1.0",
      id: String(row.id),
      taskId: String(row.taskId),
      eventId: String(row.eventId),
      deviceId: String(row.deviceId),
      baseRevision: Number(row.baseRevision),
      currentRevision: Number(row.currentRevision),
      proposed: JSON.parse(String(row.proposedJson)),
      currentTask: JSON.parse(String(row.currentTaskJson)),
      status: row.status as ConflictRecordV1["status"],
      resolutionRevision: Number(row.resolutionRevision),
      detectedAt: String(row.detectedAt),
      resolvedAt: row.resolvedAt ? String(row.resolvedAt) : undefined,
      resolvedBy: row.resolvedBy ? String(row.resolvedBy) : undefined,
      resolution: row.resolution as ConflictRecordV1["resolution"],
      resultingTaskRevision: row.resultingTaskRevision ? Number(row.resultingTaskRevision) : undefined,
    };
  }

  public saveProject(project: Project): void {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      project.id,
      project.name,
      project.description || null,
      project.createdAt,
      project.updatedAt
    );
  }

  public getProject(id: string): Project | null {
    const stmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
      FROM projects WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : undefined,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  public listProjects(): Project[] {
    const stmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt, updated_at as updatedAt
      FROM projects ORDER BY created_at ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : undefined,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    }));
  }

  public saveHandoff(handoff: StructuredHandoff): void {
    const stmt = this.db.prepare(`
      INSERT INTO handoffs (id, from_agent, to_agent, task_id, dependent_task_id, handoff_type, summary, contract_version, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      handoff.id,
      handoff.fromAgent,
      handoff.toAgent,
      handoff.taskId || null,
      handoff.dependentTaskId || null,
      handoff.handoffType,
      handoff.summary,
      handoff.contractVersion,
      JSON.stringify(handoff.payload || {}),
      handoff.createdAt
    );
  }

  public listHandoffs(toAgent?: string, taskId?: string): StructuredHandoff[] {
    let sql = `
      SELECT id, from_agent as fromAgent, to_agent as toAgent, task_id as taskId,
             dependent_task_id as dependentTaskId, handoff_type as handoffType,
             summary, contract_version as contractVersion, payload, created_at as createdAt
      FROM handoffs WHERE 1=1
    `;
    const params: (string | number | bigint | null)[] = [];
    if (toAgent) {
      sql += ` AND to_agent = ?`;
      params.push(toAgent);
    }
    if (taskId) {
      sql += ` AND (task_id = ? OR dependent_task_id = ?)`;
      params.push(taskId, taskId);
    }
    sql += ` ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(String(row.payload || "{}"));
      } catch {
        payload = {};
      }
      return {
        id: String(row.id),
        fromAgent: String(row.fromAgent),
        toAgent: String(row.toAgent),
        taskId: row.taskId ? String(row.taskId) : undefined,
        dependentTaskId: row.dependentTaskId ? String(row.dependentTaskId) : undefined,
        handoffType: row.handoffType as StructuredHandoff["handoffType"],
        summary: String(row.summary),
        contractVersion: String(row.contractVersion),
        payload: payload as Record<string, unknown>,
        createdAt: String(row.createdAt),
      };
    });
  }
}
