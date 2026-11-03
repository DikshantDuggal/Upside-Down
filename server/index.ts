/**
 * Server Entrypoint
 * Full Offline-First Multi-Agent Platform Prototype
 * Protocol Version: 3.0
 */

import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { CoordinatorDatabase } from "./db/database.ts";
import { CoordinatorService } from "./core/coordinator.ts";
import { SyncEngine } from "./sync/syncEngine.ts";
import { createApiRouter } from "./api/routes.ts";

export interface ServerInstance {
  app: Express;
  db: CoordinatorDatabase;
  coordinator: CoordinatorService;
  syncEngine: SyncEngine;
}

export function createServer(dbPath?: string): ServerInstance {
  const resolvedDbPath = dbPath || path.resolve(process.cwd(), "data", "upside_down.db");
  const db = new CoordinatorDatabase(resolvedDbPath);
  const coordinator = new CoordinatorService(db);
  const syncEngine = new SyncEngine(db, coordinator);

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

  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // Mount API router
  app.use("/api", createApiRouter(coordinator, syncEngine));

  // Serve static Dashboard assets
  const publicDir = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return { app, db, coordinator, syncEngine };
}

// Start standalone server when run directly
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  const { app } = createServer();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=======================================================`);
    console.log(`[Upside-Down Prototype] Full Platform Live on http://localhost:${PORT}`);
    console.log(`[Upside-Down Prototype] Target Branch: dikshat/backend-proto-g`);
    console.log(`  - Dashboard:  GET  http://localhost:${PORT}/`);
    console.log(`  - Health:     GET  http://localhost:${PORT}/api/health`);
    console.log(`  - Tasks:      GET  http://localhost:${PORT}/api/tasks`);
    console.log(`  - Sync:       GET  http://localhost:${PORT}/api/sync/status`);
    console.log(`  - SSE Stream: GET  http://localhost:${PORT}/api/events/stream`);
    console.log(`=======================================================`);
  });
}
