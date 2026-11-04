/**
 * Test Group D & G: Dashboard & Full End-to-End Integration Workflow
 * Protocol Version: 3.0
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createServer } from "../index.ts";
import { ExecutionPipeline } from "../agents/executionPipeline.ts";

async function runDashboardE2ETests() {
  console.log("\n=== TEST GROUP D & G: DASHBOARD & FULL INTEGRATION WORKFLOW ===");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "upside-e2e-test-"));
  const dbFile = path.join(tmpDir, "e2e_test.db");

  const { app, db, coordinator, syncEngine, frontendController } = createServer(dbFile);
  const prevFrontend = frontendController.getStatus().activeFrontend;
  frontendController.setFrontend("demo");
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // ----------------------------------------------------
    // Test 1: Frontend Build & Static Dashboard Serving
    // ----------------------------------------------------
    console.log("\n[RUN] Test 1: Frontend build assets and dashboard static delivery...");
    {
      const htmlRes = await fetch(`${baseUrl}/`);
      assert.equal(htmlRes.status, 200);
      const htmlText = await htmlRes.text();
      assert.ok(htmlText.includes("Upside-Down"), "HTML should contain Upside-Down title");
      assert.ok(htmlText.includes("<div id=\"root\">"), "HTML should contain root div");

      const jsRes = await fetch(`${baseUrl}/app.js`);
      assert.equal(jsRes.status, 200);
      const jsText = await jsRes.text();
      assert.ok(jsText.length > 50000, "Bundled app.js should be substantial (>50KB)");
      assert.ok(jsText.includes("Collaborating AI Agents"), "Bundle should contain dashboard React components");

      const cssRes = await fetch(`${baseUrl}/styles.css`);
      assert.equal(cssRes.status, 200);

      console.log("  [PASS] Dashboard HTML, JS bundle, and CSS served cleanly.");
    }

    // ----------------------------------------------------
    // Test 2: Backend Connectivity & Agent Statuses
    // ----------------------------------------------------
    console.log("\n[RUN] Test 2: Backend API connectivity and registered agent statuses...");
    {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { status: string };
      assert.equal(health.status, "ok");

      const agentsRes = await fetch(`${baseUrl}/api/agents`);
      assert.equal(agentsRes.status, 200);
      const agents = (await agentsRes.json()) as unknown[];
      assert.ok(Array.isArray(agents));
      assert.ok(agents.length >= 5, "Default agents should be initialized");

      const syncRes = await fetch(`${baseUrl}/api/sync/status`);
      assert.equal(syncRes.status, 200);
      const syncStatus = (await syncRes.json()) as { enabled: boolean; isOnline: boolean };
      assert.equal(syncStatus.enabled, true);
      assert.equal(syncStatus.isOnline, true);

      console.log("  [PASS] Health, agents, and sync status endpoints verified.");
    }

    // ----------------------------------------------------
    // Test 3: Complete Workflow (File Failure -> Task -> Patch -> Approval -> Done)
    // ----------------------------------------------------
    console.log("\n[RUN] Test 3: End-to-End Workflow: Failure -> Task -> Patch -> Approval -> Done...");
    {
      // Create a test workspace fixture
      const workDir = path.join(tmpDir, "work-workspace");
      fs.mkdirSync(workDir, { recursive: true });

      // Source file with defect
      const appFile = path.join(workDir, "app.cjs");
      fs.writeFileSync(appFile, "function ratio(n) { return n / 0; } module.exports = { ratio };");

      // Test script that fails on app.cjs
      const appTest = path.join(workDir, "test_app.cjs");
      fs.writeFileSync(
        appTest,
        "const { ratio } = require('./app.cjs'); if (ratio(50) === 50) process.exit(0); else process.exit(1);"
      );

      // Setup Execution Pipeline
      const pipeline = new ExecutionPipeline(
        {
          workspacePath: workDir,
          testCommand: `node "${appTest}"`,
          autoWatch: false,
        },
        coordinator
      );

      // Execute pipeline with defective file
      const pipelineResult = await pipeline.handleFileChange(["app.cjs"]);
      assert.ok(pipelineResult, "Pipeline result should exist");
      assert.equal(pipelineResult.status, "completed", "Repair should succeed");
      assert.ok(pipelineResult.diffContent, "Diff content should be produced");

      const tasks = coordinator.listTasks();
      const createdTask = tasks.find((t) => t.title.includes("app.cjs"));
      assert.ok(createdTask, "Created task should exist");
      assert.equal(createdTask.status, "review", "Task should be staged in review state");

      // Verify patch is in database and accessible via API
      const patchRes = await fetch(`${baseUrl}/api/tasks/${createdTask.id}/patch`);
      assert.equal(patchRes.status, 200);
      const patch = (await patchRes.json()) as { id: string; status: string; diffContent: string };
      assert.equal(patch.status, "pending");
      assert.ok(patch.diffContent.length > 0, "Diff content must be present");

      // Human Approval Step via Dashboard API
      const approveRes = await fetch(`${baseUrl}/api/patches/${patch.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerId: "human-lead" }),
      });
      assert.equal(approveRes.status, 200);
      const approvedPatch = (await approveRes.json()) as { status: string };
      assert.equal(approvedPatch.status, "approved");

      // Verify task moved to 'done'
      const completedTask = coordinator.getTask(createdTask.id);
      assert.equal(completedTask.status, "done", "Task must transition to done after human approval");

      console.log("  [PASS] Full End-to-End Autonomous Workflow executed and verified!");
    }

    console.log("\n=== ALL TEST GROUP D & G TESTS PASSED! ===");
  } finally {
    if (frontendController) {
      frontendController.setFrontend("demo");
    }
    server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runDashboardE2ETests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
