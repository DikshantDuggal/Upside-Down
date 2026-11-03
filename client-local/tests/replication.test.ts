import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalStore } from "../src/store.ts";
import { createLocalService } from "../src/server.ts";
import { CoordinatorClient, SyncWorker } from "../src/transport.ts";
import { bodyHash, VERSION } from "../../server/sync/protocol.ts";

/** Durable HTTP protocol fixture, NOT Backend A's production gateway or acceptance evidence. */
async function coordinator(filename: string) {
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE outcomes(id TEXT PRIMARY KEY, hash TEXT, ack TEXT); CREATE TABLE tasks(id TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE journal(position INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT);`);
  let dropNextAck = true; let authStatus = 200; let epoch = "fixture-epoch"; let pushRequests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("X-UD-Contract", VERSION); res.setHeader("Content-Type", "application/json");
    const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (authStatus !== 200) { send(authStatus, { code: `FIXTURE_${authStatus}` }); return; }
    const url = new URL(req.url!, "http://fixture");
    if (url.pathname === "/api/agents") { send(200, []); return; }
    if (url.pathname === "/api/sync/conflicts") { send(200, { items: [], hasMore: false }); return; }
    if (url.pathname.startsWith("/api/tasks/")) { const row = db.prepare("SELECT value FROM tasks WHERE id=?").get(url.pathname.split("/").at(-1)!) as any; send(row ? 200 : 404, row ? JSON.parse(row.value) : {}); return; }
    if (url.pathname === "/api/sync/pull") {
      const after = url.searchParams.get("after");
      if (after && !after.startsWith(`${epoch}:`)) { send(410, { code: "CURSOR_EXPIRED" }); return; }
      const n = after ? Number(after.split(":")[1]) : 0;
      const rows = db.prepare("SELECT position,event FROM journal WHERE position>? ORDER BY position").all(n) as any[];
      send(200, { contractVersion: VERSION, events: rows.map(row => ({ ...JSON.parse(row.event), coordinatorEpoch: epoch, cursor: `${epoch}:${row.position}` })), nextCursor: `${epoch}:${rows.at(-1)?.position ?? n}`, hasMore: false, serverTime: new Date().toISOString() }); return;
    }
    if (url.pathname === "/api/sync/push") {
      pushRequests++;
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); const acks: any[] = [];
      for (const e of body.events) {
        const prior = db.prepare("SELECT * FROM outcomes WHERE id=?").get(e.eventId) as any;
        if (prior) { if (prior.hash !== bodyHash(e)) { send(409, { code: "ID_REUSE" }); return; } acks.push({ ...JSON.parse(prior.ack), duplicate: true }); continue; }
        db.exec("BEGIN IMMEDIATE");
        try {
          const now = new Date().toISOString(); const task = { id: e.payload.clientTaskId, title: e.payload.title, description: "complete persisted fixture snapshot", status: "pending", revision: 1, createdAt: now, updatedAt: now };
          const canonical = { contractVersion: VERSION, id: randomUUID(), taskId: task.id, type: "task_created", source: "fixture", timestamp: now, originEventId: e.eventId, originDeviceId: e.deviceId, originSequence: e.sequence, payload: { title: task.title, revision: 1 } };
          db.prepare("INSERT INTO tasks VALUES(?,?)").run(task.id, JSON.stringify(task)); db.prepare("INSERT INTO journal(event) VALUES(?)").run(JSON.stringify(canonical));
          const ack = { eventId: e.eventId, deviceId: e.deviceId, sequence: e.sequence, status: "applied", duplicate: false, taskId: task.id, revision: 1, canonicalEventIds: [canonical.id] };
          db.prepare("INSERT INTO outcomes VALUES(?,?,?)").run(e.eventId, bodyHash(e), JSON.stringify(ack)); db.exec("COMMIT"); acks.push(ack);
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      }
      if (dropNextAck) { dropNextAck = false; res.destroy(); return; }
      send(200, { contractVersion: VERSION, acks, receivedThrough: acks.at(-1)?.sequence ?? 0, serverTime: new Date().toISOString() }); return;
    }
    send(404, {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { db, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, setStatus: (status: number) => { authStatus = status; }, changeEpoch: () => { epoch = "restored-epoch"; }, pushes: () => pushRequests,
    close: async () => { await closeServer(server); db.close(); } };
}
async function closeServer(server: Server) { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); }
async function queueThroughHttp(service: Awaited<ReturnType<typeof createLocalService>>, key: string, title: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-UD-Contract": VERSION, Origin: service.origin };
  const session = await fetch(`${service.origin}/local/session`, { method: "POST", headers, body: JSON.stringify({ pairingKey: "b".repeat(64) }) });
  headers.Cookie = session.headers.get("set-cookie")!.split(";")[0]; headers["X-CSRF-Token"] = (await session.json() as any).csrfToken; headers["Idempotency-Key"] = key;
  const response = await fetch(`${service.origin}/local/commands`, { method: "POST", headers, body: JSON.stringify({ type: "task.create", payload: { clientTaskId: randomUUID(), title } }) });
  assert.equal(response.status, 202); return await response.json() as any;
}

test("two disk-isolated HTTP services: offline queue/reopen, lost ACK, duplicate replay, full pull, epoch rebuild and no echo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upside-http-")); const authority = await coordinator(join(dir, "authority.db"));
  let a = new LocalStore(join(dir, "a.db")); const b = new LocalStore(join(dir, "b.db"));
  let serviceA = await createLocalService({ store: a, pairingKey: "b".repeat(64), port: 0, startWorker: false });
  const serviceB = await createLocalService({ store: b, pairingKey: "b".repeat(64), port: 0, startWorker: false });
  let wa: SyncWorker | undefined; let wb: SyncWorker | undefined;
  try {
    assert.notEqual(a.deviceId, b.deviceId); assert.notEqual(serviceA.origin, serviceB.origin);
    const one = await queueThroughHttp(serviceA, "a-1", "device A offline"); const two = await queueThroughHttp(serviceB, "b-1", "device B offline");
    assert.equal(a.health().coordinatorReachable, false);
    const before = a.batch()[0]; await serviceA.close(); a.close(); a = new LocalStore(join(dir, "a.db"));
    serviceA = await createLocalService({ store: a, pairingKey: "b".repeat(64), port: 0, startWorker: false });
    assert.deepEqual(a.batch()[0], before);
    wa = new SyncWorker(a, new CoordinatorClient(authority.url, "test-token")); wb = new SyncWorker(b, new CoordinatorClient(authority.url, "test-token"));
    await wa.tick(); clearTimeout(wa.timer);
    assert.equal((authority.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as any).n, 1);
    assert.equal(a.lookup(one.eventId).state, "queued");
    const saved = JSON.parse((authority.db.prepare("SELECT ack FROM outcomes WHERE id=?").get(one.eventId) as any).ack);
    await new Promise(resolve => setTimeout(resolve, 1050));
    await wa.tick(); clearTimeout(wa.timer);
    assert.equal(a.lookup(one.eventId).state, "applied"); assert.equal(a.lookup(one.eventId).ack?.duplicate, true);
    assert.deepEqual(a.lookup(one.eventId).ack?.canonicalEventIds, saved.canonicalEventIds);
    await wb.tick(); clearTimeout(wb.timer); await wa.tick(); clearTimeout(wa.timer);
    assert.equal(b.lookup(two.eventId).state, "applied"); assert.equal(a.state().tasks.length, 2); assert.equal(b.state().tasks.length, 2);
    assert.equal(a.state().tasks[0].description, "complete persisted fixture snapshot"); assert.equal(a.state().events.length, 2);
    assert.equal((authority.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as any).n, 2); assert.equal(a.batch().length, 0); assert.equal(b.batch().length, 0);
    const pushes = authority.pushes(); authority.changeEpoch();
    await wa.tick(); clearTimeout(wa.timer); assert.equal(a.get("rebuilding"), "true");
    await wa.tick(); clearTimeout(wa.timer); assert.equal(a.state().tasks.length, 2); assert.equal(a.get("rebuilding"), "false"); assert.equal(authority.pushes(), pushes);
  } finally {
    await wa?.stop(); await wb?.stop(); await serviceA.close(); await serviceB.close(); a.close(); b.close(); await authority.close();
    if (resolve(dirname(dir)) !== resolve(tmpdir())) throw new Error("Unexpected cleanup path"); rmSync(dir, { recursive: true, force: true });
  }
});

test("401/403/426 pause worker with durable queue retained and no repeated push", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upside-pause-")); const authority = await coordinator(join(dir, "authority.db"));
  try {
    for (const status of [401, 403, 426]) {
      const store = new LocalStore(join(dir, `${status}.db`));
      const receipt = store.enqueue({ type: "task.create", payload: { clientTaskId: randomUUID(), title: "retained" } }, "p", "one");
      const worker = new SyncWorker(store, new CoordinatorClient(authority.url, "fixture"));
      try { authority.setStatus(status); await worker.tick(); assert.equal(worker.paused, true); assert.equal(store.lookup(receipt.eventId).state, "queued"); assert.equal(store.health().lastError?.code, `FIXTURE_${status}`); await worker.tick(); assert.equal(authority.pushes(), 0); }
      finally { await worker.stop(); store.close(); }
    }
  } finally { await authority.close(); if (resolve(dirname(dir)) !== resolve(tmpdir())) throw new Error("Unexpected cleanup path"); rmSync(dir, { recursive: true, force: true }); }
});
