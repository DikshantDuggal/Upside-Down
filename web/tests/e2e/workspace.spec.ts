import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { CONTRACT } from "../../src/api/types";
import {
  capabilities,
  conflict,
  localState,
  patch,
  receipt,
  task,
} from "../fixtures";

async function mockServices(page: Page, state = localState) {
  await page.route("http://127.0.0.1:5173/local/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events/stream")) return route.abort();
    if (path === "/local/state")
      return route.fulfill({
        json: state,
        headers: { "X-UD-Contract": CONTRACT },
      });
    return route.fulfill({
      status: 404,
      json: { message: "Test fixture route not provided" },
    });
  });
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events/stream")) return route.abort();
    if (path === "/api/capabilities")
      return route.fulfill({
        json: capabilities,
        headers: { "X-UD-Contract": CONTRACT },
      });
    if (path === `/api/patches/${patch.id}`)
      return route.fulfill({ json: patch });
    if (path === `/api/tasks/${task.id}`) return route.fulfill({ json: task });
    return route.fulfill({
      status: 404,
      json: { message: "Test fixture route not provided" },
    });
  });
}
test("fixture UI: task filtering, safe diff, reviewer gating and keyboard dialog", async ({
  page,
}) => {
  await mockServices(page);
  await page.goto("/");
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("textbox", { name: "Search tasks" }).fill("no match");
  await expect(page.getByText("No matching tasks")).toBeVisible();
  await page.getByRole("textbox", { name: "Search tasks" }).clear();
  await page
    .getByRole("button", { name: `Open ${task.title}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Patch reviews", exact: true }).click();
  await page.getByRole("button", { name: /Patch patch-1/ }).click();
  await expect(page.getByText(/window.TEST_XSS/)).toBeVisible();
  expect(await page.evaluate(() => "TEST_XSS" in window)).toBe(false);
  await expect(
    page.getByRole("button", { name: /Approve decision/ }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Legacy mode: approval is a decision only/),
  ).toBeVisible();
});
test("fixture UI: lost local response retries identical key after browser reload", async ({
  page,
}) => {
  await mockServices(page);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/local/commands", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({
      status: 202,
      json: receipt,
      headers: { "X-UD-Contract": CONTRACT },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  await page.evaluate(() =>
    window.upsideDownSession!.update({
      csrfToken: "test-fixture-csrf",
      canReview: false,
    }),
  );
  await page.getByRole("button", { name: "New task" }).click();
  await page
    .getByRole("textbox", { name: "Task title" })
    .fill("TEST FIXTURE: Lost-response command");
  await page.getByRole("button", { name: /Queue task/ }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "original request",
  );
  await expect(page.getByRole("button", { name: /Queue task/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  await page.evaluate(() =>
    window.upsideDownSession!.update({
      csrfToken: "test-fixture-csrf",
      canReview: false,
    }),
  );
  await page
    .getByRole("link", { name: "Network & queue", exact: true })
    .click();
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry original request" }).click();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
});
test("fixture UI: disconnected services never claim a task was queued", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:5173/local/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.route("http://127.0.0.1:5173/api/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Services unavailable", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New task" }).click();
  await page
    .getByRole("textbox", { name: "Task title" })
    .fill("Unsent fixture");
  await expect(
    page.getByText(
      "The local service is unavailable. No command has been queued.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Queue task/ })).toBeDisabled();
});
test("fixture UI: stale conflict resolution refreshes revisions without automatically resubmitting", async ({
  page,
}) => {
  await mockServices(page, { ...localState, conflicts: [conflict] });
  await page.route("http://127.0.0.1:5173/local/authorization", (route) =>
    route.fulfill({
      json: {
        contractVersion: CONTRACT,
        authorization: { role: "reviewer", canReview: true },
      },
      headers: { "X-UD-Contract": CONTRACT },
    }),
  );
  let currentRevision = 3;
  const proposals: Record<string, unknown>[] = [];
  await page.route(`http://127.0.0.1:5173/api/tasks/${task.id}`, (route) =>
    route.fulfill({ json: { ...task, revision: currentRevision } }),
  );
  await page.route("http://127.0.0.1:5173/api/sync/conflicts?*", (route) =>
    route.fulfill({
      json: { items: [conflict], hasMore: false },
      headers: { "X-UD-Contract": CONTRACT },
    }),
  );
  await page.route(
    "http://127.0.0.1:5173/api/sync/conflicts/conflict-1/resolve",
    (route) => {
      proposals.push(route.request().postDataJSON());
      currentRevision = 4;
      return route.fulfill({
        status: 409,
        json: { message: "Task revision changed while reviewing." },
      });
    },
  );
  await page.goto("/#conflicts");
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  await page.evaluate(() =>
    window.upsideDownSession!.update({
      csrfToken: "test-fixture-csrf",
      canReview: true,
    }),
  );
  await page.getByRole("button", { name: "Review conflict" }).click();
  const confirm = page.getByRole("checkbox", {
    name: /I reviewed this resolution/,
  });
  await expect(confirm).toHaveAccessibleName(/task revision 3/);
  await page
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill("TEST FIXTURE: Preserve current coordinator state");
  await confirm.check();
  await page
    .getByRole("button", { name: "Resolve conflict", exact: true })
    .click();
  await expect(confirm).toHaveAccessibleName(/task revision 4/);
  await expect(confirm).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Resolve conflict", exact: true }),
  ).toBeDisabled();
  expect(proposals).toHaveLength(1);
  expect(proposals[0]).toMatchObject({
    resolution: "keep_authoritative",
    expectedTaskRevision: 3,
    expectedConflictRevision: 1,
  });
});
test("fixture UI: mobile navigation, viewport containment and focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServices(page);
  await page.goto("/");
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("link", { name: "Network & queue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Know where things stand." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "New task" })).toBeFocused();
});
test("fixture UI: WCAG accessibility on overview and task modal", async ({
  page,
}) => {
  await mockServices(page);
  await page.goto("/");
  await expect(page.getByText("Snapshot refreshed")).toBeVisible();
  const overview = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    overview.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "New task" }).click();
  const modal = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    modal.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});
test("real backend: legacy REST snapshots and named SSE reach the dashboard", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.UD_REAL_BACKEND !== "1",
    "Set UD_REAL_BACKEND=1 with Vite UD_API_TARGET pointing at a disposable real coordinator.",
  );
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const tasks = await request.get("/api/tasks");
  expect(Array.isArray(await tasks.json())).toBe(true);
  await page.goto("/");
  await expect(
    page.getByText("Legacy read mode", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Coordinator connected" }),
  ).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const records = (await tasks.json()) as { title: string }[];
  if (records.length)
    await expect(
      page.getByText(records[0].title, { exact: true }).first(),
    ).toBeVisible();
  await page.screenshot({
    path: "test-results/real-backend-desktop.png",
    fullPage: true,
  });
});
