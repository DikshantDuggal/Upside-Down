import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.UD_TEST_WEB_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid UD_TEST_WEB_PORT");
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
