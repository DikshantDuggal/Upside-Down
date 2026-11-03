/**
 * Frontend Activation & Replacement System Automated Verification Suite
 * Protocol: Section 12 — Replacement Tests
 * 
 * Verifies:
 * 1. Demo frontend configuration and serving path.
 * 2. Backend API connectivity and status endpoint (/api/frontend/status).
 * 3. Rejection of invalid candidate frontend (non-existent dir, missing entrypoint).
 * 4. Preservation of Demo frontend and backend state when invalid candidate is rejected.
 * 5. Safe activation of valid candidate frontend.
 * 6. Non-destructive switching (tasks, database, and contracts untouched).
 * 7. Rollback functionality restoring the previous known-good frontend.
 */

import { FrontendController } from "../core/frontendController.ts";
import { createServer } from "../index.ts";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

async function runReplacementTests() {
  console.log("\n=== FRONTEND REPLACEMENT & HANDOFF TEST SUITE ===");

  const testRoot = process.cwd();
  const controller = new FrontendController(testRoot);

  // 1. Initial Status Check
  console.log("\n[TEST 1] Verifying Demo Frontend Initial Status...");
  const initialStatus = controller.getStatus();
  if (initialStatus.activeFrontend !== "demo") {
    throw new Error(`Expected active frontend to be 'demo', got '${initialStatus.activeFrontend}'`);
  }
  if (!initialStatus.bundleExists) {
    throw new Error(`Demo distribution bundle missing at ${initialStatus.distDir}`);
  }
  console.log(`  [PASS] Initial active frontend is 'demo' (${initialStatus.activeFrontendName}). Bundle ready.`);

  // 2. Start Test Server & Verify API Endpoint
  console.log("\n[TEST 2] Verifying Server Integration & API Routing...");
  const { app, db, coordinator } = createServer(":memory:");
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    const statusRes = await fetch(`${baseUrl}/frontend/status`);
    if (!statusRes.ok) throw new Error(`/api/frontend/status returned status ${statusRes.status}`);
    const statusData = await statusRes.json();
    if (statusData.activeFrontend !== "demo") {
      throw new Error(`API returned active frontend '${statusData.activeFrontend}', expected 'demo'`);
    }
    console.log(`  [PASS] /api/frontend/status returned 200 OK with active frontend: '${statusData.activeFrontend}'`);

    // 3. Populate Sample Task & Backend Data to Verify Non-Destructive Preservation
    console.log("\n[TEST 3] Staging Sample Task Data in Backend Storage...");
    const task = coordinator.createTask({
      title: "Task Preserved During Frontend Replacement",
      description: "This task must remain intact across frontend switches.",
    });
    console.log(`  [PASS] Staged Task '${task.title}' (ID: ${task.id})`);

    // 4. Test Candidate Validation: Rejection of Invalid Candidate
    console.log("\n[TEST 4] Testing Candidate Validation Guard: Invalid Directory...");
    const invalidDir = path.join(testRoot, "non_existent_frontend_directory_12345");
    const invalidRes = controller.validateCandidate(invalidDir);
    if (invalidRes.valid) {
      throw new Error("Validation succeeded on a non-existent directory! Expected failure.");
    }
    console.log(`  [PASS] Non-existent candidate properly rejected: ${invalidRes.errors[0]}`);

    console.log("\n[TEST 5] Testing Rejection of Incomplete Candidate (Missing Entrypoint)...");
    const tempEmptyCandidate = path.join(testRoot, "apps", "temp_empty_candidate");
    if (!fs.existsSync(tempEmptyCandidate)) {
      fs.mkdirSync(tempEmptyCandidate, { recursive: true });
    }
    try {
      const emptyValidation = controller.validateCandidate(tempEmptyCandidate);
      if (emptyValidation.valid) {
        throw new Error("Validation succeeded on empty directory! Expected failure.");
      }
      console.log(`  [PASS] Incomplete candidate properly rejected: ${emptyValidation.errors[0]}`);

      // Attempt Activation of Invalid Candidate
      const failedActivation = controller.activateTeamFrontend(tempEmptyCandidate);
      if (failedActivation.success) {
        throw new Error("Activation succeeded on invalid candidate! Expected abort.");
      }
      console.log(`  [PASS] Activation aborted safely. Active frontend remains: '${failedActivation.activeFrontend}'`);
    } finally {
      if (fs.existsSync(tempEmptyCandidate)) {
        fs.rmSync(tempEmptyCandidate, { recursive: true, force: true });
      }
    }

    // 5. Test Valid Candidate Activation (Team Frontend)
    console.log("\n[TEST 6] Testing Valid Candidate Activation (Official Team Frontend)...");
    const teamDir = path.join(testRoot, "frontend");
    const teamValidation = controller.validateCandidate(teamDir);
    if (!teamValidation.valid) {
      throw new Error(`Official team frontend candidate failed validation: ${teamValidation.errors.join("; ")}`);
    }
    console.log("  [PASS] Official team candidate validated successfully.");

    const activationResult = controller.activateTeamFrontend(teamDir);
    if (!activationResult.success || activationResult.activeFrontend !== "team") {
      throw new Error(`Team frontend activation failed: ${activationResult.error}`);
    }
    console.log(`  [PASS] Team frontend activated! (Previous frontend preserved: '${activationResult.previousFrontend}')`);

    const updatedStatus = controller.getStatus();
    if (updatedStatus.activeFrontend !== "team" || !updatedStatus.rollbackAvailable) {
      throw new Error("Controller state did not update activeFrontend or rollbackAvailable.");
    }
    console.log(`  [PASS] Active frontend is now: ${updatedStatus.activeFrontend}. Rollback available: YES.`);

    // 6. Verify Backend Data Unchanged
    console.log("\n[TEST 7] Verifying Backend Storage Preservation...");
    const retrievedTask = coordinator.getTask(task.id);
    if (!retrievedTask || retrievedTask.title !== task.title) {
      throw new Error("Backend task was lost or mutated during frontend activation!");
    }
    console.log(`  [PASS] Backend data intact! Task '${retrievedTask.title}' preserved.`);

    // 7. Test Rollback to Previous Demo Frontend
    console.log("\n[TEST 8] Testing Rollback to Demo Frontend...");
    const rollbackResult = controller.rollbackFrontend();
    if (!rollbackResult.success || rollbackResult.activeFrontend !== "demo") {
      throw new Error(`Rollback failed: ${rollbackResult.error}`);
    }
    console.log(`  [PASS] Rollback succeeded! Active frontend restored to: '${rollbackResult.activeFrontend}'`);

    const finalStatus = controller.getStatus();
    if (finalStatus.activeFrontend !== "demo") {
      throw new Error(`Expected active frontend to be 'demo' after rollback, got '${finalStatus.activeFrontend}'`);
    }
    console.log(`  [PASS] Final active frontend confirmed: '${finalStatus.activeFrontendName}'.`);

    console.log("\n>>> ALL FRONTEND REPLACEMENT & HANDOFF TESTS PASSED (8/8) <<<\n");
  } finally {
    server.close();
  }
}

runReplacementTests().catch((err) => {
  console.error("\n❌ FRONTEND REPLACEMENT TESTS FAILED:", err);
  process.exit(1);
});
