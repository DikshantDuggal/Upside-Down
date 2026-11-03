import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandJournal, transitionBlocked } from "../src/features/commands";
import { configureBrowserSession } from "../src/api/session";
import type { Command } from "../src/api/types";
import { json, receipt } from "./fixtures";

const command: Command = {
  type: "task.transition",
  taskId: "test-task",
  baseRevision: 3,
  payload: { targetStatus: "review" },
};
beforeEach(() => {
  configureBrowserSession({ csrfToken: "fixture-csrf", canReview: false });
  vi.unstubAllGlobals();
});
describe("durable receipt semantics and browser retry records", () => {
  it("waits for a refreshed canonical revision after an applied transition receipt", () => {
    const journal = new CommandJournal("device-1");
    const intent = {
      ...journal.prepare(command),
      delivery: "queued" as const,
      receipt: { ...receipt, state: "applied" as const },
    };
    expect(transitionBlocked("test-task", [], [intent], 3)).toBe(true);
    expect(transitionBlocked("test-task", [], [intent], 4)).toBe(false);
  });
  it("keeps an earlier ambiguous outcome unknown if a later retry is unauthorized", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Lost response"))
      .mockResolvedValueOnce(json({ message: "Session expired" }, 401));
    vi.stubGlobal("fetch", fetcher);
    const journal = new CommandJournal("device-1");
    await expect(journal.submit(journal.prepare(command))).rejects.toThrow();
    await expect(journal.submit(journal.read()[0])).rejects.toThrow();
    expect(journal.read()[0].delivery).toBe("unknown");
  });
  it("retains identical key and payload after lost response and browser restart", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValue(json(receipt, 202));
    vi.stubGlobal("fetch", fetcher);
    const journal = new CommandJournal("device-1");
    const intent = journal.prepare(command);
    await expect(journal.submit(intent)).rejects.toThrow();
    expect(journal.read()[0].delivery).toBe("unknown");
    expect(journal.read()[0].receipt).toBeUndefined();
    const reopened = new CommandJournal("device-1");
    await reopened.submit(reopened.read()[0]);
    const first = fetcher.mock.calls[0][1] as RequestInit;
    const second = fetcher.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(second.body);
    expect(first.headers).toEqual(second.headers);
    expect(reopened.read()[0]).toMatchObject({ delivery: "queued", receipt });
  });
  it("does not claim queued when the local service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const journal = new CommandJournal("device-1");
    const intent = journal.prepare(command);
    await expect(journal.submit(intent)).rejects.toThrow();
    expect(journal.read()[0]).toMatchObject({ delivery: "unknown" });
    expect(journal.read()[0].receipt).toBeUndefined();
  });
  it("keeps explicit unauthorized requests as unsent", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: "Unauthorized", message: "Login needed" }, 401),
        ),
    );
    const journal = new CommandJournal("device-1");
    const intent = journal.prepare(command);
    await expect(journal.submit(intent)).rejects.toThrow("Login needed");
    expect(journal.read()[0].delivery).toBe("unsent");
  });
  it("does not send if browser retry-key storage fails", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const journal = new CommandJournal("device-1", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Quota full", "QuotaExceededError");
      },
    });
    expect(() => journal.prepare(command)).toThrow("Quota full");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reconciles queued receipts to conflict without re-sending the proposal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(receipt, 202)));
    const journal = new CommandJournal("device-1");
    const result = await journal.submit(journal.prepare(command));
    expect(transitionBlocked("test-task", [receipt], [result])).toBe(true);
    const updated = await journal.reconcile([
      { ...receipt, state: "conflict" },
    ]);
    expect(updated[0].receipt?.state).toBe("conflict");
    expect(transitionBlocked("test-task", [], updated)).toBe(false);
  });
  it("fetches a missing receipt instead of inferring success from queue absence", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(receipt, 202))
      .mockResolvedValueOnce(json({ ...receipt, state: "applied" }));
    vi.stubGlobal("fetch", fetcher);
    const journal = new CommandJournal("device-1");
    await journal.submit(journal.prepare(command));
    const updated = await journal.reconcile([]);
    expect(updated[0].receipt?.state).toBe("applied");
    expect(fetcher.mock.calls[1][0]).toBe("/local/commands/command-1");
  });
  it("blocks transitions conservatively when a restored receipt has no command association", () => {
    expect(transitionBlocked("any-task", [receipt], [])).toBe(true);
    expect(
      transitionBlocked("any-task", [{ ...receipt, state: "applied" }], []),
    ).toBe(false);
  });
});
