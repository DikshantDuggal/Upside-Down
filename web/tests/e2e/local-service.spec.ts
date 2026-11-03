import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Actual B service + SQLite, no coordinator fixture. Pairing credentials must
// never be recorded in traces, command journals, or test output.
test.use({ trace: "off" });
test("real B service: browser pairing, local durable enqueue, restart and receipt recovery", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.UD_REAL_LOCAL_ROOT,
    "Set UD_REAL_LOCAL_ROOT to a disposable unchanged Backend B checkout. Uses loopback port 4100.",
  );
  test.setTimeout(60_000);
  const root = resolve(process.env.UD_REAL_LOCAL_ROOT!);
  const localPort = Number(process.env.UD_TEST_LOCAL_PORT ?? 4100);
  const localOrigin = `http://127.0.0.1:${localPort}`;
  const db = resolve(root, ".frontend-smoke", `${randomUUID()}.db`);
  let service: ChildProcess | undefined;
  async function start() {
    service = spawn(process.execPath, ["src/main.ts"], {
      cwd: resolve(root, "client-local"),
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        UD_DEVICE_DB: db,
        UD_LOCAL_PORT: String(localPort),
        UD_ALLOWED_ORIGINS: baseURL!,
        UD_COORDINATOR_URL: "",
        UD_DEVICE_TOKEN_FILE: "",
        UD_REVIEWER_TOKEN_FILE: "",
      },
    });
    await expect
      .poll(
        async () => {
          if (service?.exitCode !== null) return "process exited";
          try {
            return (
              await fetch(localOrigin + "/local/session", {
                headers: { "X-UD-Contract": "UD-IC/1.0" },
              })
            ).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(401);
  }
  async function stop() {
    if (service && service.exitCode === null && service.signalCode === null) {
      const exited = once(service, "exit");
      service.kill("SIGTERM");
      await exited;
    }
    service = undefined;
  }
  try {
    await start();
    const pairingKey: string = JSON.parse(
      readFileSync(`${db}.session.json`, "utf8"),
    ).pairingKey;
    const pair = async () => {
      await expect(
        page.getByRole("button", { name: "Pair browser", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Pair browser", exact: true })
        .click();
      await page
        .getByLabel("Local pairing key", { exact: true })
        .fill(pairingKey);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Pair browser", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Local service", exact: true }),
      ).toBeVisible();
    };
    await page.goto("/");
    await pair();
    const before = (await page.evaluate(async () =>
      (
        await fetch("/local/state", {
          headers: { "X-UD-Contract": "UD-IC/1.0" },
        })
      ).json(),
    )) as { deviceId: string };
    await page.getByRole("button", { name: "New task" }).click();
    await page
      .getByRole("textbox", { name: "Task title" })
      .fill("TEST FIXTURE: Actual durable local command");
    await page.getByRole("button", { name: /Queue task/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("link", { name: "Network & queue", exact: true })
      .click();
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    const accepted = (await page.evaluate(async () =>
      (
        await fetch("/local/state", {
          headers: { "X-UD-Contract": "UD-IC/1.0" },
        })
      ).json(),
    )) as {
      deviceId: string;
      pending: { eventId: string; sequence: number; state: string }[];
    };
    expect(accepted.pending).toHaveLength(1);
    expect(accepted.pending[0]).toMatchObject({ sequence: 1, state: "queued" });
    const hasCredential = await page.evaluate(
      (key) => JSON.stringify(localStorage).includes(key),
      pairingKey,
    );
    expect(hasCredential).toBe(false);
    await stop();
    await start();
    await page.goto("/");
    await pair();
    await page
      .getByRole("link", { name: "Network & queue", exact: true })
      .click();
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    const restored = (await page.evaluate(async () =>
      (
        await fetch("/local/state", {
          headers: { "X-UD-Contract": "UD-IC/1.0" },
        })
      ).json(),
    )) as typeof accepted;
    expect(restored.deviceId).toBe(before.deviceId);
    expect(restored.pending.map((item) => item.eventId)).toEqual(
      accepted.pending.map((item) => item.eventId),
    );
    expect(restored.pending).toHaveLength(1);
  } finally {
    await stop();
  }
});
