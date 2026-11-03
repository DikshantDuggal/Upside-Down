import assert from "node:assert/strict";
import { test } from "node:test";
import { once, EventEmitter } from "node:events";
import express, { type Request, type Response } from "express";
import { CoordinatorDatabase } from "../../db/database.ts";
import { CoordinatorService } from "../../core/coordinator.ts";
import { createApiRouter } from "../routes.ts";
import { streamReplay, type ReplayOptions } from "../eventStream.ts";

async function fixture(options: ReplayOptions = { sseReplay: true }) {
  const db = new CoordinatorDatabase();
  const coordinator = new CoordinatorService(db);
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter(coordinator, options));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { db, coordinator, url: `http://127.0.0.1:${address.port}/api/events/stream`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); } };
}
async function activities(response: globalThis.Response, want: number) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const result: any[] = [];
  try {
    while (result.length < want) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (frame.includes("event: activity")) {
          const data = frame.split("\n").find((line) => line.startsWith("data: "))!;
          const event = JSON.parse(data.slice(6));
          assert.ok(frame.includes(`id: ${event.id}`));
          result.push(event);
        }
      }
    }
    return result;
  } finally { await reader.cancel(); }
}

test("Last-Event-ID replays durable activity frames with complete entity payloads", async () => {
  const f = await fixture();
  try {
    f.coordinator.createTask({ title: "first" });
    const first = f.coordinator.listEvents()[0];
    f.coordinator.createTask({ title: "second" });
    f.coordinator.createTask({ title: "third" });
    const response = await fetch(f.url, { headers: { "Last-Event-ID": first.id }, signal: AbortSignal.timeout(5000) });
    const events = await activities(response, 2);
    assert.deepEqual(events.map((e) => e.payload.task.title), ["second", "third"]);
    assert.ok(events.every((e) => e.cursor && e.coordinatorEpoch && e.contractVersion === "UD-IC/1.0"));
  } finally { await f.close(); }
});

test("explicit opaque after cursor takes precedence over Last-Event-ID", async () => {
  const f = await fixture();
  try {
    f.coordinator.createTask({ title: "baseline" });
    const cursor = f.coordinator.getLatestEventCursor();
    f.coordinator.createTask({ title: "after" });
    const response = await fetch(`${f.url}?after=${encodeURIComponent(cursor)}`, {
      headers: { "Last-Event-ID": "unknown-but-overridden" }, signal: AbortSignal.timeout(5000) });
    assert.deepEqual((await activities(response, 1)).map((e) => e.payload.task.title), ["after"]);
  } finally { await f.close(); }
});

test("a commit during replay is delivered once across the replay/live boundary", async () => {
  const f = await fixture();
  try {
    f.coordinator.createTask({ title: "baseline" });
    const cursor = f.coordinator.getLatestEventCursor();
    f.coordinator.createTask({ title: "replayed" });
    const original = f.coordinator.replayEvents.bind(f.coordinator);
    let injected = false;
    f.coordinator.replayEvents = (after, limit) => {
      const page = original(after, limit);
      if (limit === 200 && !injected) { injected = true; f.coordinator.createTask({ title: "during replay" }); }
      return page;
    };
    const response = await fetch(`${f.url}?after=${encodeURIComponent(cursor)}`, { signal: AbortSignal.timeout(5000) });
    const events = await activities(response, 2);
    assert.deepEqual(events.map((e) => e.payload.task.title), ["replayed", "during replay"]);
    assert.equal(new Set(events.map((e) => e.id)).size, 2);
  } finally { await f.close(); }
});

test("unknown event IDs, malformed cursors and foreign epochs reset and close", async () => {
  const f = await fixture();
  const foreign = new CoordinatorDatabase();
  try {
    const requests: { url: string; headers: Record<string, string> }[] = [
      { url: f.url, headers: { "Last-Event-ID": "unknown" } },
      { url: `${f.url}?after=bad`, headers: {} },
      { url: `${f.url}?after=${encodeURIComponent(foreign.latestEventCursor())}`, headers: {} },
      { url: `${f.url}?after=a&after=b`, headers: {} },
    ];
    for (const request of requests) {
      const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(5000) });
      const body = await response.text();
      assert.match(body, /event: reset/);
      assert.match(body, /"reason":"CURSOR_EXPIRED"/);
      assert.doesNotMatch(body, /stack|SQLITE|coordinator\.db/i);
      assert.equal(f.coordinator.getSubscriberCount(), 0);
    }
  } finally { foreign.close(); await f.close(); }
});

test("legacy default remains live-only and keeps named activity frames", async () => {
  const f = await fixture({});
  try {
    f.coordinator.createTask({ title: "old" });
    const response = await fetch(f.url, { headers: { "Last-Event-ID": "legacy-ignored" }, signal: AbortSignal.timeout(5000) });
    f.coordinator.createTask({ title: "live" });
    const events = await activities(response, 1);
    assert.deepEqual(events.map((e) => e.payload.task.title), ["live"]);
  } finally { await f.close(); }
});

class SlowResponse extends EventEmitter {
  written: string[] = [];
  ended = false;
  setHeader() {}
  flushHeaders() {}
  write(frame: string) { this.written.push(frame); return false; }
  end(frame: string) { this.written.push(frame); this.ended = true; this.emit("close"); }
}

test("slow-client backpressure is bounded and unsubscribes instead of growing memory", () => {
  const db = new CoordinatorDatabase();
  const c = new CoordinatorService(db);
  const cursor = c.getLatestEventCursor();
  c.createTask({ title: "one" }); c.createTask({ title: "two" });
  const response = new SlowResponse();
  const request = { query: { after: cursor }, get: () => undefined };
  try {
    streamReplay(request as unknown as Request, response as unknown as Response, c, { maxBufferedEvents: 1 });
    assert.equal(response.ended, true);
    assert.match(response.written.at(-1)!, /event: reset/);
    assert.equal(c.getSubscriberCount(), 0);
    assert.equal(response.listenerCount("drain"), 0);
  } finally { db.close(); }
});

test("over-limit replay resets rather than silently dropping history", async () => {
  const f = await fixture({ sseReplay: true, maxReplayEvents: 1 });
  try {
    const cursor = f.coordinator.getLatestEventCursor();
    f.coordinator.createTask({ title: "one" }); f.coordinator.createTask({ title: "two" });
    const response = await fetch(`${f.url}?after=${encodeURIComponent(cursor)}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    assert.match(body, /event: reset/);
    assert.equal(f.coordinator.getSubscriberCount(), 0);
  } finally { await f.close(); }
});
