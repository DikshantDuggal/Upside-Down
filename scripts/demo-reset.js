#!/usr/bin/env node
/**
 * UPSIDE-DOWN DEMO RESET MECHANISM
 * Protocol: UD-IC/1.0
 * 
 * Safely resets all disposable demonstration records (sample tasks, outbox envelopes,
 * activity logs, conflict records, messages, and handoffs) across both Computer A
 * (Coordinator) and Computer B (Client-Local Sync) without deleting source code,
 * production configurations, or pre-enrolled device/reviewer credentials.
 * 
 * Usage:
 *   npm run demo:reset
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const ROOT_DIR = process.cwd();

// ANSI Colors
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function info(msg) {
  console.log(`${CYAN}[DEMO-RESET]${RESET} ${msg}`);
}

function success(msg) {
  console.log(`${GREEN}✔ ${msg}${RESET}`);
}

function warn(msg) {
  console.log(`${YELLOW}⚠ ${msg}${RESET}`);
}

function error(msg) {
  console.error(`${RED}✖ ${msg}${RESET}`);
}

async function checkPortOccupied(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(true));
    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function runDemoReset() {
  console.log(`\n${BOLD}==========================================================${RESET}`);
  console.log(`${BOLD}   UPSIDE-DOWN: HACKATHON DEMO RESET & SANITIZATION       ${RESET}`);
  console.log(`${BOLD}   Protocol Baseline: UD-IC/1.0                          ${RESET}`);
  console.log(`${BOLD}==========================================================${RESET}\n`);

  info("Checking active service ports...");
  const p4000 = await checkPortOccupied(4000);
  const p4100 = await checkPortOccupied(4100);

  if (p4000 || p4100) {
    warn("Active services detected (Port 4000: " + (p4000 ? "Active" : "Idle") + ", Port 4100: " + (p4100 ? "Active" : "Idle") + ").");
    warn("For optimal demonstration reset, stop any running dev servers (Ctrl+C in terminal), then re-run demo:reset.");
  } else {
    success("All development ports are idle.");
  }

  // 1. Reset Computer A (Coordinator) Storage
  const coordinatorDbPath = path.resolve(ROOT_DIR, "data", "upside_down.db");
  const dataDir = path.resolve(ROOT_DIR, "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    info(`Created directory: ${dataDir}`);
  }

  if (fs.existsSync(coordinatorDbPath)) {
    info(`Resetting Coordinator database at ${coordinatorDbPath}...`);
    try {
      const db = new DatabaseSync(coordinatorDbPath);
      db.exec(`
        DELETE FROM tasks;
        DELETE FROM activity_events;
        DELETE FROM sync_outbox;
        DELETE FROM sync_events;
        DELETE FROM conflicts;
        DELETE FROM projects;
        DELETE FROM handoffs;
        DELETE FROM coordinator_inbox;
        DELETE FROM device_progress;
        DELETE FROM canonical_journal;
        DELETE FROM patches;
        DELETE FROM agents;
        VACUUM;
      `);
      db.close();
      success("Coordinator database cleared: 0 tasks, 0 conflicts, 0 activity logs, 0 pending patches.");
    } catch (err) {
      error(`Failed to clean Coordinator database: ${err.message}`);
    }
  } else {
    info("Coordinator database does not exist yet (will be initialized cleanly upon start).");
  }

  // 2. Reset Computer B (Client-Local Sync) Storage
  const clientDataDir = path.resolve(ROOT_DIR, "client-local", "data");
  const deviceDbPath = path.resolve(clientDataDir, "device-b.db");

  if (!fs.existsSync(clientDataDir)) {
    fs.mkdirSync(clientDataDir, { recursive: true });
    info(`Created directory: ${clientDataDir}`);
  }

  if (fs.existsSync(deviceDbPath)) {
    info(`Resetting Client-Local SQLite database at ${deviceDbPath}...`);
    try {
      const devDb = new DatabaseSync(deviceDbPath);
      devDb.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM requests;
        DELETE FROM outbox;
        DELETE FROM inbox;
        DELETE FROM entities;
        DELETE FROM cache;
        DELETE FROM changes;
        DELETE FROM meta WHERE key IN ('remoteCursor', 'epoch', 'rebuilding');
        PRAGMA foreign_keys = ON;
        VACUUM;
      `);
      devDb.close();
      success("Client-Local database cleared: 0 queued outbox items, 0 browser cached records.");
    } catch (err) {
      error(`Failed to clean Client-Local database: ${err.message}`);
    }
  } else {
    info("Client-Local database does not exist yet (will be initialized cleanly upon start).");
  }

  // 3. Verify / Preserve Authentication Tokens for Immediate Pairing
  const deviceTokenPath = path.join(clientDataDir, "device-token.txt");
  const reviewerTokenPath = path.join(clientDataDir, "reviewer-token.txt");

  if (!fs.existsSync(deviceTokenPath)) {
    const devToken = crypto.randomUUID();
    fs.writeFileSync(deviceTokenPath, devToken, "utf8");
    info(`Generated fresh Device Token: ${deviceTokenPath}`);
  } else {
    success(`Preserved existing Device Token: ${deviceTokenPath}`);
  }

  if (!fs.existsSync(reviewerTokenPath)) {
    const revToken = "reviewer-" + crypto.randomUUID();
    fs.writeFileSync(reviewerTokenPath, revToken, "utf8");
    info(`Generated fresh Reviewer Token: ${reviewerTokenPath}`);
  } else {
    success(`Preserved existing Reviewer Token: ${reviewerTokenPath}`);
  }

  console.log(`\n${BOLD}==========================================================${RESET}`);
  console.log(`${GREEN}${BOLD}✔ DEMO RESET COMPLETE — SYSTEM READY FOR FRESH PRESENTATION${RESET}`);
  console.log(`${BOLD}==========================================================${RESET}`);
  console.log(`${GRAY}Run ${BOLD}npm run dev:all${RESET}${GRAY} to launch all services for the live demo.${RESET}\n`);
}

runDemoReset().catch((err) => {
  error(`Demo reset encountered an unexpected failure: ${err}`);
  process.exit(1);
});
