import { describe, expect, it, vi } from "vitest";
import { mergeEvents, streamUrl, subscribeStream } from "../src/api/events";
import { event } from "./fixtures";
import { FakeSource } from "./fakeSource";

describe("named SSE and reconciliation", () => {
  it("listens to activity, rejects malformed content, and removes listeners on unmount", () => {
    const source = new FakeSource();
    const activity = vi.fn();
    const invalid = vi.fn();
    const cleanup = subscribeStream(
      "/api/events/stream",
      "remote",
      { activity, invalid, reset: vi.fn(), status: vi.fn() },
      () => source as unknown as EventSource,
    );
    source.emit("message", event);
    expect(activity).not.toHaveBeenCalled();
    source.emit("activity", event);
    expect(activity).toHaveBeenCalledWith(event);
    source.emit("activity", "<not json>");
    expect(invalid).toHaveBeenCalledOnce();
    cleanup();
    source.emit("activity", event);
    expect(activity).toHaveBeenCalledOnce();
    expect(source.closed).toBe(true);
  });
  it("uses local_change invalidations and closes on cursor reset", () => {
    const source = new FakeSource();
    const change = vi.fn();
    const reset = vi.fn();
    const cleanup = subscribeStream(
      "/local/events/stream",
      "local",
      { change, reset, invalid: vi.fn(), status: vi.fn() },
      () => source as unknown as EventSource,
    );
    source.emit("local_change", { localCursor: "local:4", reason: "ack" });
    expect(change).toHaveBeenCalledOnce();
    source.emit("reset", { reason: "CURSOR_EXPIRED" });
    expect(reset).toHaveBeenCalledOnce();
    expect(source.closed).toBe(true);
    cleanup();
  });
  it("deduplicates replay/live overlap without sorting tied canonical timestamps", () => {
    const second = { ...event, id: "event-2" };
    expect(
      mergeEvents([event, second], [event, { ...event, id: "event-3" }]).map(
        (value) => value.id,
      ),
    ).toEqual(["event-1", "event-2", "event-3"]);
    expect(
      mergeEvents([event, second], [{ ...event, id: "event-3" }], 2).map(
        (value) => value.id,
      ),
    ).toEqual(["event-2", "event-3"]);
  });
  it("encodes opaque cursors and version without credentials in SSE URLs", () => {
    const url = streamUrl("/local/events/stream", "cursor:a/b?");
    expect(new URL(url, "http://localhost").searchParams.get("after")).toBe(
      "cursor:a/b?",
    );
    expect(url).not.toContain("token");
    expect(streamUrl("/api/events/stream", undefined, false)).toBe(
      "/api/events/stream",
    );
  });
});
