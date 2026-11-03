import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalSession } from "../src/app/useLocalSession";
import {
  configureBrowserSession,
  expireBrowserSession,
  getBrowserSession,
} from "../src/api/session";
import { request } from "../src/api/client";
import { taskSchema } from "../src/api/types";
import { json } from "./fixtures";

beforeEach(() => {
  vi.unstubAllGlobals();
  configureBrowserSession({ canReview: false });
});
describe("agreed local pairing handshake", () => {
  it("restores a cookie session without persisting CSRF or granting reviewer authority", async () => {
    const csrf = "c".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ contractVersion: "UD-IC/1.0", csrfToken: csrf }),
        ),
    );
    const { result, unmount } = renderHook(() => useLocalSession());
    await waitFor(() => expect(result.current.status).toBe("paired"));
    expect(getBrowserSession()).toEqual({ csrfToken: csrf, canReview: false });
    expect(localStorage.length).toBe(0);
    unmount();
  });
  it("pairs only through the explicit bootstrap route and uses the returned memory token", async () => {
    const csrf = "c".repeat(64);
    const key = "p".repeat(64);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ code: "LOCAL_SESSION_REQUIRED" }, 401))
      .mockResolvedValueOnce(
        json({ contractVersion: "UD-IC/1.0", csrfToken: csrf }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(() => useLocalSession());
    await waitFor(() => expect(result.current.status).toBe("required"));
    await act(async () => {
      await result.current.pair(key);
    });
    expect(fetcher.mock.calls[1][0]).toBe("/local/session");
    expect(fetcher.mock.calls[1][1].body).toBe(
      JSON.stringify({ pairingKey: key }),
    );
    expect(fetcher.mock.calls[1][1].headers["X-CSRF-Token"]).toBeUndefined();
    expect(getBrowserSession().canReview).toBe(false);
    expect(localStorage.length).toBe(0);
    act(() => expireBrowserSession());
    expect(result.current.status).toBe("required");
    await expect(
      request("/local/commands", taskSchema, {
        body: {},
        sessionBootstrap: true,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_SESSION_REQUIRED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
  });
});
