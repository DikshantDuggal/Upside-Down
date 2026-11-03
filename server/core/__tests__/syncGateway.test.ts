import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CoordinatorDatabase } from "../../db/database.ts";
import { CoordinatorService } from "../coordinator.ts";
import { AuthenticationService } from "../auth.ts";
import { CoordinatorSyncGateway } from "../syncGateway.ts";
import { requestIdentity } from "../idempotency.ts";

function fixture(file = ":memory:") {
  const db = new CoordinatorDatabase(file), coordinator = new CoordinatorService(db);
  const auth = new AuthenticationService(db);
  const credentials = auth.enroll(randomUUID());
  const principal = auth.authenticate(credentials.token);
  const gateway = new CoordinatorSyncGateway(db, coordinator, auth);
  const envelope = (sequence = 1, command: Record<string, unknown> = { type: "task.create", payload: { clientTaskId: randomUUID(), title: "offline task" } }): Record<string, any> => ({
    contractVersion: "UD-IC/1.0", eventId: randomUUID(), deviceId: principal.deviceId, sequence, createdAt: new Date().toISOString(), ...command,
  });
  return { db, coordinator, auth, gateway, credentials, principal, envelope };
}

test("lost ACK retry returns the original outcome without another revision or event", async () => {
  const f = fixture();
  try {
    const e = f.envelope();
    const first = await f.gateway.process(e, f.principal);
    const duplicate = await f.gateway.process(JSON.parse(JSON.stringify(e)), f.principal);
    assert.deepEqual(duplicate, { ...first, duplicate: true });
    assert.equal(f.coordinator.listTasks().length, 1);
    assert.equal(f.coordinator.listTasks()[0].id, (e.payload as any).clientTaskId);
    assert.equal(f.coordinator.listTasks()[0].revision, 1);
    assert.equal(f.coordinator.replayEvents().events.length, 1);
    const journal = f.coordinator.replayEvents().events[0];
    assert.equal(journal.originEventId, e.eventId);
    assert.equal(journal.originDeviceId, f.principal.deviceId);
    assert.equal(journal.originSequence, 1);
  } finally { f.db.close(); }
});

test("changed IDs/payloads/sequences and cross-device duplicate lookup fail closed", async () => {
  const f = fixture();
  try {
    const e = f.envelope(); await f.gateway.process(e, f.principal);
    await assert.rejects(f.gateway.process({ ...e, payload: { ...e.payload as any, title: "changed" } }, f.principal), { code: "ID_REUSE" });
    await assert.rejects(f.gateway.process(f.envelope(1), f.principal), { code: "SEQUENCE_REUSE" });
    await assert.rejects(f.gateway.process(e, { ...f.principal, deviceId: randomUUID() }), { code: "DEVICE_MISMATCH" });
    assert.equal(f.coordinator.listTasks().length, 1);
  } finally { f.db.close(); }
});

test("sequence gap returns nonterminal retry without advancing the checkpoint", async () => {
  const f = fixture();
  try {
    const second = f.envelope(2);
    const gap = await f.gateway.process(second, f.principal);
    assert.equal(gap.status, "retry");
    assert.equal(gap.error?.details?.expectedSequence, 1);
    assert.equal(f.gateway.receivedThrough(f.principal.deviceId), 0);
    await f.gateway.process(f.envelope(1), f.principal);
    assert.equal((await f.gateway.process(second, f.principal)).status, "applied");
    assert.equal(f.gateway.receivedThrough(f.principal.deviceId), 2);
  } finally { f.db.close(); }
});

test("invalid domain transition is durably rejected and the next sequence can proceed", async () => {
  const f = fixture();
  try {
    const task = f.coordinator.createTask({ title: "pending" });
    const invalid = f.envelope(1, { type: "task.transition", taskId: task.id, baseRevision: 1, payload: { targetStatus: "done" } });
    const rejected = await f.gateway.process(invalid, f.principal);
    assert.equal(rejected.status, "rejected");
    assert.equal(f.coordinator.getTask(task.id).revision, 1);
    assert.equal(f.gateway.receivedThrough(f.principal.deviceId), 1);
    assert.deepEqual(await f.gateway.process(invalid, f.principal), { ...rejected, duplicate: true });
    assert.equal((await f.gateway.process(f.envelope(2), f.principal)).status, "applied");
  } finally { f.db.close(); }
});

test("stale proposal is a visible conflict; reviewer revision guards and retries are enforced", async () => {
  const f = fixture();
  try {
    const task = f.coordinator.createTask({ title: "conflict" });
    f.coordinator.transitionTask(task.id, { baseRevision: 1, targetStatus: "assigned" });
    const e = f.envelope(1, { type: "task.transition", taskId: task.id, baseRevision: 1, payload: { targetStatus: "running", reason: "work" } });
    const ack = await f.gateway.process(e, f.principal);
    assert.equal(ack.status, "conflict");
    assert.equal(f.coordinator.getTask(task.id).revision, 2);
    const conflict = (await f.gateway.listConflicts("open")).items[0];
    assert.equal(conflict.id, ack.conflictId);
    const resolution = { resolution: "retry_proposal" as const, expectedConflictRevision: 1, expectedTaskRevision: 2, reason: "reviewed" };
    await assert.rejects(f.gateway.resolve(conflict.id, resolution, f.principal), { code: "REVIEWER_REQUIRED" });
    const reviewer = f.auth.enroll(randomUUID(), "reviewer").principal;
    await assert.rejects(f.gateway.resolve(conflict.id, { ...resolution, expectedTaskRevision: 1 }, reviewer), { code: "STALE_REVISION" });
    const resolved = await requestIdentity.run({ key: "resolution-1" }, () => f.gateway.resolve(conflict.id, resolution, reviewer));
    assert.equal(resolved.status, "resolved"); assert.equal(resolved.resolutionRevision, 2);
    assert.equal(f.coordinator.getTask(task.id).revision, 3);
    assert.deepEqual(await requestIdentity.run({ key: "resolution-1" }, () => f.gateway.resolve(conflict.id, resolution, reviewer)), resolved);
    assert.equal(f.coordinator.getTask(task.id).revision, 3);
    await assert.rejects(f.gateway.resolve(conflict.id, resolution, reviewer), { code: "CONFLICT_RESOLVED" });
    assert.equal((await f.gateway.listConflicts("open")).items.length, 0);
  } finally { f.db.close(); }
});

test("private message pulls filter contents while advancing over invisible rows", async () => {
  const f = fixture();
  try {
    const recipient = f.auth.enroll(randomUUID()).principal;
    const stranger = f.auth.enroll(randomUUID()).principal;
    const e = f.envelope(1, { type: "message.send", payload: { messageId: randomUUID(), text: "private coordination", recipientDeviceId: recipient.deviceId } });
    await f.gateway.process(e, f.principal);
    const hidden = await f.gateway.pull(undefined, 1, stranger);
    assert.equal(hidden.events.length, 0);
    assert.notEqual(hidden.nextCursor, "");
    assert.equal((await f.gateway.pull(hidden.nextCursor, 1, stranger)).events.length, 0);
    const visible = await f.gateway.pull(undefined, 1, recipient);
    assert.equal(visible.events.length, 1);
    assert.equal((visible.events[0].payload.message as any).text, "private coordination");
    assert.equal((visible.events[0].payload.message as any).senderDeviceId, f.principal.deviceId);
  } finally { f.db.close(); }
});

test("malformed envelopes never allocate sequences or persist outcomes", async () => {
  const f = fixture();
  try {
    for (const e of [{ ...f.envelope(), sequence: 1.5 }, { ...f.envelope(), eventId: "not-uuid" },
      { ...f.envelope(), extra: "unexpected" }, { ...f.envelope(), payload: { clientTaskId: randomUUID(), title: "x", command: "arbitrary shell" } }]) {
      await assert.rejects(f.gateway.process(e, f.principal), { code: "INVALID_ENVELOPE" });
    }
    assert.equal(f.gateway.receivedThrough(f.principal.deviceId), 0);
    assert.deepEqual(f.coordinator.listTasks(), []);
  } finally { f.db.close(); }
});

test("SQLite outcome failure rolls back task, journal, sequence and broadcasts; restart preserves retries", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-gateway-")), file = path.join(root, "state.db");
  const f = fixture(file); const injector = new DatabaseSync(file);
  let reopened: CoordinatorDatabase | undefined;
  try {
    const e = f.envelope(); let broadcasts = 0; f.coordinator.subscribe(() => broadcasts++);
    injector.exec("CREATE TRIGGER fail_outcome BEFORE INSERT ON coordinator_records WHEN NEW.kind='sync_outcomes' BEGIN SELECT RAISE(ABORT,'outcome failure'); END;");
    await assert.rejects(f.gateway.process(e, f.principal), /outcome failure/);
    assert.deepEqual(f.coordinator.listTasks(), []);
    assert.equal(f.coordinator.replayEvents().events.length, 0);
    assert.equal(f.gateway.receivedThrough(f.principal.deviceId), 0);
    assert.equal(broadcasts, 0);
    injector.exec("DROP TRIGGER fail_outcome");
    const original = await f.gateway.process(e, f.principal);
    f.db.close();
    reopened = new CoordinatorDatabase(file);
    const auth = new AuthenticationService(reopened), c = new CoordinatorService(reopened);
    const gateway = new CoordinatorSyncGateway(reopened, c, auth);
    assert.deepEqual(await gateway.process(e, auth.authenticate(f.credentials.token)), { ...original, duplicate: true });
    assert.equal(c.listTasks().length, 1);
  } finally {
    injector.close(); try { f.db.close(); } catch {} reopened?.close();
    assert.equal(path.dirname(root), path.resolve(tmpdir())); fs.rmSync(root, { recursive: true, force: true });
  }
});

test("device and reviewer credentials are distinct, revocable and stored only as hashes", () => {
  const f = fixture();
  try {
    assert.ok(!JSON.stringify(f.db.listRecords("credentials")).includes(f.credentials.token));
    assert.throws(() => f.auth.authenticate("invalid"), { code: "AUTH_REQUIRED" });
    assert.throws(() => f.auth.requireReviewer(f.principal), { code: "REVIEWER_REQUIRED" });
    f.auth.revoke(f.principal.id);
    assert.throws(() => f.auth.authenticate(f.credentials.token), { code: "CREDENTIAL_REVOKED" });
  } finally { f.db.close(); }
});
