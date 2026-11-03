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
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toBe("/local/authorization");
    unmount();
  });
});

describe("verified reviewer session capability", () => {
  it("grants only verified reviewer authority and removes it on recheck failure", async () => {
    let role = "reviewer",
      canReview = true,
      unavailable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/local/session")
          return json({
            contractVersion: "UD-IC/1.0",
            csrfToken: "c".repeat(64),
          });
        if (unavailable) throw new TypeError("Coordinator unreachable");
        return json({
          contractVersion: "UD-IC/1.0",
          authorization: { role, canReview },
        });
      }),
    );
    const { unmount } = renderHook(() => useLocalSession());
    await waitFor(() => expect(getBrowserSession().canReview).toBe(true));
    expect(localStorage.length).toBe(0);
    unavailable = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getBrowserSession().canReview).toBe(false));
    expect(getBrowserSession().csrfToken).toBe("c".repeat(64));
    unavailable = false;
    role = "device";
    canReview = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(getBrowserSession().canReview).toBe(false));
    unmount();
  });
  it("does not resurrect an expired session when a capability check finishes later", async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/local/session"
          ? json({ contractVersion: "UD-IC/1.0", csrfToken: "c".repeat(64) })
          : pending,
      ),
    );
    const { result, unmount } = renderHook(() => useLocalSession());
    await waitFor(() => expect(result.current.status).toBe("paired"));
    act(() => expireBrowserSession());
    await act(async () => {
      finish(
        json({
          contractVersion: "UD-IC/1.0",
          authorization: { role: "admin", canReview: true },
        }),
      );
    });
    expect(getBrowserSession()).toEqual({
      canReview: false,
      csrfToken: undefined,
    });
    unmount();
  });
  it("clears existing authorization if restoring the local session fails", async () => {
    configureBrowserSession({ csrfToken: "old", canReview: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Local service unavailable")),
    );
    const { unmount } = renderHook(() => useLocalSession());
    await waitFor(() =>
      expect(getBrowserSession()).toEqual({
        canReview: false,
        csrfToken: undefined,
      }),
    );
    unmount();
  });
});
