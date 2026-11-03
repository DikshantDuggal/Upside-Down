import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Ack, CommandEnvelope, Principal, SyncGateway } from "../../../contracts/sync.ts";
import { createSyncRouter } from "../router.ts";
import { ProtocolError, VERSION } from "../protocol.ts";

const principal: Principal = { id: "enrolled", deviceId: randomUUID(), role: "device" };
const event = (sequence = 1): CommandEnvelope => ({ contractVersion: VERSION, eventId: randomUUID(), deviceId: principal.deviceId, sequence, createdAt: new Date().toISOString(), type: "task.create", payload: { clientTaskId: randomUUID(), title: "router test" } });
const applied = (e: CommandEnvelope): Ack => ({ eventId: e.eventId, deviceId: e.deviceId, sequence: e.sequence, status: "applied", duplicate: false, canonicalEventIds: [randomUUID()] });

async function fixture(t: any, process: SyncGateway["process"] = async e => applied(e)) {
  let calls = 0;
  const gateway = { process: async (e: CommandEnvelope, p: Principal) => { calls++; return process(e, p); },
    pull: async (_a: unknown, _l: unknown, _p: unknown) => ({ contractVersion: VERSION, events: [], nextCursor: "epoch:0", hasMore: false, serverTime: new Date().toISOString() }),
    listConflicts: async () => ({ items: [], hasMore: false }), resolve: async () => { throw new Error("not called"); } } satisfies SyncGateway;
  const app = express(); app.use("/api/sync", createSyncRouter(gateway, (req, res, next) => { if (req.headers.authorization !== "Bearer fixture") { next(new ProtocolError(401, "UNAUTHENTICATED", "Missing fixture auth")); return; } res.locals.principal = { ...principal, role: req.headers["x-fixture-role"] ?? "device" }; next(); }));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: "Bearer fixture", "X-UD-Contract": VERSION, "Content-Type": "application/json" };
  const push = (events: unknown[], h = headers) => fetch(`${origin}/api/sync/push`, { method: "POST", headers: h, body: JSON.stringify({ contractVersion: VERSION, deviceId: principal.deviceId, events }) });
  return { origin, headers, push, calls: () => calls };
}

test("whole batch validation and identity checks precede any gateway mutation", async t => {
  const f = await fixture(t);
  assert.equal((await f.push([event(), { ...event(2), sequence: "2" }])).status, 400); assert.equal(f.calls(), 0);
  assert.equal((await f.push([{ ...event(), deviceId: randomUUID() }])).status, 403); assert.equal(f.calls(), 0);
  assert.equal((await f.push([event()], { ...f.headers, Authorization: "" })).status, 401);
  assert.equal((await f.push([event()], { ...f.headers, "X-UD-Contract": "old" })).status, 426);
  assert.equal((await f.push(Array.from({ length: 101 }, (_, i) => event(i + 1)))).status, 400);
});

test("partial failure returns already durable acks and a retry; later commands are not processed", async t => {
  const f = await fixture(t, async e => { if (e.sequence === 2) throw new Error("database failure after first commit"); return applied(e); });
  const response = await f.push([event(1), event(2), event(3)]); assert.equal(response.status, 200);
  const result = await response.json() as any; assert.deepEqual(result.acks.map((a: Ack) => a.status), ["applied", "retry"]); assert.equal(result.receivedThrough, 1); assert.equal(f.calls(), 2);
});

test("sequence gap stops batch and reports only known received prefix", async t => {
  const f = await fixture(t, async e => ({ ...applied(e), status: "retry", canonicalEventIds: [], error: new ProtocolError(503, "SEQUENCE_GAP", "Fill gap", { expectedSequence: 1 }).body }));
  const response = await f.push([event(5), event(6)]); const result = await response.json() as any;
  assert.equal(result.receivedThrough, 0); assert.equal(result.acks.length, 1); assert.equal(f.calls(), 1);
});

test("pull bounds, malformed JSON and role-protected conflict resolution use ErrorV1", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.origin}/api/sync/pull?limit=201`, { headers: f.headers })).status, 400);
  const malformed = await fetch(`${f.origin}/api/sync/push`, { method: "POST", headers: f.headers, body: "{" }); assert.equal(malformed.status, 400); assert.equal((await malformed.json() as any).code, "INVALID_JSON");
  const resolution = { resolution: "keep_authoritative", expectedConflictRevision: 1, expectedTaskRevision: 1, reason: "Reviewed" };
  assert.equal((await fetch(`${f.origin}/api/sync/conflicts/${randomUUID()}/resolve`, { method: "POST", headers: f.headers, body: JSON.stringify(resolution) })).status, 403);
});
