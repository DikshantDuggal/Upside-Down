/**
 * Server Entrypoint
 * Role 1 — Core Backend & Coordinator
 */

import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { CoordinatorDatabase } from "./db/database.ts";
import { CoordinatorService } from "./core/coordinator.ts";
import { createApiRouter } from "./api/routes.ts";

export interface ServerInstance {
  app: Express;
  db: CoordinatorDatabase;
  coordinator: CoordinatorService;
}

export function createServer(dbPath?: string): ServerInstance {
  const resolvedDbPath = dbPath || path.resolve(process.cwd(), "data", "upside_down.db");
  const db = new CoordinatorDatabase(resolvedDbPath);
  const coordinator = new CoordinatorService(db);

  const app: Express = express();
  app.use(cors());
  app.use(express.json());

  // Mount API router
  app.use("/api", createApiRouter(coordinator));

  return { app, db, coordinator };
}

// Start standalone server when run directly
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  const { app } = createServer();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Upside-Down Coordinator] Server listening on http://localhost:${PORT}`);
    console.log(`[Upside-Down Coordinator] Role 1 active on branch dikshant/backend`);
    console.log(`[Upside-Down Coordinator] Endpoints:`);
    console.log(`  - Health:     GET  http://localhost:${PORT}/api/health`);
    console.log(`  - Tasks:      GET  http://localhost:${PORT}/api/tasks`);
    console.log(`  - SSE Stream: GET  http://localhost:${PORT}/api/events/stream`);
  });
}
