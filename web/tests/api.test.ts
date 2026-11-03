import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, idPath, onlineRequest, request } from "../src/api/client";
import { configureBrowserSession } from "../src/api/session";
import { commandSchema, localStateSchema, taskSchema } from "../src/api/types";
import { json, localState, task } from "./fixtures";

beforeEach(() => {
  vi.unstubAllGlobals();
  configureBrowserSession({ canReview: false });
});
describe("runtime contract and transport", () => {
  it("accepts direct task arrays and ignores additive fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json([{ ...task, futureField: true }])),
    );
    const result = await request("/api/tasks", z.array(taskSchema));
    expect(result.value).toEqual([task]);
  });
  it("rejects fractional revisions and malformed local state", () => {
    expect(taskSchema.safeParse({ ...task, revision: 1.5 }).success).toBe(
      false,
    );
    expect(
      localStateSchema.safeParse({ ...localState, localCursor: undefined })
        .success,
    ).toBe(false);
  });
  it("enforces message UTF-8 size instead of character count", () => {
    expect(
      commandSchema.safeParse({
        type: "message.send",
        payload: { messageId: crypto.randomUUID(), text: "🙂".repeat(1025) },
      }).success,
    ).toBe(false);
  });
  it("normalizes HTML failures without exposing or rendering the error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<script>secret()</script>", {
          status: 503,
          statusText: "Unavailable",
        }),
      ),
    );
    await expect(
      request("/api/tasks", z.array(taskSchema)),
    ).rejects.toMatchObject({
      status: 503,
      code: "HTTP_503",
      message: "Request failed (503 Unavailable).",
    });
  });
  it("keeps legacy and structured revision-conflict details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            error: "Conflict",
            message: "Stale revision",
            currentRevision: 4,
            baseRevision: 3,
          },
          409,
        ),
      ),
    );
    await expect(request("/api/tasks/id", taskSchema)).rejects.toMatchObject({
      status: 409,
      details: { currentRevision: 4, baseRevision: 3 },
    });
  });
  it("requires contract acknowledgement for proposed endpoints, but supports legacy reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(task), { status: 200 })),
        ),
    );
    await expect(
      request("/local/state", localStateSchema),
    ).rejects.toMatchObject({ status: 426 });
    await expect(
      request("/api/tasks/id", taskSchema, { versioned: false }),
    ).resolves.toMatchObject({ value: task });
  });
  it("exposes stale cache headers and enforces expected status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          json(task, 200, {
            "X-UD-Stale": "true",
            "X-UD-Cached-At": task.createdAt,
          }),
        ),
      ),
    );
    await expect(request("/api/tasks/id", taskSchema)).resolves.toMatchObject({
      stale: true,
      cachedAt: task.createdAt,
    });
    await expect(
      request("/local/commands", taskSchema, { expectedStatus: 202 }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_STATUS", status: 0 });
  });
  it("does not send mutations without a local session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      request("/local/commands", taskSchema, { body: {} }),
    ).rejects.toMatchObject({ code: "LOCAL_SESSION_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("encodes path IDs", () => expect(idPath("a/b?c")).toBe("a%2Fb%3Fc"));
  it("retains online action keys on ambiguous failure and blocks changed requests", async () => {
    configureBrowserSession({ csrfToken: "fixture-csrf", canReview: true });
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValue(json(task));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      onlineRequest(
        "/api/test",
        taskSchema,
        { reason: "original" },
        "device-1",
      ),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      onlineRequest("/api/test", taskSchema, { reason: "changed" }, "device-1"),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_ACTION" });
    await onlineRequest(
      "/api/test",
      taskSchema,
      { reason: "original" },
      "device-1",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    const options = fetcher.mock.calls.map((call) => call[1] as RequestInit);
    expect(
      (options[0].headers as Record<string, string>)["Idempotency-Key"],
    ).toBe((options[1].headers as Record<string, string>)["Idempotency-Key"]);
    expect(options[0].body).toBe(options[1].body);
  });
});
