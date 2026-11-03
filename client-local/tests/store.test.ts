import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalStore } from "../src/store.ts";
import { bodyHash, VERSION } from "../../server/sync/protocol.ts";

const command = () => ({ type: "task.create" as const, payload: { clientTaskId: randomUUID(), title: "offline task" } });
const temporaryDirectories: string[] = [];
after(() => { for (const dir of temporaryDirectories) { if (resolve(dirname(dir)) !== resolve(tmpdir())) throw new Error("Unexpected cleanup path"); rmSync(dir, { recursive: true, force: true }); } });
function fixture(_t: any) { const dir = mkdtempSync(join(tmpdir(), "upside-b-")); temporaryDirectories.push(dir); return join(dir, "device.db"); }

test("identity, immutable envelope, browser idempotency and sending queue survive restart", t => {
  const path = fixture(t); let store = new LocalStore(path); const input = command();
  const receipt = store.enqueue(input, "browser", "request-1"); const original = store.batch()[0];
  store.markSending([original]); store.close(); store = new LocalStore(path);
  try {
    assert.equal(store.deviceId, receipt.deviceId); assert.equal(store.lookup(receipt.eventId).state, "queued");
    assert.deepEqual(store.batch()[0], original); assert.equal(store.enqueue(input, "browser", "request-1").eventId, receipt.eventId);
    assert.throws(() => store.enqueue(command(), "browser", "request-1"), /another command/);
    assert.equal(store.enqueue(command(), "browser", "request-2").sequence, 2);
  } finally { store.close(); }
});

test("validation/transaction failure do not consume sequence or falsely persist a receipt", t => {
  const store = new LocalStore(fixture(t)); t.after(() => store.close());
  assert.throws(() => store.enqueue({ type: "task.create", payload: { title: "bad" } }, "p", "bad"));
  store.db.exec("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;");
  assert.throws(() => store.enqueue(command(), "p", "lost"), /simulated storage failure/);
  assert.equal(store.get("nextSequence"), "1"); assert.equal(store.batch().length, 0);
  store.db.exec("DROP TRIGGER simulate_disk_failure");
  assert.equal(store.enqueue(command(), "p", "works").sequence, 1);
});

test("second pending transition blocks, but idempotent retry is allowed", t => {
  const store = new LocalStore(fixture(t)); t.after(() => store.close());
  const c = { type: "task.transition" as const, taskId: randomUUID(), baseRevision: 1, payload: { targetStatus: "running" as const } };
  const r = store.enqueue(c, "p", "one"); assert.equal(store.enqueue(c, "p", "one").eventId, r.eventId);
  assert.throws(() => store.enqueue(c, "p", "two"), /previous task proposal/);
  store.recordAcks(store.batch(), [{ ...r, status: "conflict", duplicate: false, canonicalEventIds: [], conflictId: randomUUID() }]);
  assert.equal(store.lookup(r.eventId).state, "conflict"); assert.equal(store.batch().length, 0);
  assert.equal(store.enqueue(c, "p", "two").sequence, 2);
});

test("missing, mismatched or forged acknowledgements never mark rows delivered", t => {
  const store = new LocalStore(fixture(t)); t.after(() => store.close());
  const one = store.enqueue(command(), "p", "one"); const two = store.enqueue(command(), "p", "two"); const sent = store.batch();
  const ack = { eventId: one.eventId, deviceId: one.deviceId, sequence: one.sequence, status: "applied" as const, duplicate: false, canonicalEventIds: [] };
  assert.throws(() => store.recordAcks(sent, [{ ...ack, sequence: 99 }]), /does not match/);
  assert.equal(store.lookup(one.eventId).state, "queued");
  store.recordAcks(sent, [ack]); assert.equal(store.lookup(two.eventId).state, "queued");
  assert.deepEqual(store.batch().map(e => e.sequence), [2]);
});

test("inbox, complete snapshot, cursor and change log roll back together and replay without echo", t => {
  const path = fixture(t); let store = new LocalStore(path);
  const id = randomUUID(); const page = { contractVersion: VERSION, events: [{ contractVersion: VERSION, id, cursor: "epoch:1", coordinatorEpoch: "epoch", source: "api", type: "task_created", timestamp: new Date().toISOString(), payload: {} }], nextCursor: "epoch:1", hasMore: false, serverTime: new Date().toISOString() } as const;
  const snapshot = { kind: "tasks", id: randomUUID(), value: { revision: 1, description: "complete snapshot" } };
  assert.throws(() => store.applyPull({ ...page, events: [...page.events] }, [snapshot], () => { throw new Error("crash before commit"); }), /crash/);
  assert.equal(store.get("remoteCursor"), undefined); assert.equal(store.state().events.length, 0); assert.equal(store.cursor(), "0");
  store.applyPull({ ...page, events: [...page.events] }, [snapshot]); store.close(); store = new LocalStore(path);
  try {
    store.applyPull({ ...page, events: [...page.events] }, [snapshot]);
    assert.equal(store.state().events.length, 1); assert.equal(store.state().tasks.length, 1); assert.equal(store.get("remoteCursor"), "epoch:1"); assert.equal(store.batch().length, 0);
    store.resetRemote(); assert.equal(store.state().tasks.length, 0); assert.equal(store.get("rebuilding"), "true");
  } finally { store.close(); }
});

test("canonical hashes ignore object key order but include all business fields", () => {
  assert.equal(bodyHash({ b: 2, a: { d: 4, c: 3 } }), bodyHash({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(bodyHash({ a: [1, 2] }), bodyHash({ a: [2, 1] }));
});

test("two installations have isolated identity and sequence; busy writer cannot return queued", t => {
  const path = fixture(t); const a = new LocalStore(path); const b = new LocalStore(fixture(t)); const other = new LocalStore(path);
  t.after(() => { a.close(); b.close(); other.close(); });
  assert.notEqual(a.deviceId, b.deviceId); assert.equal(a.enqueue(command(), "p", "a").sequence, 1); assert.equal(b.enqueue(command(), "p", "b").sequence, 1);
  a.db.exec("BEGIN IMMEDIATE");
  try { assert.throws(() => other.enqueue(command(), "p", "blocked"), /locked|busy/); }
  finally { a.db.exec("ROLLBACK"); }
  assert.equal(a.get("nextSequence"), "2");
});

test("one sender lease per persistent identity; stale leases recover without resequencing", t => {
  const path = fixture(t); const a = new LocalStore(path); const b = new LocalStore(path); t.after(() => { a.close(); b.close(); });
  assert.equal(a.claimSender("worker-a", 1000), true); assert.equal(b.claimSender("worker-b", 1001), false);
  b.releaseSender("worker-b"); assert.equal(a.get("senderOwner"), "worker-a");
  assert.equal(b.claimSender("worker-b", 31001), true); a.releaseSender("worker-a"); assert.equal(b.get("senderOwner"), "worker-b");
});
