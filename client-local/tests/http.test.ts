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
