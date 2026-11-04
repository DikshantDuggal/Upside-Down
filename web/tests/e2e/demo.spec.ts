import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.setTimeout(65000);

test("upload preparation can be cancelled without revealing a plan", async ({ page }) => {
  await page.goto("/#studio");
  await page.getByLabel("Upload problem files").setInputFiles({ name: "cancel.pdf", mimeType: "application/pdf", buffer: Buffer.from("demo") });
  await page.getByRole("button", { name: "Upload & create architecture" }).click();
  await expect(page.getByRole("button", { name: "Cancel preparation" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel preparation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Preparing architecture" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Generated architecture" })).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  // The demonstration must work even if both existing services are unavailable.
  await page.route("http://127.0.0.1:5173/local/**", (route) => route.abort());
  await page.route("http://127.0.0.1:5173/api/**", (route) => route.abort());
});

test("fixed architecture, upload selection, scoped role packs and teaching journey", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#studio");
  await page
    .getByLabel("Your idea / problem statement")
    .fill("My unrelated custom idea");
  await page.getByLabel("Upload problem files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Never send this content"),
  });
  await expect(page.locator(".demo-file-list")).toContainText("brief.md");
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["demo"], "dropped.pdf", { type: "application/pdf" }),
    );
    return transfer;
  });
  await page
    .locator(".demo-drop")
    .dispatchEvent("drop", { dataTransfer: dropped });
  await expect(page.locator(".demo-file-list")).toContainText("dropped.pdf");
  await page.getByRole("button", { name: "Remove brief.md" }).click();
  await expect(page.locator(".demo-file-list")).not.toContainText("brief.md");
  await page
    .getByRole("button", { name: "Upload & create architecture", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Preparing architecture" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Generated architecture" }),
  ).toHaveCount(0);
  await page.waitForTimeout(20000);
  await expect(
    page.getByRole("dialog", { name: "Preparing architecture" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your reference architecture is ready"),
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByRole("region", { name: "Generated architecture" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /P3 \/ LAPTOP C/ }).click();
  await expect(
    page.getByRole("heading", { name: "API & realtime", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/demo-studio.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Open prompt vault" }).click();
  await page.getByLabel("Preview access as").selectOption("P1");
  await expect(
    page.getByRole("heading", { name: "backend.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-laptop")).toHaveCount(1);
  await expect(page.locator(".demo-laptop")).toContainText(
    "Backend & coordinator",
  );
  await expect(page.locator(".demo-prompt-editor pre")).not.toContainText(
    "# P2",
  );
  await page.getByLabel("Coding tool for laptop A").selectOption("Antigravity");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF pack" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("laptop-a-pack.pdf");
  await page.getByLabel("Preview access as").selectOption("host");
  await page.getByRole("button", { name: "Ready · assign four roles" }).click();
  await expect(
    page.getByRole("button", { name: "Demo roles assigned" }),
  ).toBeDisabled();

  await page.screenshot({
    path: "test-results/demo-prompts.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .include(".demo-workspace")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("link", { name: "See how it works" }).click();
  await page.getByRole("button", { name: "Play walkthrough" }).click();
  await expect(
    page.getByRole("button", { name: "Pause animation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Core persists/ }).click();
  await page.getByRole("button", { name: "Explore sample code" }).click();
  await expect(page.locator(".demo-explanation pre")).toContainText(
    "appendEvent",
  );
  await page
    .getByRole("button", { name: "Persist the event before notifying the UI" })
    .click();
  await expect(page.getByText(/Exactly. Durable state/)).toBeVisible();
  await page.getByRole("button", { name: "Practice the pitch" }).click();
  await expect(page.getByText(/The scope:/)).toBeVisible();
  await page.screenshot({
    path: "test-results/demo-learn.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .include(".demo-workspace")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/demo-viewport.png" });
  await page.getByRole("button", { name: "Reset walkthrough" }).click();
  await expect(
    page.getByRole("button", {
      name: "Upload & create architecture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Generated architecture" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("four PDF downloads exist, and supplied source documents are served", async ({
  request,
}) => {
  for (const letter of ["a", "b", "c", "d"]) {
    const result = await request.get(`/demo/laptop-${letter}-pack.pdf`);
    expect(result.ok()).toBeTruthy();
    expect((await result.body()).subarray(0, 5).toString()).toBe("%PDF-");
  }
  const architecture = await request.get("/demo/ARCHITECTURE.md");
  expect(await architecture.text()).toContain("CoordinatorService");
});

test("fresh page and device link cannot bypass upload gate", async ({
  page,
}) => {
  await page.goto("/#studio");
  await page.evaluate(() =>
    localStorage.setItem(
      "upside-down-demo-v1",
      JSON.stringify({
        idea: "old brief",
        generated: true,
        assigned: true,
        tools: {},
      }),
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Generated architecture" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Upload & create architecture" }),
  ).toBeDisabled();
  await page.goto("/#prompts?device=P3");
  await expect(
    page.getByText("Your prompt vault starts with a plan."),
  ).toBeVisible();
});

test("mobile demo remains usable and accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#studio");
  await page
    .getByLabel("Upload problem files")
    .setInputFiles({
      name: "mobile.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("demo"),
    });
  await page
    .getByRole("button", { name: "Upload & create architecture", exact: true })
    .click();
  await expect(
    page.getByText("Your reference architecture is ready"),
  ).toBeVisible({ timeout: 31000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/demo-mobile.png",
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .include(".demo-workspace")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
});
