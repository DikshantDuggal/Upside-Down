/**
 * SQLite Persistent Storage Engine
 * Role 1 — Core Backend & Coordinator
 * Uses Node.js native DatabaseSync (node:sqlite)
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Task, TaskStatus } from "../../contracts/task.ts";
import type { ActivityEvent } from "../../contracts/events.ts";
import type { AgentInfo } from "../../contracts/agent.ts";
import type { SyncEvent, ConflictRecord } from "../../contracts/sync.ts";
import type { Project } from "../../contracts/project.ts";
import type { StructuredHandoff } from "../../contracts/handoff.ts";

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
}

export class CoordinatorDatabase {
  private db: DatabaseSync;

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

  private initializeSchema(): void {
    this.db.exec("PRAGMA foreign_keys = ON;");

    this.db.exec(`
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
    `);
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

  public savePatch(patch: PatchRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO patches (id, task_id, run_id, status, patch_path, diff_content, test_output, created_at, reviewed_at, reviewer_id, rejection_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
      patch.rejectionReason || null
    );
  }

  public getPatch(id: string): PatchRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason
      FROM patches
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapPatch(row);
  }

  public getPatchByTaskId(taskId: string): PatchRecord | null {
    const stmt = this.db.prepare(`
      SELECT id, task_id as taskId, run_id as runId, status, patch_path as patchPath,
             diff_content as diffContent, test_output as testOutput, created_at as createdAt,
             reviewed_at as reviewedAt, reviewer_id as reviewerId, rejection_reason as rejectionReason
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

  // --- Sync & Outbox Operations ---

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

