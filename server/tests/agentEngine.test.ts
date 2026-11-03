/**
 * Comprehensive Test Suite for Role 2 — AI Agent Execution Engine
 * Tests:
 *  1. File watcher debouncing and ignore rules
 *  2. TestRunner subprocess execution, exit codes, and timeouts
 *  3. RepairEngine bounded repairs and test fixture safety guards
 *  4. ReviewEngine patch security inspection and scoring
 *  5. End-to-end Pipeline integration with Coordinator
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { ProjectFileWatcher } from "../workers/fileWatcher.ts";
import { TestRunner } from "../workers/testRunner.ts";
import { RepairEngine } from "../agents/repairEngine.ts";
import { PatchReviewEngine } from "../agents/reviewEngine.ts";
import { ExecutionPipeline } from "../agents/executionPipeline.ts";
import { CoordinatorDatabase } from "../db/database.ts";
import { CoordinatorService } from "../core/coordinator.ts";

async function runAgentEngineTests(): Promise<void> {
  console.log("=== ROLE 2: AGENT EXECUTION ENGINE TEST SUITE ===");

  const testDir = path.resolve(process.cwd(), "data", "test_agent_engine");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  // -------------------------------------------------------------
  // Test 1: File Watcher Events & Ignore Rules
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 1: File Watcher events, debouncing, and ignore rules...");
  {
    const watcher = new ProjectFileWatcher({
      watchDir: testDir,
      debounceMs: 150,
    });

    const events: string[] = [];
    watcher.on("change", ({ filename }: { filename: string }) => {
      events.push(filename);
    });

    let triggeredChanges: string[] = [];
    const triggeredPromise = new Promise<void>((resolve) => {
      watcher.on("triggered", ({ changedFiles }: { changedFiles: string[] }) => {
        triggeredChanges = changedFiles;
        resolve();
      });
    });

    watcher.start();

    // 1. Write an ignored file (.db)
    fs.writeFileSync(path.join(testDir, "test.db"), "ignored content");
    assert.strictEqual(watcher.isIgnored("test.db"), true);
    assert.strictEqual(watcher.isIgnored("node_modules/express/index.js"), true);
    assert.strictEqual(watcher.isIgnored(".git/config"), true);

    // 2. Write an active source file
    const sampleFile = path.join(testDir, "calculator.ts");
    fs.writeFileSync(sampleFile, "export const add = (a: number, b: number) => a + b;");

    await Promise.race([
      triggeredPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Watcher timeout")), 1500)),
    ]);

    watcher.stop();
    assert.ok(events.length > 0, "Change events should be detected");
    assert.ok(triggeredChanges.some((f) => f.includes("calculator.ts")), "Debounced trigger should contain calculator.ts");
    console.log("  [PASS] File watcher accurately debounced changes and respected ignore rules.");
  }

  // -------------------------------------------------------------
  // Test 2: TestRunner Execution & Timeouts
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 2: TestRunner execution, exit codes, and timeouts...");
  {
    const runner = new TestRunner(1500);

    // 2.1 Passing command
    const passResult = await runner.run({
      cwd: testDir,
      command: "node",
      args: ["-e", "console.log('Test OK'); process.exit(0);"],
    });
    assert.strictEqual(passResult.passed, true);
    assert.strictEqual(passResult.exitCode, 0);
    assert.ok(passResult.stdout.includes("Test OK"));

    // 2.2 Failing command
    const failResult = await runner.run({
      cwd: testDir,
      command: "node",
      args: ["-e", "console.error('AssertionError: Expected 42 but got 0'); process.exit(1);"],
    });
    assert.strictEqual(failResult.passed, false);
    assert.strictEqual(failResult.exitCode, 1);
    assert.ok(failResult.combinedOutput.includes("AssertionError"));
    assert.ok(failResult.failureSummary?.includes("AssertionError"));

    // 2.3 Timeout command
    const timeoutResult = await runner.run({
      cwd: testDir,
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000);"],
      timeoutMs: 300,
    });
    assert.strictEqual(timeoutResult.passed, false);
    assert.strictEqual(timeoutResult.timedOut, true);
    assert.ok(timeoutResult.failureSummary?.includes("timed out"));
    console.log("  [PASS] TestRunner handled success, failure capture, and subprocess timeouts.");
  }

  // -------------------------------------------------------------
  // Test 3: RepairEngine Bounded Repairs & Safety Guards
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 3: RepairEngine bounded repairs and test fixture guards...");
  {
    const repairEngine = new RepairEngine({ maxAttempts: 2, timeoutMs: 3000 });

    // 3.1 Test file protection guard
    const testFile = path.join(testDir, "calculator.test.ts");
    fs.writeFileSync(testFile, "test('math', () => {});");

    const blockedResult = await repairEngine.executeRepair(
      {
        runId: "run-blocked",
        taskId: "task-blocked",
        workspacePath: testDir,
        trigger: "test_failed",
      },
      "calculator.test.ts",
      "node -e 'process.exit(1)'"
    );
    assert.strictEqual(blockedResult.status, "blocked");
    assert.ok(blockedResult.error?.includes("Safety guard"));

    // 3.2 Repair a defective math function
    const mathFile = path.join(testDir, "math.cjs");
    fs.writeFileSync(mathFile, "function divide(a, b) {\n  return a / 0;\n}\nmodule.exports = { divide };");

    // Script that tests math.cjs: fails when divide(10, 2) !== 10
    const testScript = path.join(testDir, "run_math_test.cjs");
    fs.writeFileSync(
      testScript,
      "const { divide } = require('./math.cjs'); if (divide(10, 2) === 10) process.exit(0); else process.exit(1);"
    );

    const repairResult = await repairEngine.executeRepair(
      {
        runId: "run-repair-1",
        taskId: "task-repair-1",
        workspacePath: testDir,
        trigger: "test_failed",
        testOutput: "Error: division by zero in divide()",
      },
      "math.cjs",
      `node "${testScript}"`
    );

    assert.strictEqual(repairResult.status, "completed");
    assert.ok(repairResult.diffContent?.includes("-  return a / 0;"));
    assert.ok(repairResult.diffContent?.includes("+  return a / 1;"));

    // Verify original file was preserved (reverted until human approval)
    const fileAfterTest = fs.readFileSync(mathFile, "utf-8");
    assert.strictEqual(fileAfterTest.includes("/ 0"), true);
    console.log("  [PASS] RepairEngine produced verified unified diff and guarded test fixtures.");
  }

  // -------------------------------------------------------------
  // Test 4: ReviewEngine Patch Security Inspection
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 4: ReviewEngine patch security inspection and scoring...");
  {
    const reviewEngine = new PatchReviewEngine();

    // Safe patch
    const safeDiff = `--- a/math.cjs\n+++ b/math.cjs\n@@ -1,3 +1,3 @@\n-return a / 0;\n+return a / 1;`;
    const safeVerdict = reviewEngine.reviewPatch(safeDiff);
    assert.strictEqual(safeVerdict.safe, true);
    assert.strictEqual(safeVerdict.score, 100);
    assert.strictEqual(safeVerdict.reasons.length, 0);

    // Dangerous patch with token and recursive delete
    const maliciousDiff = `--- a/service.js\n+++ b/service.js\n@@ -1,2 +1,3 @@\n+const token = "gho_abcdef123456789012345678901234567890";\n+require('child_process').execSync('rm -rf /');`;
    const badVerdict = reviewEngine.reviewPatch(maliciousDiff);
    assert.strictEqual(badVerdict.safe, false);
    assert.ok(badVerdict.score < 70);
    assert.ok(badVerdict.reasons.some((r) => r.includes("recursive deletion")));
    assert.ok(badVerdict.reasons.some((r) => r.includes("Exposed GitHub token")));

    // Patch modifying test files
    const testPatchDiff = `--- a/test.spec.ts\n+++ b/test.spec.ts\n@@ -1,2 +1,2 @@\n-assert(false);\n+assert(true);`;
    const testVerdict = reviewEngine.reviewPatch(testPatchDiff);
    assert.strictEqual(testVerdict.safe, false);
    assert.ok(testVerdict.reasons.some((r) => r.includes("Suspicious modification of test file")));

    console.log("  [PASS] ReviewEngine blocked malicious commands, leaked tokens, and test modifications.");
  }

  // -------------------------------------------------------------
  // Test 5: End-to-End ExecutionPipeline & Coordinator Integration
  // -------------------------------------------------------------
  console.log("\n[RUN] Test 5: End-to-End ExecutionPipeline and Coordinator integration...");
  {
    const db = new CoordinatorDatabase(":memory:");
    const coordinator = new CoordinatorService(db);

    // Source file with defect
    const appFile = path.join(testDir, "app.cjs");
    fs.writeFileSync(appFile, "function ratio(n) { return n / 0; } module.exports = { ratio };");

    // Test script that fails on app.cjs
    const appTest = path.join(testDir, "test_app.cjs");
    fs.writeFileSync(
      appTest,
      "const { ratio } = require('./app.cjs'); if (ratio(50) === 50) process.exit(0); else process.exit(1);"
    );

    const pipeline = new ExecutionPipeline(
      {
        workspacePath: testDir,
        testCommand: `node "${appTest}"`,
        autoWatch: false, // Manual trigger for deterministic test
      },
      coordinator
    );

    pipeline.start();

    // Trigger pipeline on the defective file
    const result = await pipeline.handleFileChange(["app.cjs"]);
    assert.ok(result, "Pipeline should return result on test failure");
    assert.strictEqual(result.status, "completed");
    assert.ok(result.diffContent);

    // Verify Coordinator state
    const tasks = coordinator.listTasks();
    assert.ok(tasks.length > 0, "Coordinator should have created a repair task");
    const repairTask = tasks.find((t) => t.title.includes("app.cjs"));
    assert.ok(repairTask, "Task should target app.cjs");
    assert.strictEqual(repairTask.status, "review", "Task should be in review awaiting human approval");

    // Verify patch is in coordinator via getPatchByTaskId
    const patch = coordinator.getPatchByTaskId(repairTask.id);
    assert.ok(patch, "Patch should be recorded in coordinator");
    assert.strictEqual(patch.status, "pending");
    assert.strictEqual(patch.diffContent, result.diffContent);

    pipeline.stop();
    db.close();
    console.log("  [PASS] Full Pipeline: Failure detected -> Task created -> Patch generated -> Staged in Review.");
  }

  // Clean test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  console.log("\n=== ALL ROLE 2 TESTS PASSED SUCCESSFULLY! ===");
}

runAgentEngineTests().catch((err) => {
  console.error("Agent Engine test failed:", err);
  process.exit(1);
});
