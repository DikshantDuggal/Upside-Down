#!/usr/bin/env node
/**
 * Frontend Activation & Replacement CLI Manager
 * Supports:
 * - UPSIDE-DOWN: FRONTEND_STATUS
 * - UPSIDE-DOWN: ACTIVATE_TEAM_FRONTEND [candidate_path]
 * - UPSIDE-DOWN: ROLLBACK_FRONTEND
 */

import { FrontendController } from "../server/core/frontendController.ts";

const controller = new FrontendController();
const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : "status";

console.log("=================================================");
console.log(" UPSIDE-DOWN: FRONTEND CONTROLLER & REPLACEMENT ");
console.log("=================================================");

if (command === "status" || command === "frontend_status" || command === "upside-down:frontend_status") {
  const status = controller.getStatus();
  console.log(`\nActive Frontend:         ${status.activeFrontend.toUpperCase()} (${status.activeFrontendName})`);
  console.log(`Version:                 ${status.activeFrontendVersion}`);
  console.log(`Source Directory:        ${status.sourceDir}`);
  console.log(`Serving Directory:       ${status.resolvedPublicDir}`);
  console.log(`Distribution Bundle:     ${status.bundleExists ? "READY (app.js found)" : "MISSING (Needs build)"}`);
  console.log(`HTML Entrypoint:         ${status.htmlExists ? "READY (index.html found)" : "MISSING"}`);
  console.log(`Rollback Available:      ${status.rollbackAvailable ? "YES" : "NO"}`);
  if (status.previousFrontend) {
    console.log(`Previous Frontend:       ${status.previousFrontend}`);
  }
  if (status.lastActivatedAt) {
    console.log(`Last Activated At:       ${status.lastActivatedAt}`);
    console.log(`Last Activation Result:  ${status.lastActivationResult}`);
  }
  console.log(`Available Frontends:     ${status.availableFrontends.join(", ")}`);
  console.log("\nApplication Access URL:  http://localhost:4000/\n");
  process.exit(0);
}

if (command === "activate" || command === "activate_team_frontend" || command === "upside-down:activate_team_frontend") {
  const candidatePath = args[1] || undefined;
  console.log(`\nValidating and activating Team Frontend${candidatePath ? ` from ${candidatePath}` : " from standard directory"}...`);
  
  const result = controller.activateTeamFrontend(candidatePath);
  if (result.success) {
    console.log(`\n✅ ${result.message}`);
    console.log(`Active Frontend is now: ${result.activeFrontend.toUpperCase()}`);
    console.log(`Previous Frontend preserved for rollback: ${result.previousFrontend}`);
    console.log(`Timestamp: ${result.timestamp}\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ ${result.message}`);
    console.error(`Error details: ${result.error}\n`);
    process.exit(1);
  }
}

if (command === "rollback" || command === "rollback_frontend" || command === "upside-down:rollback_frontend") {
  console.log("\nAttempting frontend rollback to previous known-good implementation...");
  const result = controller.rollbackFrontend();
  if (result.success) {
    console.log(`\n✅ ${result.message}`);
    console.log(`Active Frontend restored: ${result.activeFrontend.toUpperCase()}`);
    console.log(`Timestamp: ${result.timestamp}\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ ${result.message}`);
    console.error(`Error details: ${result.error}\n`);
    process.exit(1);
  }
}

console.error(`Unknown command: ${command}`);
console.log("Usage: node scripts/frontend-manager.js [status|activate|rollback] [candidate_dir]");
process.exit(1);
