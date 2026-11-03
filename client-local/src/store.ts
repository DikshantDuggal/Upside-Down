import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Ack, CanonicalEvent, CommandEnvelope, ErrorV1, LocalHealth, LocalReceipt, LocalState, PullResponse } from "../../contracts/sync.ts";
import { bodyHash, ProtocolError, validateCommand, VERSION } from "../../server/sync/protocol.ts";

type Row = Record<string, any>;
export type Change = { localCursor: string; reason: "queued" | "ack" | "pull" | "health" };

export class LocalStore {
  db: DatabaseSync;
  deviceId: string;
  listeners = new Set<(change: Change) => void>();
  constructor(filename: string) {
    if (filename !== ":memory:" && (!isAbsolute(filename) || filename.startsWith("\\\\") || filename.startsWith("//"))) throw new Error("UD_DEVICE_DB must be an absolute local disk path");
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(
        event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, envelope TEXT NOT NULL,
        state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, ack TEXT, error TEXT,
        next_attempt_at INTEGER NOT NULL DEFAULT 0, task_id TEXT);
      CREATE TABLE IF NOT EXISTS requests(principal TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL,
        event_id TEXT NOT NULL REFERENCES outbox(event_id), PRIMARY KEY(principal,key));
      CREATE TABLE IF NOT EXISTS inbox(event_id TEXT PRIMARY KEY, event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS cache(path TEXT PRIMARY KEY, body TEXT NOT NULL, cached_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changes(cursor INTEGER PRIMARY KEY AUTOINCREMENT, reason TEXT NOT NULL);
      PRAGMA user_version=1;`);
    this.transaction(() => {
      if (!this.get("deviceId")) this.set("deviceId", randomUUID());
      if (!this.get("nextSequence")) this.set("nextSequence", "1");
      if (Number(this.get("senderUntil") ?? "0") <= Date.now()) this.db.exec("UPDATE outbox SET state='queued' WHERE state='sending'");
      // A previous process being reachable says nothing about this process's connection.
      this.set("reachable", "false");
    });
    this.deviceId = this.get("deviceId")!;
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  get(key: string): string | undefined { return (this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as Row | undefined)?.value; }
  set(key: string, value: string) { this.db.prepare("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
  claimSender(owner: string, now = Date.now()): boolean {
    return this.transaction(() => {
      if (this.get("senderOwner") && this.get("senderOwner") !== owner && Number(this.get("senderUntil")) > now) return false;
      this.set("senderOwner", owner); this.set("senderUntil", String(now + 30000)); return true;
    });
  }
  releaseSender(owner: string) { this.transaction(() => { if (this.get("senderOwner") === owner) { this.set("senderOwner", ""); this.set("senderUntil", "0"); } }); }
  change(reason: Change["reason"]): Change {
    const result = this.db.prepare("INSERT INTO changes(reason) VALUES(?)").run(reason);
    return { localCursor: String(result.lastInsertRowid), reason };
  }
  notify(change: Change) { for (const listener of this.listeners) { try { listener(change); } catch { /* A subscriber cannot roll back a commit. */ } } }
  cursor() { return String((this.db.prepare("SELECT COALESCE(MAX(cursor),0) AS n FROM changes").get() as Row).n); }
  changesAfter(after: string): Change[] | undefined {
    if (!/^(0|[1-9]\d*)$/.test(after) || !Number.isSafeInteger(Number(after)) || Number(after) > Number(this.cursor())) return undefined;
    return (this.db.prepare("SELECT cursor,reason FROM changes WHERE cursor>? ORDER BY cursor LIMIT 1001").all(Number(after)) as Row[])
      .map(r => ({ localCursor: String(r.cursor), reason: r.reason }));
  }
  receipt(row: Row): LocalReceipt {
    return { eventId: row.event_id, deviceId: this.deviceId, sequence: row.sequence, state: row.state,
      queuedAt: JSON.parse(row.envelope).createdAt, attempts: row.attempts,
      ...(row.ack ? { ack: JSON.parse(row.ack) } : {}), ...(row.error ? { lastError: JSON.parse(row.error) } : {}) };
  }
  lookup(eventId: string): LocalReceipt {
    const row = this.db.prepare("SELECT * FROM outbox WHERE event_id=?").get(eventId) as Row | undefined;
    if (!row) throw new ProtocolError(404, "COMMAND_NOT_FOUND", "Command not found");
    return this.receipt(row);
  }
  enqueue(input: unknown, principal: string, key: string): LocalReceipt {
    validateCommand(input);
    if (!key || key.length > 200) throw new ProtocolError(400, "IDEMPOTENCY_KEY_REQUIRED", "Use a nonempty Idempotency-Key up to 200 characters");
    const hash = bodyHash(input);
    let change: Change | undefined;
    const receipt = this.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM requests WHERE principal=? AND key=?").get(principal, key) as Row | undefined;
      if (prior) {
        if (prior.hash !== hash) throw new ProtocolError(409, "IDEMPOTENCY_KEY_REUSE", "Key already belongs to another command");
        return this.lookup(prior.event_id);
      }
      if (input.type === "task.transition" && this.db.prepare("SELECT 1 FROM outbox WHERE task_id=? AND state IN ('queued','sending')").get(input.taskId)) throw new ProtocolError(409, "TRANSITION_PENDING", "Wait for the previous task proposal acknowledgement");
      const sequence = Number(this.get("nextSequence"));
      if (!Number.isSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) throw new ProtocolError(507, "SEQUENCE_EXHAUSTED", "Device requires a new enrollment");
      const envelope: CommandEnvelope = { ...input, contractVersion: VERSION, eventId: randomUUID(), deviceId: this.deviceId, sequence, createdAt: new Date().toISOString() };
      this.db.prepare("INSERT INTO outbox(event_id,sequence,envelope,state,task_id) VALUES(?,?,?,'queued',?)")
        .run(envelope.eventId, sequence, JSON.stringify(envelope), input.type === "task.transition" ? input.taskId : null);
      this.db.prepare("INSERT INTO requests VALUES(?,?,?,?)").run(principal, key, hash, envelope.eventId);
      this.set("nextSequence", String(sequence + 1));
      change = this.change("queued");
      return this.lookup(envelope.eventId);
    });
    if (change) this.notify(change);
    return receipt;
  }
  batch(now = Date.now()): CommandEnvelope[] {
    const rows = this.db.prepare("SELECT * FROM outbox WHERE state IN ('queued','sending') ORDER BY sequence LIMIT 100").all() as Row[];
    const events: CommandEnvelope[] = [];
    let size = Buffer.byteLength(JSON.stringify({ contractVersion: VERSION, deviceId: this.deviceId, events: [] }));
    for (const row of rows) {
      if (row.next_attempt_at > now || (events.length && row.sequence !== events.at(-1)!.sequence + 1)) break;
      const extra = Buffer.byteLength(row.envelope) + (events.length ? 1 : 0);
      if (size + extra > 1024 * 1024) break;
      events.push(JSON.parse(row.envelope)); size += extra;
    }
    return events;
  }
  markSending(events: CommandEnvelope[]) {
    this.transaction(() => { for (const e of events) this.db.prepare("UPDATE outbox SET state='sending',attempts=attempts+1 WHERE event_id=? AND state IN ('queued','sending')").run(e.eventId); });
  }
  recordAcks(events: CommandEnvelope[], acks: Ack[]) {
    const ids = new Set<string>();
    // Validate every acknowledgement before any local mutation; receivedThrough is intentionally unused.
    for (const ack of acks) {
      const e = events.find(e => e.eventId === ack.eventId);
      if (!e || ids.has(ack.eventId) || ack.deviceId !== this.deviceId || ack.sequence !== e.sequence || !["applied", "conflict", "rejected", "retry"].includes(ack.status) || typeof ack.duplicate !== "boolean" || !Array.isArray(ack.canonicalEventIds) || !ack.canonicalEventIds.every(id => typeof id === "string")) throw new ProtocolError(502, "INVALID_ACK", "Coordinator acknowledgement does not match the sent batch");
      ids.add(ack.eventId);
    }
    const change = this.transaction(() => {
      for (const ack of acks) {
        const prior = this.lookup(ack.eventId);
        if (["applied", "conflict", "rejected"].includes(prior.state)) continue;
        this.db.prepare("UPDATE outbox SET state=?,ack=?,error=?,next_attempt_at=0 WHERE event_id=?")
          .run(ack.status === "retry" ? "queued" : ack.status, JSON.stringify(ack), ack.error ? JSON.stringify(ack.error) : null, ack.eventId);
      }
      return this.change("ack");
    });
    this.notify(change);
  }
  retry(events: CommandEnvelope[], error: ErrorV1, nextAt: number) {
    this.transaction(() => { for (const e of events) this.db.prepare("UPDATE outbox SET state='queued',error=?,next_attempt_at=? WHERE event_id=? AND state IN ('queued','sending')").run(JSON.stringify(error), nextAt, e.eventId); });
  }
  setHealth(reachable: boolean, error?: ErrorV1) {
    const old = this.health();
    const change = this.transaction(() => {
      this.set("reachable", String(reachable));
      if (reachable && !error) this.set("lastSyncAt", new Date().toISOString());
      this.set("lastError", error ? JSON.stringify(error) : "");
      if (old.coordinatorReachable !== reachable || old.lastError?.code !== error?.code) return this.change("health");
    });
    if (change) this.notify(change);
  }
  health(): LocalHealth {
    return { contractVersion: VERSION, deviceId: this.deviceId, coordinatorReachable: this.get("reachable") === "true", internetReachable: "unknown",
      pendingCount: (this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE state IN ('queued','sending')").get() as Row).n,
      ...(this.get("lastSyncAt") ? { lastSyncAt: this.get("lastSyncAt") } : {}),
      ...(this.get("lastError") ? { lastError: JSON.parse(this.get("lastError")!) } : {}) };
  }
  entity(kind: string, id: string, value: unknown) {
    this.db.prepare("INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value").run(kind, id, JSON.stringify(value));
  }
  entities(kind: string): any[] { return (this.db.prepare("SELECT value FROM entities WHERE kind=? ORDER BY id").all(kind) as Row[]).map(r => JSON.parse(r.value)); }
  invalidateCollaborationReads() {
    this.db.exec("DELETE FROM cache WHERE path='/api/projects' OR path LIKE '/api/projects/%' OR path='/api/handoffs' OR path LIKE '/api/handoffs?%'");
  }
  cacheRead(path: string) { const row = this.db.prepare("SELECT * FROM cache WHERE path=?").get(path) as Row | undefined; return row ? { body: JSON.parse(row.body), cachedAt: row.cached_at } : undefined; }
  cacheWrite(path: string, body: unknown) {
    this.db.prepare("INSERT INTO cache VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET body=excluded.body,cached_at=excluded.cached_at").run(path, JSON.stringify(body), new Date().toISOString());
  }
  /** Snapshots are fetched before this call; network is never performed inside the transaction. */
  applyPull(page: PullResponse, snapshots: { kind: string; id: string; value: unknown }[], hook?: () => void) {
    const change = this.transaction(() => {
      for (const event of page.events) this.db.prepare("INSERT OR IGNORE INTO inbox VALUES(?,?)").run(event.id, JSON.stringify(event));
      for (const snapshot of snapshots) this.entity(snapshot.kind, snapshot.id, snapshot.value);
      if (page.events.some(event => event.type === "project_created" || event.type === "agent_handoff")) this.invalidateCollaborationReads();
      for (const snapshot of snapshots) if (snapshot.kind === "patches") this.db.prepare("DELETE FROM cache WHERE path=?").run(`/api/patches/${snapshot.id}`);
      if (snapshots.some(snapshot => snapshot.kind === "tasks")) this.db.exec("DELETE FROM cache WHERE path='/api/tasks' OR path LIKE '/api/tasks?%' OR path LIKE '/api/tasks/%'");
      hook?.();
      if (page.events.length) this.set("epoch", page.events[0].coordinatorEpoch);
      this.set("remoteCursor", page.nextCursor); this.set("cachedAt", new Date().toISOString());
      if (!page.hasMore) this.set("rebuilding", "false");
      return this.change("pull");
    });
    this.notify(change);
  }
  resetRemote() {
    const change = this.transaction(() => {
      this.db.exec("DELETE FROM inbox; DELETE FROM entities; DELETE FROM cache;");
      this.set("remoteCursor", ""); this.set("epoch", ""); this.set("rebuilding", "true"); this.set("cachedAt", "");
      return this.change("pull");
    });
    this.notify(change);
  }
  state(): LocalState {
    return { contractVersion: VERSION, deviceId: this.deviceId, localCursor: this.cursor(),
      ...(this.get("remoteCursor") ? { remoteCursor: this.get("remoteCursor") } : {}),
      ...(this.get("cachedAt") ? { cachedAt: this.get("cachedAt") } : {}),
      stale: !this.health().coordinatorReachable || Boolean(this.get("lastError")) || this.get("rebuilding") === "true", tasks: this.entities("tasks"), agents: this.entities("agents"),
      events: (this.db.prepare("SELECT event FROM inbox ORDER BY rowid").all() as Row[]).map(r => JSON.parse(r.event) as CanonicalEvent),
      patches: this.entities("patches"), messages: this.entities("messages"), conflicts: this.entities("conflicts"),
      pending: (this.db.prepare("SELECT * FROM outbox WHERE state IN ('queued','sending') ORDER BY sequence").all() as Row[]).map(r => this.receipt(r)), health: this.health() };
  }
  close() { this.listeners.clear(); this.db.close(); }
}
