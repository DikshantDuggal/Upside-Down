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

  /**
   * Atomic revision-guarded update. Returns null if baseRevision does not match current revision.
   */
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
}
