import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { LocalStore } from "../src/store.ts";
import { createLocalService } from "../src/server.ts";
import { CoordinatorClient } from "../src/transport.ts";
import { VERSION } from "../../server/sync/protocol.ts";

async function fixture(t: any) {
  const store = new LocalStore(":memory:"); const pairingKey = "a".repeat(64);
  const service = await createLocalService({ store, pairingKey, port: 0, startWorker: false });
  t.after(async () => { await service.close(); store.close(); });
  const headers: Record<string, string> = { "X-UD-Contract": VERSION, "Content-Type": "application/json", Origin: service.origin };
  const session = await fetch(`${service.origin}/local/session`, { method: "POST", headers, body: JSON.stringify({ pairingKey }) });
  const body = await session.json() as any;
  headers.Cookie = session.headers.get("set-cookie")!.split(";")[0]; headers["X-CSRF-Token"] = body.csrfToken;
  return { store, service, headers };
}
const cmd = () => ({ type: "task.create", payload: { clientTaskId: randomUUID(), title: "HTTP offline enqueue" } });

test("paired reviewer authorization is verified live with the separate credential and fails closed", async t => {
  let role = "reviewer", canReview = true, contractVersion = VERSION, status = 200;
  const received: string[] = [];
  const upstream = createServer((req, res) => {
    received.push(req.headers.authorization ?? "");
    res.writeHead(status, { "Content-Type": "application/json", "X-UD-Contract": VERSION });
    res.end(JSON.stringify({ contractVersion, authorization: { role, canReview } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const store = new LocalStore(":memory:");
  const service = await createLocalService({ store, pairingKey: "x".repeat(64), port: 0, startWorker: false,
    client: new CoordinatorClient(base, "device-only"), reviewerClient: new CoordinatorClient(base, "reviewer-only") });
  t.after(async () => { await service.close(); store.close(); });
  const headers: Record<string, string> = { "X-UD-Contract": VERSION, "Content-Type": "application/json", Origin: service.origin };
  assert.equal((await fetch(service.origin + "/local/authorization", { headers })).status, 401);
  assert.equal(received.length, 0);
  const paired = await fetch(service.origin + "/local/session", { method: "POST", headers, body: JSON.stringify({ pairingKey: "x".repeat(64) }) });
  headers.Cookie = paired.headers.get("set-cookie")!.split(";")[0];
  const authorization = async () => {
    const response = await fetch(service.origin + "/local/authorization", { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as any;
    assert.equal(body.contractVersion, VERSION);
    assert.ok(!JSON.stringify(body).includes("reviewer-only"));
    return body.authorization;
  };
  assert.deepEqual(await authorization(), { role: "reviewer", canReview: true });
  role = "admin"; assert.deepEqual(await authorization(), { role: "admin", canReview: true });
  role = "device"; assert.equal((await authorization()).canReview, false);
  role = "reviewer"; canReview = false; assert.equal((await authorization()).canReview, false);
  canReview = true; contractVersion = "wrong"; assert.equal((await authorization()).canReview, false);
  contractVersion = VERSION; status = 403; assert.equal((await authorization()).canReview, false);
  status = 503; assert.equal((await authorization()).canReview, false);
  assert.ok(received.every(header => header === "Bearer reviewer-only"));
  const ordinary = await fixture(t);
  const noReviewer = await fetch(ordinary.service.origin + "/local/authorization", { headers: ordinary.headers });
  assert.equal(noReviewer.status, 200);
  assert.equal((await noReviewer.json() as any).authorization.canReview, false);
});

test("local HTTP enqueues after commit; lost browser response retry returns original receipt", async t => {
  const { service, headers, store } = await fixture(t); const input = cmd(); headers["Idempotency-Key"] = "lost-response";
  const request = () => fetch(`${service.origin}/local/commands`, { method: "POST", headers, body: JSON.stringify(input) });
  const first = await request(); assert.equal(first.status, 202); const r = await first.json() as any;
  const second = await request(); assert.equal(second.status, 202); assert.equal((await second.json() as any).eventId, r.eventId);
  assert.equal(store.get("nextSequence"), "2");
  const receipt = await fetch(`${service.origin}/local/commands/${r.eventId}`, { headers }); assert.equal(receipt.status, 200);
  assert.equal((await receipt.json() as any).state, "queued");
  const health = await fetch(`${service.origin}/local/health`, { headers }); const h = await health.json() as any;
  assert.equal(h.coordinatorReachable, false); assert.equal(h.internetReachable, "unknown"); assert.equal(h.pendingCount, 1);
});

test("local service enforces session, version, origin, CSRF, validation and Host allowlist", async t => {
  const { service, headers } = await fixture(t);
  const cases = [
    [{ ...headers, Cookie: "" }, 401], [{ ...headers, "X-UD-Contract": "wrong" }, 426],
    [{ ...headers, Origin: "http://evil.example" }, 403], [{ ...headers, "X-CSRF-Token": "bad" }, 403],
  ] as const;
  for (const [requestHeaders, expected] of cases) {
    const response = await fetch(`${service.origin}/local/commands`, { method: "POST", headers: requestHeaders, body: JSON.stringify(cmd()) });
    assert.equal(response.status, expected, JSON.stringify(requestHeaders)); assert.equal(typeof (await response.json() as any).requestId, "string");
  }
  const hostStatus = await new Promise<number>(resolve => { const req = request(`${service.origin}/local/health`, { headers: { ...headers, Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(); });
  assert.equal(hostStatus, 403);
  const invalid = await fetch(`${service.origin}/local/commands`, { method: "POST", headers: { ...headers, "Idempotency-Key": "invalid" }, body: JSON.stringify({ type: "run.shell", payload: {} }) }); assert.equal(invalid.status, 400);
  const oversize = await fetch(`${service.origin}/local/commands`, { method: "POST", headers, body: JSON.stringify({ x: "x".repeat(1024 * 1024) }) }); assert.equal(oversize.status, 413);
});

test("cached reads keep legacy shape, mark stale, and arbitrary proxy/write requests fail", async t => {
  const { service, headers, store } = await fixture(t);
  store.cacheWrite("/api/tasks", [{ id: "fixture", title: "cached" }]);
  const response = await fetch(`${service.origin}/api/tasks`, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get("X-UD-Stale"), "true"); assert.ok(response.headers.get("X-UD-Cached-At"));
  assert.ok(Array.isArray(await response.json()));
  assert.equal((await fetch(`${service.origin}/api/tasks?url=http://evil`, { headers })).status, 400);
  assert.equal((await fetch(`${service.origin}/api/unknown`, { headers })).status, 404);
  assert.equal((await fetch(`${service.origin}/api/agents`, { headers })).status, 503);
  assert.equal((await fetch(`${service.origin}/api/patches/${randomUUID()}/approve`, { method: "POST", headers, body: "{}" })).status, 503);
});

test("local SSE replays persisted changes after bootstrap watermark and resets unknown cursors", async t => {
  const { service, headers, store } = await fixture(t);
  const watermark = store.state().localCursor; store.enqueue(cmd(), "browser", "between-read-and-connect");
  const abort = new AbortController();
  const stream = await fetch(`${service.origin}/local/events/stream?after=${watermark}&contractVersion=${encodeURIComponent(VERSION)}`, { headers: { Cookie: headers.Cookie }, signal: abort.signal });
  const reader = stream.body!.getReader(); const data = new TextDecoder().decode((await reader.read()).value);
  assert.match(data, /event: local_change/); assert.match(data, /"reason":"queued"/); abort.abort(); await reader.cancel().catch(() => {});
  const reset = await fetch(`${service.origin}/local/events/stream?after=999&contractVersion=${encodeURIComponent(VERSION)}`, { headers });
  assert.match(await reset.text(), /event: reset/);
});

test("remote SSE proxy keeps bearer server-side and forwards frames and Last-Event-ID unchanged", async t => {
  let receivedAuth = ""; let receivedId = "";
  const upstream = createServer((req, res) => { receivedAuth = req.headers.authorization!; receivedId = req.headers["last-event-id"] as string; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.end('id: existing-event\nevent: activity\ndata: {"source":"fixture"}\n\n'); });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const store = new LocalStore(":memory:");
  const service = await createLocalService({ store, client: new CoordinatorClient(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, "private-fixture-token"), pairingKey: "a".repeat(64), port: 0, startWorker: false });
  t.after(async () => { await service.close(); store.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const headers: Record<string, string> = { "X-UD-Contract": VERSION, "Content-Type": "application/json", Origin: service.origin };
  const session = await fetch(`${service.origin}/local/session`, { method: "POST", headers, body: JSON.stringify({ pairingKey: "a".repeat(64) }) }); headers.Cookie = session.headers.get("set-cookie")!.split(";")[0]; await session.json();
  headers["Last-Event-ID"] = "original-event";
  const response = await fetch(`${service.origin}/api/events/stream?contractVersion=${encodeURIComponent(VERSION)}`, { headers }); const frames = await response.text();
  assert.equal(response.status, 200); assert.equal(receivedAuth, "Bearer private-fixture-token"); assert.equal(receivedId, "original-event"); assert.match(frames, /id: existing-event\nevent: activity/); assert.ok(!frames.includes("private-fixture-token"));
});

test("online actions use separate reviewer credentials, preserve status, and never queue or retry failures", async t => {
  const received: { authorization?: string; key?: string; path?: string }[] = []; let fail = false;
  const upstream = createServer(async (req, res) => {
    for await (const _ of req) { /* Consume body, preserving a real completed HTTP request. */ }
    received.push({ authorization: req.headers.authorization, key: req.headers["idempotency-key"] as string, path: req.url });
    if (fail) { res.destroy(); return; }
    res.writeHead(202, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "online-job", status: "queued" }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`; const store = new LocalStore(":memory:");
  const service = await createLocalService({ store, client: new CoordinatorClient(base, "device-only"), reviewerClient: new CoordinatorClient(base, "reviewer-only"), pairingKey: "a".repeat(64), port: 0, startWorker: false });
  t.after(async () => { await service.close(); store.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const headers: Record<string, string> = { "X-UD-Contract": VERSION, "Content-Type": "application/json", Origin: service.origin };
  const session = await fetch(`${service.origin}/local/session`, { method: "POST", headers, body: JSON.stringify({ pairingKey: "a".repeat(64) }) }); headers.Cookie = session.headers.get("set-cookie")!.split(";")[0]; headers["X-CSRF-Token"] = (await session.json() as any).csrfToken; headers["Idempotency-Key"] = "online-once";
  const path = `/api/patches/${randomUUID()}/apply`;
  let response = await fetch(service.origin + path, { method: "POST", headers, body: "{}" }); assert.equal(response.status, 202); assert.equal((await response.json() as any).id, "online-job");
  assert.deepEqual(received[0], { authorization: "Bearer reviewer-only", key: "online-once", path });
  response = await fetch(`${service.origin}/api/agents/register`, { method: "POST", headers, body: "{}" }); assert.equal(response.status, 202); await response.json(); assert.equal(received[1].authorization, "Bearer device-only");
  fail = true; response = await fetch(service.origin + path, { method: "POST", headers, body: "{}" }); assert.equal(response.status, 503); await response.json();
  assert.equal(received.length, 3); assert.equal(store.health().pendingCount, 0); assert.equal(store.get("nextSequence"), "1");
});
