/**
 * SQLite Persistent Storage Engine
 * Role 1 — Core Backend & Coordinator
 * Uses Node.js native DatabaseSync (node:sqlite)
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Task, TaskStatus } from "../../contracts/task.ts";
import type { ActivityEvent, CanonicalEvent, EventPage } from "../../contracts/events.ts";
import type { AgentInfo, ReviewVerdict, TestEvidence } from "../../contracts/agent.ts";

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
  review?: ReviewVerdict;
  applicationStatus?: "not_applied" | "queued" | "applying" | "verified" | "failed" | "blocked";
  applicationId?: string;
  evidence?: TestEvidence[];
}

export class CursorExpiredError extends Error {
  readonly code = "CURSOR_EXPIRED";
  constructor() { super("Unknown or expired event cursor; reload from the journal baseline"); }
}

export class EventIdentityError extends Error {
  readonly code = "ID_REUSE";
  constructor() { super("Event ID is already associated with different content"); }
}

// Normalize exactly the JSON-safe representation that is persisted. Object key
// order does not change identity; array order and every business field do.
function stableJson(value: unknown): string {
  const sort = (item: any): any => Array.isArray(item) ? item.map(sort)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}

export class CoordinatorDatabase {
  private db: DatabaseSync;
  private transactionDepth = 0;
  private commitCallbacks: (() => void)[] = [];
  private epoch!: string;
  private eventOrigin?: { originEventId: string; originDeviceId: string; originSequence: number };

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (dbPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    try {
      this.initializeSchema();
      this.initializeJournal();
    } catch (error) { this.db.close(); throw error; }
  }

  /** Same-connection synchronous transaction. Network/subprocess work stays outside. */
  public transaction<T>(operation: () => T): T {
    if (operation.constructor.name === "AsyncFunction") throw new TypeError("Coordinator transactions must be synchronous");
    const level = this.transactionDepth;
    const callbackStart = this.commitCallbacks.length;
    const savepoint = `ud_tx_${level}`;
    this.db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth++;
    let result: T;
    try {
      result = operation();
      if (result && typeof (result as any).then === "function") {
        throw new TypeError("Coordinator transactions must be synchronous");
      }
      this.db.exec(level === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      try {
        this.db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${savepoint}`);
        if (level !== 0) this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } finally {
        this.commitCallbacks.length = callbackStart;
        this.transactionDepth--;
      }
      throw error;
    }
    this.transactionDepth--;
    if (level === 0) {
      const callbacks = this.commitCallbacks;
      this.commitCallbacks = [];
      for (const callback of callbacks) {
        // Persistence already committed: an observer cannot roll it back or make
        // a successful command appear to fail and invite a duplicate retry.
        try { callback(); } catch { console.error("Committed event observer failed"); }
      }
    }
    return result;
  }

  public afterCommit(callback: () => void): void {
    if (this.transactionDepth) this.commitCallbacks.push(callback);
    else callback();
  }

  public withEventOrigin<T>(origin: { originEventId: string; originDeviceId: string; originSequence: number }, operation: () => T): T {
    const previous = this.eventOrigin;
    this.eventOrigin = origin;
    try { return operation(); } finally { this.eventOrigin = previous; }
  }

  private initializeJournal(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS coordinator_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coordinator_records (
          kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
          PRIMARY KEY(kind,id)
        );
        CREATE TABLE IF NOT EXISTS canonical_log (
          position INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE REFERENCES activity_events(id),
          event_json TEXT NOT NULL
        );
      `);
      this.db.prepare("INSERT OR IGNORE INTO coordinator_metadata(key,value) VALUES ('epoch',?)").run(randomUUID());
      this.epoch = String((this.db.prepare("SELECT value FROM coordinator_metadata WHERE key='epoch'").get() as any).value);
      // Existing installations retain all legacy events, including tied timestamps.
      const old = this.db.prepare(`SELECT id, task_id as taskId, source, type, timestamp, payload
        FROM activity_events WHERE id NOT IN (SELECT event_id FROM canonical_log) ORDER BY timestamp,id`).all();
      for (const row of old) this.appendJournal(this.mapEvent(row as Record<string, unknown>));
    });
  }

  private cursor(position: number): string {
    return Buffer.from(JSON.stringify([this.epoch, position])).toString("base64url");
  }

  private position(after?: string): number {
    if (after === undefined) return 0;
    try {
      if (after.length > 512 || !/^[A-Za-z0-9_-]+$/.test(after)) throw new Error();
      const decoded = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
      if (!Array.isArray(decoded) || decoded.length !== 2 || decoded[0] !== this.epoch
          || !Number.isSafeInteger(decoded[1]) || decoded[1] < 0 || this.cursor(decoded[1]) !== after) throw new Error();
      if (decoded[1] !== 0 && !this.db.prepare("SELECT 1 FROM canonical_log WHERE position=?").get(decoded[1])) throw new Error();
      return decoded[1];
    } catch { throw new CursorExpiredError(); }
  }

  private appendJournal(event: ActivityEvent): void {
    const inserted = this.db.prepare("INSERT INTO canonical_log(event_id,event_json) VALUES (?,?)").run(event.id, JSON.stringify(event));
    if (!Number.isSafeInteger(Number(inserted.lastInsertRowid))) throw new RangeError("Journal position exceeds safe integer range");
  }

  public latestEventCursor(): string {
    const row = this.db.prepare("SELECT COALESCE(MAX(position),0) AS position FROM canonical_log").get() as any;
    return this.cursor(Number(row.position));
  }

  /** A-owned repositories share this connection and its transaction boundary. */
  public readRecord<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM coordinator_records WHERE kind=? AND id=?").get(kind, id);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }

  public listRecords<T>(kind: string, after = "", limit = 1000): { id: string; value: T }[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new RangeError("Record limit must be 1..10000");
    return this.db.prepare("SELECT id,value FROM coordinator_records WHERE kind=? AND id>? ORDER BY id LIMIT ?")
      .all(kind, after, limit).map((row) => ({ id: String(row.id), value: JSON.parse(String(row.value)) as T }));
  }

  public insertRecord(kind: string, id: string, value: unknown): void {
    this.db.prepare("INSERT INTO coordinator_records(kind,id,value) VALUES (?,?,?)").run(kind, id, JSON.stringify(value));
  }

  public putRecord(kind: string, id: string, value: unknown): void {
    this.db.prepare(`INSERT INTO coordinator_records(kind,id,value) VALUES (?,?,?)
      ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value`).run(kind, id, JSON.stringify(value));
  }

  public deleteRecord(kind: string, id: string): void {
    this.db.prepare("DELETE FROM coordinator_records WHERE kind=? AND id=?").run(kind, id);
  }

  public eventCursor(id: string): string {
    const row = this.db.prepare("SELECT position FROM canonical_log WHERE event_id=?").get(id) as any;
    if (!row) throw new CursorExpiredError();
    return this.cursor(Number(row.position));
  }

  public listCanonicalEvents(after?: string, limit = 100): EventPage {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError("Journal limit must be 1..200");
    const start = this.position(after);
    const rows = this.db.prepare("SELECT position,event_json FROM canonical_log WHERE position>? ORDER BY position LIMIT ?")
      .all(start, limit + 1) as any[];
    const events: CanonicalEvent[] = rows.slice(0, limit).map((row) => ({
      ...JSON.parse(String(row.event_json)), contractVersion: "UD-IC/1.0",
      cursor: this.cursor(Number(row.position)), coordinatorEpoch: this.epoch,
    }));
    return { contractVersion: "UD-IC/1.0", events, nextCursor: events.at(-1)?.cursor ?? this.cursor(start),
      hasMore: rows.length > limit, serverTime: new Date().toISOString() };
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

  public saveEvent(event: ActivityEvent): boolean {
    return this.transaction(() => {
      const journalEvent = { ...event, ...this.eventOrigin };
      const previous = this.db.prepare("SELECT event_json FROM canonical_log WHERE event_id=?").get(event.id);
      if (previous) {
        if (stableJson(JSON.parse(String(previous.event_json))) !== stableJson(journalEvent)) throw new EventIdentityError();
        return false;
      }
      const stmt = this.db.prepare(`
        INSERT INTO activity_events (id, task_id, source, type, timestamp, payload)
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
      this.appendJournal(journalEvent);
      return true;
    });
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
    if (patch.baseCommit !== undefined) this.putRecord("patch_metadata", patch.id, {
      baseCommit: patch.baseCommit, taskRevision: patch.taskRevision, diffHash: patch.diffHash, review: patch.review,
      applicationStatus: patch.applicationStatus ?? "not_applied", applicationId: patch.applicationId, evidence: patch.evidence,
    });
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

  public listPatches(taskId: string): PatchRecord[] {
    const rows = this.db.prepare(`SELECT id,task_id as taskId,run_id as runId,status,patch_path as patchPath,
      diff_content as diffContent,test_output as testOutput,created_at as createdAt,reviewed_at as reviewedAt,
      reviewer_id as reviewerId,rejection_reason as rejectionReason FROM patches WHERE task_id=? ORDER BY created_at,id`).all(taskId);
    return rows.map((row) => this.mapPatch(row as Record<string, unknown>));
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
      ...this.readRecord<Partial<PatchRecord>>("patch_metadata", String(row.id)),
    };
  }
}
