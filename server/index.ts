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
import { createGitHubRuntime } from "./core/github/runtime.ts";
import { createGitHubRouter } from "./api/githubRoutes.ts";
import { HackathonRepository } from "./db/hackathonRepository.ts";

export interface ServerInstance {
  app: Express;
  db: CoordinatorDatabase;
  coordinator: CoordinatorService;
  syncEngine: SyncEngine;
  frontendController: FrontendController;
  executionPipeline: ExecutionPipeline;
  authManager: AuthManager;
  auth?: AuthManager;
  jobs?: ExecutionPipeline;
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

  const hackathonRepo = new HackathonRepository(db.getRawDb());
  if (!hackathonRepo.getProject("proj-upside-down")) {
    hackathonRepo.createProject({
      id: "proj-upside-down",
      name: "Upside-Down Collaboration Platform",
      problemStatement: "Hackathon teams struggle with uncoordinated multi-agent coding assistants, leading to merge conflicts and lost time.",
      rules: "24-Hour Hackathon MVP. Open Source Stack.",
      availableTime: "24h",
      developerCount: 3,
      skillLevels: "Senior AI Developers",
      technologies: ["React 19", "Express", "SQLite", "TypeScript"],
      budgetConstraints: "Zero budget / free tier only",
      judgingCriteria: "Multi-agent coordination, real-world utility, polish",
      status: "ideation",
      hostId: "host-host",
    });
  }

  const app: Express = express();
  app.use(cors());
  app.use(express.json({limit: "1mb", verify: (req, _res, buffer) => {
    if (req.url === "/api/github/webhook") (req as any).githubRaw = Buffer.from(buffer);
  }}));
  const github = createGitHubRuntime(dbPath === ":memory:");
  app.use("/api/github", createGitHubRouter(github.service, new HackathonRepository(db.getRawDb()), github.pairingKey,
    (process.env.UD_GITHUB_ALLOWED_ORIGINS ?? "http://127.0.0.1:5180,http://127.0.0.1:5173,http://localhost:5180,http://localhost:5173").split(","), process.env.UD_GITHUB_WEBHOOK_SECRET));


  // Mount API router
  app.use("/api", createApiRouter(coordinator, syncEngine, frontendController, authManager, id => github.service.workspaces().some(item => item.workspace.projectId === id)));

  // Serve active Frontend assets
  // Support dev pairing key endpoint on port 4000
  app.get("/dev-pairing-key", (_req, res) => {
    try {
      const candidates = [
        process.env.UD_DEVICE_DB ? `${process.env.UD_DEVICE_DB}.session.json` : "",
        path.resolve(process.cwd(), "client-local/data/device-b.db.session.json"),
        path.resolve(process.cwd(), "client-local/data/device.db.session.json"),
        path.resolve(process.env.LOCALAPPDATA || "", "UpsideDown/computer-2/device.db.session.json"),
        path.resolve(process.env.LOCALAPPDATA || "", "UpsideDown/device.db.session.json"),
      ].filter(Boolean);
      for (const file of candidates) {
        if (fs.existsSync(file)) {
          const data = fs.readFileSync(file, "utf8");
          res.setHeader("Content-Type", "application/json");
          res.send(data);
          return;
        }
      }
    } catch {
      // ignore
    }
    res.status(404).json({ error: "Session key not found" });
  });

  // Forward /local requests to client-local service (port 4100)
  app.all("/local*", async (req, res) => {
    try {
      const localPort = process.env.UD_LOCAL_PORT ?? "4100";
      const targetUrl = `http://127.0.0.1:${localPort}${req.url}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string" && k.toLowerCase() !== "host") {
          headers[k] = v;
        }
      }
      headers["origin"] = headers["origin"] || `http://127.0.0.1:4000`;
      const fetchOpts: RequestInit = {
        method: req.method,
        headers,
      };
      if (!["GET", "HEAD"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        fetchOpts.body = JSON.stringify(req.body);
      }
      const resp = await fetch(targetUrl, fetchOpts);
      res.status(resp.status);
      resp.headers.forEach((v, k) => {
        if (!["content-encoding", "transfer-encoding"].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      const data = await resp.arrayBuffer();
      res.send(Buffer.from(data));
    } catch (err) {
      res.status(502).json({ error: "Client-local service unreachable", details: String(err) });
    }
  });

  // Serve active Frontend assets dynamically
  app.use((req, res, next) => {
    const activePublicDir = frontendController.getActivePublicDir();
    express.static(activePublicDir)(req, res, next);
  });

  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/local") || req.path.startsWith("/dev-pairing-key")) return next();
    const htmlPath = path.join(frontendController.getActivePublicDir(), "index.html");
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.sendFile(path.join(process.cwd(), "public", "index.html"));
    }
  });

  return {
    app,
    db,
    coordinator,
    syncEngine,
    frontendController,
    executionPipeline,
    authManager,
    auth: authManager,
    jobs: executionPipeline,
  };
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
