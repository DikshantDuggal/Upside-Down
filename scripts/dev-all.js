#!/usr/bin/env node
/**
 * UPSIDE-DOWN UNIFIED LAUNCHER (npm run dev:all)
 * Protocol: UD-IC/1.0
 * 
 * Orchestrates:
 * 1. Computer A Authoritative Coordinator (:4000)
 * 2. Computer B Client-Local Offline Sync Service (:4100)
 * 3. Official Frontend Dashboard (:5173)
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";

const ROOT_DIR = process.cwd();
const IS_WINDOWS = process.platform === "win32";

// ANSI Colors
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

const children = [];
let isShuttingDown = false;

function log(prefix, color, message) {
  const lines = String(message).split(/\r?\n/);
  for (const line of lines) {
    if (line.trim()) {
      console.log(`${color}${prefix}${RESET} ${line}`);
    }
  }
}

function info(msg) {
  console.log(`${CYAN}[LAUNCHER]${RESET} ${msg}`);
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

// 1. Environment Pre-flight Checks
function preflightChecks() {
  info("Executing environment pre-flight verification...");

  // Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  if (major < 20) {
    error(`Node.js >= 20.0.0 required. Current version: v${nodeVersion}`);
    process.exit(1);
  }
  success(`Node.js runtime verified: v${nodeVersion}`);

  // npm verification
  try {
    const npmVersion = execSync("npm --version", { stdio: "pipe" }).toString().trim();
    success(`npm package manager verified: v${npmVersion}`);
  } catch {
    error("npm command not available in PATH.");
    process.exit(1);
  }

  // 2. Package Dependency Checks
  const packageRoots = [
    { name: "Root Workspace", dir: ROOT_DIR },
    { name: "Client-Local Service", dir: path.join(ROOT_DIR, "client-local") },
    { name: "Official Frontend (web/)", dir: path.join(ROOT_DIR, "web") },
  ];

  for (const pkg of packageRoots) {
    const nm = path.join(pkg.dir, "node_modules");
    if (!fs.existsSync(nm)) {
      warn(`node_modules missing in ${pkg.name}. Running npm install...`);
      execSync("npm install", { cwd: pkg.dir, stdio: "inherit" });
    }
    success(`Dependencies verified for ${pkg.name}`);
  }

  // 3. Writable Database & Credential Directories
  const dataDirs = [
    path.join(ROOT_DIR, "data"),
    path.join(ROOT_DIR, "client-local", "data"),
  ];

  for (const dir of dataDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const testFile = path.join(dir, `.write-test-${Date.now()}`);
    try {
      fs.writeFileSync(testFile, "ok", "utf8");
      fs.unlinkSync(testFile);
      success(`Storage directory writable: ${path.relative(ROOT_DIR, dir)}/`);
    } catch (err) {
      error(`Cannot write to storage directory ${dir}: ${err.message}`);
      process.exit(1);
    }
  }

  // Setup / Synchronize Reviewer & Device Credentials
  const rootReviewerFile = path.join(ROOT_DIR, "data", "reviewer-token.txt");
  const clientReviewerFile = path.join(ROOT_DIR, "client-local", "data", "reviewer-token.txt");
  const clientDeviceFile = path.join(ROOT_DIR, "client-local", "data", "device-token.txt");

  let sharedReviewerToken = process.env.UD_REVIEWER_TOKEN;
  if (!sharedReviewerToken && fs.existsSync(rootReviewerFile)) {
    sharedReviewerToken = fs.readFileSync(rootReviewerFile, "utf8").trim();
  }
  if (!sharedReviewerToken) {
    sharedReviewerToken = "reviewer-" + randomUUID();
    fs.writeFileSync(rootReviewerFile, sharedReviewerToken, { encoding: "utf8", mode: 0o600 });
  }
  // Ensure client-local has matching reviewer token for privileged online actions
  fs.writeFileSync(clientReviewerFile, sharedReviewerToken, { encoding: "utf8", mode: 0o600 });

  if (!fs.existsSync(clientDeviceFile)) {
    fs.writeFileSync(clientDeviceFile, randomUUID(), { encoding: "utf8", mode: 0o600 });
  }
  success("Security credentials synchronized between Coordinator and Client-Local service.");
}

// 4. Port Availability Check & Process Clearing
async function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function killPortProcess(port) {
  try {
    if (IS_WINDOWS) {
      const output = execSync(`netstat -ano | findstr :${port}`, { stdio: "pipe" }).toString();
      const lines = output.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        if (line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== "0" && parseInt(pid, 10) !== process.pid) {
            info(`Terminating lingering process on port ${port} (PID: ${pid})...`);
            try {
              execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch {
    // Port not in use or findstr returned empty
  }
}

async function preparePorts() {
  const ports = [4000, 4100, 5173];
  for (const port of ports) {
    let available = await checkPort(port);
    if (!available) {
      warn(`Port :${port} is currently occupied. Attempting automated recovery...`);
      killPortProcess(port);
      await new Promise((r) => setTimeout(r, 1000));
      available = await checkPort(port);
      if (!available) {
        error(`Port :${port} is in use and could not be freed. Please free port ${port} manually.`);
        process.exit(1);
      }
    }
    success(`Port :${port} available.`);
  }
}

// 5. Detect Network Interfaces for Multi-Computer Teammates
function getLanIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const netInfo of interfaces[name] || []) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        addresses.push({ interface: name, address: netInfo.address });
      }
    }
  }
  return addresses;
}

// Health Polling Helpers
async function waitForHttp(url, timeoutMs = 15000, headers = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// 6. Spawn Service Process
function spawnService(name, color, command, args, cwd, env = {}) {
  const cmdStr = IS_WINDOWS && command === "npm" ? "npm.cmd" : command;
  const child = spawn(cmdStr, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    shell: IS_WINDOWS,
  });

  children.push({ name, process: child });

  child.stdout.on("data", (data) => log(`[${name}]`, color, data.toString()));
  child.stderr.on("data", (data) => log(`[${name}]`, color, data.toString()));

  child.on("exit", (code, signal) => {
    if (!isShuttingDown) {
      error(`Service [${name}] exited unexpectedly with code ${code ?? signal}`);
      shutdown();
    }
  });

  return child;
}

// Graceful Shutdown
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${YELLOW}[LAUNCHER] Shutting down all Upside-Down services gracefully...${RESET}`);

  for (const { name, process: child } of children) {
    try {
      if (IS_WINDOWS) {
        try {
          execSync(`taskkill /T /F /PID ${child.pid}`, { stdio: "pipe" });
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
      info(`Terminated [${name}]`);
    } catch {
      // process already dead
    }
  }

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Main Orchestrator
async function main() {
  console.log("===================================================================");
  console.log(`${BOLD}${MAGENTA}       UPSIDE-DOWN — MULTI-COMPUTER HACKATHON PLATFORM MVP         ${RESET}`);
  console.log(`${BOLD}${CYAN}            Protocol: UD-IC/1.0  |  Unified Full-Stack Engine      ${RESET}`);
  console.log("===================================================================\n");

  preflightChecks();
  await preparePorts();

  const lanAddresses = getLanIpv4Addresses();

  // Step 1: Start Authoritative Coordinator (Computer A) on :4000
  info("Launching Authoritative Coordinator (Computer A) on port 4000...");
  spawnService(
    "COORDINATOR:4000",
    GREEN,
    "node",
    ["--experimental-strip-types", "server/index.ts"],
    ROOT_DIR,
    {
      PORT: "4000",
      HOST: "0.0.0.0",
      UD_MODE: "authoritative",
      UD_PATCH_MODE: "verified_application",
    }
  );

  const coordReady = await waitForHttp("http://127.0.0.1:4000/api/health", 15000);
  if (!coordReady) {
    error("Coordinator health check timed out on http://127.0.0.1:4000/api/health");
    shutdown();
    return;
  }
  success("Coordinator online and healthy (UD-IC/1.0 ready).");

  // Step 2: Start Client-Local Service (Computer B) on :4100
  info("Launching Client-Local Offline Sync Service (Computer B) on port 4100...");
  const clientDataDir = path.join(ROOT_DIR, "client-local", "data");
  spawnService(
    "LOCAL-SYNC:4100",
    YELLOW,
    "npm",
    ["start"],
    path.join(ROOT_DIR, "client-local"),
    {
      UD_LOCAL_PORT: "4100",
      UD_COORDINATOR_URL: "http://127.0.0.1:4000",
      UD_DEVICE_DB: path.join(clientDataDir, "device-b.db"),
      UD_DEVICE_TOKEN_FILE: path.join(clientDataDir, "device-token.txt"),
      UD_REVIEWER_TOKEN_FILE: path.join(clientDataDir, "reviewer-token.txt"),
      UD_ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4000,http://localhost:4000,http://127.0.0.1:4100,http://localhost:4100",
    }
  );

  // Wait for client-local service port 4100
  let clientReady = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 15000) {
    const isAvailable = await checkPort(4100);
    if (!isAvailable) {
      // Port is occupied, meaning the server started listening!
      clientReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!clientReady) {
    error("Client-Local service failed to start on port 4100");
    shutdown();
    return;
  }
  success("Client-Local service online with durable SQLite WAL outbox.");

  // Step 3: Start Official Team Frontend (web/) on :5173
  info("Launching Official Team Frontend (web/) Vite server on port 5173...");
  spawnService(
    "FRONTEND:5173",
    CYAN,
    "npm",
    ["run", "dev"],
    path.join(ROOT_DIR, "web"),
    {
      UD_LOCAL_TARGET: "http://127.0.0.1:4100",
      UD_API_TARGET: "http://127.0.0.1:4000",
      UD_DEVICE_DB: path.join(clientDataDir, "device-b.db"),
    }
  );

  const frontendReady = await waitForHttp("http://127.0.0.1:5173/", 20000);
  if (!frontendReady) {
    warn("Frontend dev server still initializing or responding on alternate path.");
  } else {
    success("Official Frontend (web/) Vite dev server ready.");
  }

  // Display Unified Launch Summary Banner
  console.log("\n===================================================================");
  console.log(`${BOLD}${GREEN}               UPSIDE-DOWN PLATFORM IS FULLY OPERATIONAL            ${RESET}`);
  console.log("===================================================================");
  console.log(`\n${BOLD}Primary Access Endpoints:${RESET}`);
  console.log(`  -> ${BOLD}Unified Frontend UI:${RESET}      ${CYAN}http://localhost:5173/${RESET}`);
  console.log(`  -> ${BOLD}Coordinator Cockpit:${RESET}      ${GREEN}http://localhost:4000/${RESET}`);
  console.log(`  -> ${BOLD}Coordinator Capabilities:${RESET} ${GREEN}http://localhost:4000/api/capabilities${RESET}`);
  console.log(`  -> ${BOLD}Client-Local Service:${RESET}     ${YELLOW}http://localhost:4100/${RESET}`);

  if (lanAddresses.length > 0) {
    console.log(`\n${BOLD}Teammate LAN Targets (Computer B / Arhaan's physical computer):${RESET}`);
    for (const item of lanAddresses) {
      console.log(`  -> Interface [${item.interface}]: ${CYAN}http://${item.address}:4000${RESET}`);
    }
    console.log(`  ${GRAY}(Point Computer B's UD_COORDINATOR_URL to one of the above LAN addresses)${RESET}`);
  }

  console.log(`\n${BOLD}Available Slash & Shell Commands:${RESET}`);
  console.log("  - Status check:       npm run test:multi-computer");
  console.log("  - Frontend switch:    node scripts/frontend-manager.js [status|activate|rollback]");
  console.log("  - Stop all services:  Press Ctrl+C in this terminal window\n");
  console.log("-------------------------------------------------------------------");
  info("Streaming unified real-time logs below...\n");
}

main().catch((err) => {
  error(`Launcher failed: ${err.message}`);
  shutdown();
});


