import fs from "node:fs";
import { FrontendController } from "./core/frontendController.ts";
/**
 * Server Entrypoint
 * Full Offline-First Multi-Agent Platform Prototype
 * Architecture & Integration Baseline: UD-IC/1.0
 * Laptop 1 / Computer A — Authoritative Coordinator & Execution Host
 */

import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { CoordinatorDatabase } from "./db/database.ts";
import { CoordinatorService } from "./core/coordinator.ts";
import { SyncEngine } from "./sync/syncEngine.ts";
import { createApiRouter } from "./api/routes.ts";
import { ExecutionPipeline } from "./agents/executionPipeline.ts";
import { AuthManager } from "./core/auth.ts";

export interface ServerInstance {
  app: Express;
  db: CoordinatorDatabase;
  coordinator: CoordinatorService;
  syncEngine: SyncEngine;
  frontendController: FrontendController;
  executionPipeline: ExecutionPipeline;
  authManager: AuthManager;
}

export function createServer(dbPath?: string): ServerInstance {
  const resolvedDbPath = dbPath || process.env.UD_DB_PATH || path.resolve(process.cwd(), "data", "upside_down.db");
  const db = new CoordinatorDatabase(resolvedDbPath);
  const coordinator = new CoordinatorService(db);
  const syncEngine = new SyncEngine(db, coordinator);
  const frontendController = new FrontendController();
  const authManager = new AuthManager(dbPath === ":memory:" ? undefined : path.dirname(resolvedDbPath));

  // Instantiate ExecutionPipeline with safe configuration
  const executionPipeline = new ExecutionPipeline(
    {
      workspacePath: process.env.UD_WORKSPACE_PATH || process.cwd(),
      testCommand: process.env.UD_TEST_COMMAND || "npm test",
      autoWatch: process.env.UD_AUTO_WATCH === "true",
    },
    coordinator
  );

  // Register default agents if none exist
  const existingAgents = coordinator.listAgents();
  if (existingAgents.length === 0) {
    const now = new Date().toISOString();
    const defaultAgents = [
      { id: "agent-coordinator", name: "Coordinator Agent", status: "idle" as const, runtimeAvailable: true, lastSeenAt: now },
      { id: "agent-watcher", name: "File Monitor Agent", status: "idle" as const, runtimeAvailable: true, lastSeenAt: now },
      { id: "agent-runner", name: "Test Runner Agent", status: "idle" as const, runtimeAvailable: true, lastSeenAt: now },
      { id: "agent-repair", name: "Heuristic Repair Agent", status: "idle" as const, runtimeAvailable: true, lastSeenAt: now },
      { id: "agent-sync", name: "Offline Sync Agent", status: "idle" as const, runtimeAvailable: true, lastSeenAt: now },
    ];
    for (const a of defaultAgents) {
      coordinator.registerAgent(a);
    }
  }

  // Register default project if none exists
  if (coordinator.listProjects().length === 0) {
    coordinator.createProject({
      id: "proj-upside-down",
      name: "Upside-Down Collaboration Platform",
      description: "Offline-First Multi-Agent Coding Collaboration Platform (PS-03)",
    }, "system_init");
  }

  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // Mount API router
  app.use("/api", createApiRouter(coordinator, syncEngine, frontendController, authManager));

  // Serve active Frontend assets
  const activePublicDir = frontendController.getActivePublicDir();
  app.use(express.static(activePublicDir));
  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.get("/", (_req, res) => {
    const htmlPath = path.join(frontendController.getActivePublicDir(), "index.html");
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.sendFile(path.join(process.cwd(), "public", "index.html"));
    }
  });

  return { app, db, coordinator, syncEngine, frontendController, executionPipeline, authManager };
}

// Start standalone server when run directly
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  const HOST = process.env.UD_HOST || "0.0.0.0";
  const { app, db, executionPipeline } = createServer();

  if (process.env.UD_AUTO_WATCH === "true") {
    executionPipeline.start();
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`=======================================================`);
    console.log(`[Upside-Down Coordinator] Authoritative Host Live on http://${HOST}:${PORT}`);
    console.log(`[Upside-Down Coordinator] Target Branch: dikshant/backend-proto-g`);
    console.log(`[Upside-Down Coordinator] Protocol Baseline: UD-IC/1.0`);
    console.log(`  - Capabilities: GET  http://${HOST}:${PORT}/api/capabilities`);
    console.log(`  - Dashboard:    GET  http://${HOST}:${PORT}/`);
    console.log(`  - Health:       GET  http://${HOST}:${PORT}/api/health`);
    console.log(`  - Tasks:        GET  http://${HOST}:${PORT}/api/tasks`);
    console.log(`  - Sync Push:    POST http://${HOST}:${PORT}/api/sync/push`);
    console.log(`  - Sync Pull:    GET  http://${HOST}:${PORT}/api/sync/pull`);
    console.log(`  - SSE Stream:   GET  http://${HOST}:${PORT}/api/events/stream`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log("\n[Upside-Down Coordinator] Shutting down cleanly...");
    executionPipeline.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
