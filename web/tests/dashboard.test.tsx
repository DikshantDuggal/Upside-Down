import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDashboard } from "../src/app/useDashboard";
import { capabilities, json, localState } from "./fixtures";
import { FakeSource } from "./fakeSource";

afterEach(() => vi.unstubAllGlobals());
describe("snapshot and stream lifecycle", () => {
  it("resnapshots and reopens local streams after a cursor reset", async () => {
    const sources: { url: string; source: FakeSource }[] = [];
    class EventSourceFixture extends FakeSource {
      constructor(url: string) {
        super();
        sources.push({ url, source: this });
      }
    }
    vi.stubGlobal("EventSource", EventSourceFixture);
    let current = localState;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        Promise.resolve(
          json(path === "/api/capabilities" ? capabilities : current),
        ),
      ),
    );
    const { result, unmount } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.mode).toBe("local"));
    const original = sources.find((value) => value.url.startsWith("/local/"))!;
    current = { ...localState, localCursor: "new-epoch:1", events: [] };
    act(() => original.source.emit("reset", { reason: "CURSOR_EXPIRED" }));
    await waitFor(() =>
      expect(sources.some((value) => value.url.includes("new-epoch%3A1"))).toBe(
        true,
      ),
    );
    expect(original.source.closed).toBe(true);
    expect(result.current.events).toEqual([]);
    unmount();
  });
  it("discloses possible gaps on native legacy reconnect without creating a second connection", async () => {
    const sources: { url: string; source: FakeSource }[] = [];
    class EventSourceFixture extends FakeSource {
      constructor(url: string) {
        super();
        sources.push({ url, source: this });
      }
    }
    vi.stubGlobal("EventSource", EventSourceFixture);
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        Promise.resolve(
          json(path === "/api/capabilities" ? capabilities : localState),
        ),
      ),
    );
    const { result, unmount } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.mode).toBe("local"));
    const remote = sources.find((value) => value.url.startsWith("/api/"))!;
    act(() => remote.source.emit("open"));
    act(() => remote.source.emit("open"));
    await waitFor(() => expect(result.current.historyGap).toBe(true));
    expect(sources).toHaveLength(2);
    unmount();
  });
  it("bootstraps before local subscription, refetches on invalidation, and cleans both streams", async () => {
    const sources: { url: string; source: FakeSource }[] = [];
    class EventSourceFixture extends FakeSource {
      constructor(url: string) {
        super();
        sources.push({ url, source: this });
      }
    }
    vi.stubGlobal("EventSource", EventSourceFixture);
    let currentState = localState;
    const fetcher = vi.fn((path: string) =>
      Promise.resolve(
        json(path === "/api/capabilities" ? capabilities : currentState),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.mode).toBe("local"));
    const local = sources.find((source) => source.url.startsWith("/local/"))!;
    expect(
      new URL(local.url, "http://localhost").searchParams.get("after"),
    ).toBe("local:3");
    currentState = { ...localState, localCursor: "local:4", stale: true };
    act(() =>
      local.source.emit("local_change", {
        localCursor: "local:4",
        reason: "pull",
      }),
    );
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(sources).toHaveLength(2);
    unmount();
    expect(sources.every((source) => source.source.closed)).toBe(true);
  });
});
