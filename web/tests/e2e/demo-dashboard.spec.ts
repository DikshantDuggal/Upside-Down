import { test, expect } from "@playwright/test";

test("all dashboard sections work locally with zero backend requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/^http:\/\/127\.0\.0\.1:5173\/(api|local)\//.test(r.url()))
      requests.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByText("Connected laptops", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Pair browser", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByLabel("New demo task").fill("Prepare the judge walkthrough");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(
    page.getByText("Prepare the judge walkthrough", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(
    page.getByText("Four laptops. One shared conversation."),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/demo-agent-connections.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("Created task: Prepare the judge walkthrough"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Patch reviews", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve demo patch" })
    .first()
    .click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Conflicts", exact: true }).click();
  await page
    .getByLabel("Resolution note for CONFLICT-01")
    .fill("P3 owns the schema; P1 consumes it.");
  await page
    .getByRole("button", { name: "Resolve demo conflict" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Resolved in demo" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Team messages", exact: true }).click();
  await page.getByLabel("Demo message").fill("Please check the contract");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Please check the contract", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Demo acknowledgement:/)).toBeVisible();
  await page
    .getByRole("link", { name: "Network & queue", exact: true })
    .click();
  await page.getByRole("button", { name: "Simulate internet loss" }).click();
  await expect(
    page.getByRole("button", { name: "Replay demo queue" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Restore internet" }).click();
  await page.getByRole("button", { name: "Replay demo queue" }).click();
  await expect(page.getByText("Delivered (demo)")).toHaveCount(4);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "test-results/demo-overview-filled.png",
    fullPage: true,
  });
  expect(requests).toEqual([]);
});
