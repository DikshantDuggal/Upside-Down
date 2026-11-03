/**

 * Server Entrypoint

 * Role 1 — Core Backend & Coordinator

 */

import express, { type Express } from "express";

import cors from "cors";

import path from "node:path";

import fs from "node:fs";

import { ExecutionJobService } from "./agents/jobService.ts";

import type { ExecutionConfiguration } from "./workers/gitWorkspace.ts";

import { createSyncRouter } from "./sync/router.ts";

import { createCollaborationRouter } from "./api/collaboration.ts";
import { adaptGateway } from "./api/syncAdapter.ts";

import { SyncEngine } from "./sync/syncEngine.ts";

import { FrontendController } from "./core/frontendController.ts";

import { requireContract } from "./api/protocol.ts";

import { CoordinatorDatabase } from "./db/database.ts";

import { CoordinatorService } from "./core/coordinator.ts";

import { createApiRouter } from "./api/routes.ts";

import { AuthenticationService } from "./core/auth.ts";

import { CoordinatorSyncGateway } from "./core/syncGateway.ts";

import { createProtocolRouter, protocolErrors } from "./api/protocol.ts";

import { ProtocolError } from "./core/protocolError.ts";

export interface ServerOptions {
  authenticate?: boolean;
  allowedOrigins?: string[];
  sseReplay?: boolean;
  execution?: ExecutionConfiguration;
  patchCompletionMode?: "legacy_decision" | "verified_application";
}

export interface ServerInstance {
  app: Express;

  db: CoordinatorDatabase;

  coordinator: CoordinatorService;

  auth: AuthenticationService;

  gateway: CoordinatorSyncGateway;

  jobs?: ExecutionJobService;

  syncEngine: SyncEngine;

  frontendController: FrontendController;
}

export function createServer(
  dbPath?: string,
  options: ServerOptions = {},
): ServerInstance {
  const resolvedDbPath =
    dbPath || path.resolve(process.cwd(), "data", "upside_down.db");

  const db = new CoordinatorDatabase(resolvedDbPath);

  const coordinator = new CoordinatorService(db, {
    patchCompletionMode: options.patchCompletionMode,
  });

  const auth = new AuthenticationService(db);

  const gateway = new CoordinatorSyncGateway(db, coordinator, auth);

  const jobs = options.execution
    ? new ExecutionJobService(db, coordinator, auth, options.execution)
    : undefined;

  const syncEngine = new SyncEngine(db, coordinator);

  const frontendController = new FrontendController();

  const app: Express = express();

  if (options.authenticate) {
    app.use(
      cors({
        origin: (origin, done) => {
          if (!origin || options.allowedOrigins?.includes(origin))
            done(null, origin ?? false);
          else
            done(
              new ProtocolError(
                403,
                "ORIGIN_FORBIDDEN",
                "Origin is not allowed",
              ),
            );
        },
        allowedHeaders: [
          "Authorization",
          "Content-Type",
          "X-UD-Contract",
          "Idempotency-Key",
          "Last-Event-ID",
        ],
      }),
    );
  } else app.use(cors());

  if (options.authenticate) app.use("/api", auth.middleware());

  // Authenticate outside B's error boundary so credential failures retain A's safe status.

  app.use(
    "/api/sync",
    auth.middleware(),
    requireContract,
    createSyncRouter(adaptGateway(gateway), (_req, _res, next) => next()),
  );

  app.use(express.json({ limit: "1mb" }));

  app.use(
    "/api",
    createProtocolRouter(auth, coordinator, db, {
      sseReplay: options.sseReplay,
      jobs,
    }),
  );

  app.use(
    "/api",
    createCollaborationRouter(
      coordinator,
      db,
      frontendController,
      !!options.authenticate,
    ),
  );
  // Mount API router

  app.use(
    "/api",
    createApiRouter(coordinator, { sseReplay: options.sseReplay }),
  );

  app.use(protocolErrors);

  return {
    app,
    db,
    coordinator,
    auth,
    gateway,
    jobs,
    syncEngine,
    frontendController,
  };
}

// Start standalone server when run directly

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

  const instance = createServer(process.env.UD_DB_PATH, {
    authenticate: process.env.UD_ALLOW_LEGACY !== "1",

    execution: process.env.UD_WORKSPACE_CONFIG
      ? JSON.parse(fs.readFileSync(process.env.UD_WORKSPACE_CONFIG, "utf8"))
      : undefined,

    patchCompletionMode:
      process.env.UD_PATCH_COMPLETION_MODE === "legacy_decision"
        ? "legacy_decision"
        : "verified_application",

    allowedOrigins: process.env.UD_ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    sseReplay: true,
  });

  const { app } = instance;

  const host = process.env.UD_HOST ?? "127.0.0.1";

  await instance.jobs?.recover();

  instance.jobs?.kick();

  const server = app.listen(PORT, host, () => {
    const address = server.address();

    const listeningPort =
      typeof address === "object" && address ? address.port : PORT;

    console.log(
      `[Upside-Down Coordinator] Server listening on http://${host}:${listeningPort}`,
    );

    console.log(
      `[Upside-Down Coordinator] UD-IC/1.0 coordinator active`,
    );

    console.log(`[Upside-Down Coordinator] Endpoints:`);

    console.log(`  - Health:     GET  http://localhost:${PORT}/api/health`);

    console.log(`  - Tasks:      GET  http://localhost:${PORT}/api/tasks`);

    console.log(
      `  - SSE Stream: GET  http://localhost:${PORT}/api/events/stream`,
    );
  });

  const shutdown = () => {
    server.closeAllConnections();

    server.close(() => {
      void (async () => {
        await instance.jobs?.shutdown();
        instance.db.close();
      })();
    });
  };

  process.on("message", (message) => {
    if (message === "upside-down:shutdown") {
      process.disconnect?.();
      shutdown();
    }
  });

  process.once("SIGINT", shutdown);

  process.once("SIGTERM", shutdown);

  server.once("error", (error) => {
    console.error("Coordinator listen failed:", error.message);
    void (async () => {
      await instance.jobs?.shutdown();
      instance.db.close();
      process.exitCode = 1;
    })();
  });
}
