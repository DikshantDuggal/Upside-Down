import type { Request, Response } from "express";
import type { ActivityEvent } from "../../contracts/events.ts";
import type { CoordinatorService } from "../core/coordinator.ts";

export interface ReplayOptions {
  /** Opt-in until the integration owners accept and enable replay. */
  sseReplay?: boolean;
  maxBufferedEvents?: number;
  maxBufferedBytes?: number;
  maxReplayEvents?: number;
}

/** Durable replay followed by live activity frames; no asynchronous replay gap. */
export function streamReplay(req: Request, res: Response, coordinator: CoordinatorService, options: ReplayOptions): void {
  const maxEvents = options.maxBufferedEvents ?? 256;
  const maxBytes = options.maxBufferedBytes ?? 1024 * 1024;
  const maxReplay = options.maxReplayEvents ?? 10000;
  if (![maxEvents, maxBytes, maxReplay].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError("SSE limits must be positive safe integers");
  }
  let closed = false;
  let replaying = true;
  let waitingForDrain = false;
  let bytes = 0;
  let pending: ActivityEvent[] = [];
  let pendingBytes = 0;
  const frames: string[] = [];
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (keepalive) clearInterval(keepalive);
    pending = [];
    pendingBytes = 0;
    frames.length = 0;
    bytes = 0;
    res.off("drain", drain);
  };
  const reset = () => {
    if (closed) return;
    cleanup();
    res.end('event: reset\ndata: {"reason":"CURSOR_EXPIRED"}\n\n');
  };
  const drain = () => {
    if (closed) return;
    waitingForDrain = false;
    while (frames.length && !waitingForDrain && !closed) {
      const frame = frames.shift()!;
      bytes -= Buffer.byteLength(frame);
      waitingForDrain = !res.write(frame);
    }
  };
  const send = (frame: string) => {
    if (closed) return;
    const size = Buffer.byteLength(frame);
    if (size > maxBytes || frames.length >= maxEvents || bytes + size > maxBytes) { reset(); return; }
    if (waitingForDrain) { frames.push(frame); bytes += size; }
    else waitingForDrain = !res.write(frame);
  };
  const activity = (event: ActivityEvent) => {
    send(`id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
  };
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.on("drain", drain);
  res.once("close", cleanup);
  res.once("error", cleanup);
  try {
    // Subscribe before capturing the replay boundary. Rows observed in both paths
    // are deduplicated below. The same process may commit during a replay hook.
    unsubscribe = coordinator.subscribe((event) => {
      if (closed) return;
      if (replaying) {
        const size = Buffer.byteLength(JSON.stringify(event));
        if (pending.length >= maxEvents || pendingBytes + size > maxBytes) reset();
        else { pending.push(event); pendingBytes += size; }
      } else activity(event);
    });
    let after: string;
    if (req.query.after !== undefined) {
      if (typeof req.query.after !== "string") { reset(); return; }
      after = req.query.after;
    } else {
      const lastId = req.get("Last-Event-ID");
      after = lastId ? coordinator.getEventCursor(lastId) : coordinator.getLatestEventCursor();
    }
    // Validate even an empty/no-op cursor before writing connected.
    coordinator.replayEvents(after, 1);
    const highWater = coordinator.getLatestEventCursor();
    res.flushHeaders();
    send(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: new Date().toISOString() })}\n\n`);
    const seen = new Set<string>();
    let count = 0;
    while (!closed && after !== highWater) {
      const page = coordinator.replayEvents(after, 200);
      if (!page.events.length) { reset(); break; }
      for (const event of page.events) {
        if (++count > maxReplay) { reset(); break; }
        seen.add(event.id);
        activity(event);
        after = event.cursor;
        if (closed || after === highWater) break;
      }
    }
    replaying = false;
    for (const event of pending) if (!seen.has(event.id)) activity(event);
    pending = [];
    pendingBytes = 0;
    if (!closed) keepalive = setInterval(() => send(": keepalive\n\n"), 15000);
  } catch {
    // Do not leak a cursor, DB path, token or internal exception in an SSE frame.
    reset();
  }
}
