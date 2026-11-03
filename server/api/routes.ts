import type { FrontendController } from "../core/frontendController.ts";
import type { ActivityEvent, CanonicalEvent } from "../../contracts/events.ts";
import { randomUUID } from "node:crypto";
/**
 * REST API Routes & SSE Stream
 * Role 1 — Core Backend & Coordinator / Baseline: UD-IC/1.0
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import {
  CoordinatorService,
  ConflictError,
  ValidationError,
  NotFoundError,
} from "../core/coordinator.ts";
import type { TaskStatus } from "../../contracts/task.ts";
import type { SyncEngine } from "../sync/syncEngine.ts";
import type { SyncEvent } from "../../contracts/sync.ts";
import type { Principal } from "../core/syncGateway.ts";

export function createApiRouter(
  coordinator: CoordinatorService,
  syncEngine?: SyncEngine,
  frontendController?: FrontendController
): Router {
  const router = Router();

  // --- Health Check ---
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      role: "Role 1: Core Backend & Coordinator",
      protocolVersion: "1.0",
      activeSubscribers: coordinator.getSubscriberCount(),
    });
  });

  // --- Capabilities (UD-IC/1.0 Section 6) ---
  router.get("/capabilities", (_req: Request, res: Response) => {
    res.setHeader("X-UD-Contract", "UD-IC/1.0");
    res.json(coordinator.getCapabilities());
  });

  // --- Project Endpoints ---

  router.get("/projects", (_req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = coordinator.listProjects();
      res.json(projects);
    } catch (err) {
      next(err);
    }
  });

  router.post("/projects", (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = coordinator.createProject(req.body, "api");
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = coordinator.getProject(String(req.params.id));
      res.json(project);
    } catch (err) {
      next(err);
    }
  });

  // --- Task Endpoints ---

  router.get("/tasks", (req: Request, res: Response, next: NextFunction) => {
    try {
      const statusFilter = req.query.status as TaskStatus | undefined;
      const tasks = coordinator.listTasks(statusFilter);
      res.json(tasks);
    } catch (err) {
      next(err);
    }
  });

  router.post("/tasks", (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = coordinator.createTask(req.body, "api");
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  });

  router.get("/tasks/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = String(req.params.id);
      const task = coordinator.getTask(taskId);
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  router.get("/tasks/:id/patch", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = String(req.params.id);
      const patch = coordinator.getPatchByTaskId(taskId);
      if (!patch) {
        throw new NotFoundError(`No patch found for task: ${taskId}`);
      }
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  router.get("/tasks/:id/patches", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = String(req.params.id);
      const patches = coordinator.listPatchesByTaskId(taskId);
      res.json(patches);
    } catch (err) {
      next(err);
    }
  });

  router.get("/tasks/:id/checkpoints", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = String(req.params.id);
      const checkpoints = coordinator.listCheckpoints(taskId);
      res.json(checkpoints);
    } catch (err) {
      next(err);
    }
  });

  router.post("/tasks/:id/transition", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = String(req.params.id);
      const { targetStatus, baseRevision, ownerId, reason } = req.body;
      if (!targetStatus || baseRevision === undefined) {
        throw new ValidationError("targetStatus and baseRevision are required");
      }
      const updated = coordinator.transitionTask(
        taskId,
        {
          targetStatus,
          baseRevision: Number(baseRevision),
          ownerId,
          reason,
        },
        "api"
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // --- Agent Endpoints ---

  router.get("/agents", (_req: Request, res: Response, next: NextFunction) => {
    try {
      const agents = coordinator.listAgents();
      res.json(agents);
    } catch (err) {
      next(err);
    }
  });

  router.post("/agents/register", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, name, status, runtimeAvailable, currentTaskId } = req.body;
      if (!id || !name) {
        throw new ValidationError("id and name are required for agent registration");
      }
      coordinator.registerAgent({
        id,
        name,
        status: status || "idle",
        runtimeAvailable: runtimeAvailable !== undefined ? Boolean(runtimeAvailable) : true,
        currentTaskId,
        lastSeenAt: new Date().toISOString(),
      });
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // --- Event Endpoints ---

  router.get("/events", (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskId = req.query.taskId as string | undefined;
      const since = req.query.since as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const events = coordinator.listEvents(taskId, since, limit);
      res.json(events);
    } catch (err) {
      next(err);
    }
  });

  router.post("/events", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { taskId, source, type, payload } = req.body;
      if (!source || !type) {
        throw new ValidationError("source and type are required");
      }
      const event: ActivityEvent = {
        id: randomUUID(),
        taskId,
        source,
        type,
        timestamp: new Date().toISOString(),
        payload: payload || {},
      };
      coordinator.recordExternalEvent(event);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  });

  // --- Structured Handoffs ---

  router.get("/handoffs", (req: Request, res: Response, next: NextFunction) => {
    try {
      const toAgent = req.query.toAgent as string | undefined;
      const taskId = req.query.taskId as string | undefined;
      const handoffs = coordinator.listHandoffs(toAgent, taskId);
      res.json(handoffs);
    } catch (err) {
      next(err);
    }
  });

  router.post("/handoffs", (req: Request, res: Response, next: NextFunction) => {
    try {
      const handoff = coordinator.recordHandoff(req.body, req.body.fromAgent || "agent");
      res.status(201).json(handoff);
    } catch (err) {
      next(err);
    }
  });

  // --- Server-Sent Events (SSE) Stream with Durable Replay ---

  router.get("/events/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-UD-Contract", "UD-IC/1.0");
    res.flushHeaders();

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        status: "connected",
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // Replay prior events if Last-Event-ID or ?after/?cursor is supplied
    const afterCursor =
      (req.headers["last-event-id"] as string) ||
      (req.query.after as string) ||
      (req.query.cursor as string);

    if (afterCursor) {
      try {
        const replay = coordinator.getEventsReplay(afterCursor);
        for (const ev of replay.events) {
          const id = ev.cursor || ev.id;
          res.write(`id: ${id}\nevent: activity\ndata: ${JSON.stringify(ev)}\n\n`);
        }
      } catch (err: any) {
        if (err && err.code === "CURSOR_EXPIRED") {
          res.write(`event: reset\ndata: ${JSON.stringify({ reason: "CURSOR_EXPIRED" })}\n\n`);
          res.end();
          return;
        }
      }
    }

    const unsubscribe = coordinator.subscribe((event) => {
      const id = (event as any).cursor || event.id;
      res.write(`id: ${id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const pingInterval = setInterval(() => {
      res.write(": keepalive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(pingInterval);
      unsubscribe();
    });
  });

  // --- Patch Endpoints ---

  router.post("/patches", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { taskId, runId, diffContent, testOutput, patchPath, baseCommit, review } = req.body;
      if (!taskId || !runId || !diffContent) {
        throw new ValidationError("taskId, runId, and diffContent are required");
      }
      const patch = coordinator.proposePatch(
        taskId,
        runId,
        diffContent,
        testOutput,
        patchPath,
        baseCommit,
        review
      );
      res.status(201).json(patch);
    } catch (err) {
      next(err);
    }
  });

  router.get("/patches/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      const patchId = String(req.params.id);
      const patch = coordinator.getPatch(patchId);
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  router.post("/patches/:id/approve", (req: Request, res: Response, next: NextFunction) => {
    try {
      const patchId = String(req.params.id);
      const { reviewerId } = req.body;
      const patch = coordinator.approvePatch(patchId, reviewerId);
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  router.post("/patches/:id/reject", (req: Request, res: Response, next: NextFunction) => {
    try {
      const patchId = String(req.params.id);
      const { reviewerId, reason } = req.body;
      const patch = coordinator.rejectPatch(patchId, reviewerId, reason);
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  // --- Verified Application Workflow (UD-IC/1.0 Section 6 & 15) ---

  router.post("/patches/:id/apply", (req: Request, res: Response, next: NextFunction) => {
    try {
      const patchId = String(req.params.id);
      const reviewerId = (req.body?.reviewerId as string) || "lead-engineer";
      const {
        expectedTaskRevision,
        expectedBaseCommit,
        expectedDiffHash,
        targetWorkspaceId,
        testProfileId,
      } = req.body;

      if (
        expectedTaskRevision === undefined ||
        !expectedBaseCommit ||
        !expectedDiffHash
      ) {
        throw new ValidationError(
          "expectedTaskRevision, expectedBaseCommit, and expectedDiffHash are required"
        );
      }

      const appRecord = coordinator.applyPatch(
        patchId,
        {
          expectedTaskRevision: Number(expectedTaskRevision),
          expectedBaseCommit: String(expectedBaseCommit),
          expectedDiffHash: String(expectedDiffHash),
          targetWorkspaceId: targetWorkspaceId || "integration-target",
          testProfileId: testProfileId || "default-tests",
        },
        reviewerId
      );

      res.status(202).json(appRecord);
    } catch (err) {
      next(err);
    }
  });

  router.get("/applications/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = String(req.params.id);
      const appRecord = coordinator.getApplication(appId);
      res.json(appRecord);
    } catch (err) {
      next(err);
    }
  });

  // --- Canonical Gateway Endpoints (UD-IC/1.0 Section 6) ---

  router.post("/sync/push", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contractVersion, deviceId, events } = req.body;
      if (contractVersion !== "UD-IC/1.0" || !deviceId || !Array.isArray(events)) {
        throw new ValidationError(
          "Invalid push batch format. Expected contractVersion 'UD-IC/1.0', deviceId, and events array."
        );
      }

      const authHeader = req.headers.authorization;
      let principalRole: "device" | "reviewer" | "admin" = "device";
      if (req.headers["x-principal-role"] === "reviewer" || req.headers["x-principal-role"] === "admin") {
        principalRole = req.headers["x-principal-role"] as any;
      } else if (authHeader && authHeader.toLowerCase().includes("reviewer")) {
        principalRole = "reviewer";
      }

      const principal: Principal = {
        id: (req.headers["x-principal-id"] as string) || (authHeader ? authHeader.replace(/^Bearer\s+/i, "") : deviceId),
        deviceId,
        role: principalRole,
      };

      const acks = [];
      let receivedThrough = 0;

      for (const ev of events) {
        const ack = await coordinator.process(ev, principal);
        acks.push(ack);
        if (
          ack.status === "applied" ||
          ack.status === "conflict" ||
          ack.status === "rejected"
        ) {
          receivedThrough = Math.max(receivedThrough, ack.sequence);
        }
      }

      res.setHeader("X-UD-Contract", "UD-IC/1.0");
      res.json({
        contractVersion: "UD-IC/1.0",
        acks,
        receivedThrough,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/sync/pull", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const after = req.query.after as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const authHeader = req.headers.authorization;
      let principalRole: "device" | "reviewer" | "admin" = "device";
      if (req.headers["x-principal-role"] === "reviewer" || req.headers["x-principal-role"] === "admin") {
        principalRole = req.headers["x-principal-role"] as any;
      } else if (authHeader && authHeader.toLowerCase().includes("reviewer")) {
        principalRole = "reviewer";
      }
      const deviceId = (req.headers["x-device-id"] as string) || (authHeader ? authHeader.replace(/^Bearer\s+/i, "") : "anonymous-device");
      const principal: Principal = {
        id: (req.headers["x-principal-id"] as string) || deviceId,
        deviceId,
        role: principalRole,
      };

      const pullResponse = await coordinator.pull(after, limit, principal);
      res.setHeader("X-UD-Contract", "UD-IC/1.0");
      res.json(pullResponse);
    } catch (err: any) {
      if (err && err.code === "CURSOR_EXPIRED") {
        res.status(410).json({
          error: "Gone",
          code: "CURSOR_EXPIRED",
          message: err.message || "Cursor has expired",
          requestId: randomUUID(),
          retryable: false,
        });
        return;
      }
      next(err);
    }
  });

  router.get("/sync/conflicts", async (req: Request, res: Response, next: NextFunction) => {
    try {
      // If UD-IC/1.0 request
      if (
        req.headers["x-ud-contract"] === "UD-IC/1.0" ||
        req.query.contractVersion === "UD-IC/1.0"
      ) {
        const status = (req.query.status as "open" | "resolved") || "open";
        const after = req.query.after as string | undefined;
        const page = await coordinator.listConflicts(status, after);
        res.setHeader("X-UD-Contract", "UD-IC/1.0");
        res.json(page);
        return;
      }

      // Fallback to legacy syncEngine if attached
      if (syncEngine) {
        const resolvedFilter =
          req.query.resolved !== undefined
            ? req.query.resolved === "true"
            : undefined;
        res.json(syncEngine.getConflicts(resolvedFilter));
        return;
      }

      const page = await coordinator.listConflicts("open");
      res.json(page);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/sync/conflicts/:id/resolve",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const conflictId = String(req.params.id);

        if (
          req.body.expectedConflictRevision !== undefined ||
          req.headers["x-ud-contract"] === "UD-IC/1.0"
        ) {
          const authHeader = req.headers.authorization;
          let principalRole: "device" | "reviewer" | "admin" = "reviewer";
          if (req.headers["x-principal-role"] === "reviewer" || req.headers["x-principal-role"] === "admin") {
            principalRole = req.headers["x-principal-role"] as any;
          }
          const principal: Principal = {
            id: (req.headers["x-principal-id"] as string) || (authHeader ? authHeader.replace(/^Bearer\s+/i, "") : "reviewer-1"),
            deviceId: (req.headers["x-device-id"] as string) || "reviewer-device",
            role: principalRole,
          };
          const resolved = await coordinator.resolve(conflictId, req.body, principal);
          res.setHeader("X-UD-Contract", "UD-IC/1.0");
          res.json(resolved);
          return;
        }

        if (syncEngine) {
          const { resolution, customPayload } = req.body;
          if (!resolution) {
            throw new ValidationError("resolution is required");
          }
          syncEngine.resolveConflict(conflictId, resolution, customPayload);
          res.json({ status: "ok", conflictId, resolution });
          return;
        }

        throw new ValidationError("Resolution parameters invalid");
      } catch (err) {
        next(err);
      }
    }
  );

  // --- Synchronization Endpoints (Legacy Adapter) ---

  router.get("/sync/status", (_req: Request, res: Response) => {
    if (!syncEngine) {
      res.json({ enabled: false, message: "Sync engine not attached" });
      return;
    }
    const pendingOutbox = syncEngine.getPendingOutbox();
    const conflicts = syncEngine.getConflicts(false);
    res.json({
      enabled: true,
      deviceId: syncEngine.getDeviceId(),
      isOnline: syncEngine.getOnlineStatus(),
      pendingOutboxCount: pendingOutbox.length,
      unresolvedConflictsCount: conflicts.length,
    });
  });

  router.post("/sync/toggle-online", (req: Request, res: Response) => {
    if (!syncEngine) {
      res.status(400).json({ error: "Sync engine not attached" });
      return;
    }
    const online = req.body.online === undefined ? true : Boolean(req.body.online);
    syncEngine.setOnlineStatus(online);
    res.json({
      status: "ok",
      isOnline: syncEngine.getOnlineStatus(),
    });
  });

  router.get("/sync/outbox", (_req: Request, res: Response) => {
    if (!syncEngine) {
      res.json([]);
      return;
    }
    res.json(syncEngine.getPendingOutbox());
  });

  router.post("/sync/flush", async (_req: Request, res: Response, next: NextFunction) => {
    if (!syncEngine) {
      res.status(400).json({ error: "Sync engine not attached" });
      return;
    }
    try {
      const result = await syncEngine.flushOutbox();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sync/events", (req: Request, res: Response, next: NextFunction) => {
    if (!syncEngine) {
      res.status(400).json({ error: "Sync engine not attached" });
      return;
    }
    try {
      const event = req.body as SyncEvent;
      if (!event.eventId || !event.deviceId || !event.type) {
        throw new ValidationError("eventId, deviceId, and type are required for sync events");
      }
      const result = syncEngine.ingestIncomingEvent(event);
      res.status(result.status === "conflict" ? 409 : 200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- Frontend Replacement / Handoff Endpoints ---

  router.get("/frontend/status", (_req: Request, res: Response) => {
    if (!frontendController) {
      res.json({ error: "Frontend controller not attached" });
      return;
    }
    res.json(frontendController.getStatus());
  });

  router.post("/frontend/activate", (req: Request, res: Response, next: NextFunction) => {
    if (!frontendController) {
      res.status(400).json({ error: "Frontend controller not attached" });
      return;
    }
    try {
      const candidatePath = req.body?.candidatePath as string | undefined;
      const result = frontendController.activateTeamFrontend(candidatePath);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/frontend/rollback", (_req: Request, res: Response, next: NextFunction) => {
    if (!frontendController) {
      res.status(400).json({ error: "Frontend controller not attached" });
      return;
    }
    try {
      const result = frontendController.rollbackFrontend();
      res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
      next(err);
    }
  });

  // --- Centralized Error Handling ---

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ConflictError) {
      res.status(409).json({
        error: "Conflict",
        message: err.message,
        currentRevision: err.currentRevision,
        baseRevision: err.baseRevision,
      });
      return;
    }

    if (err instanceof ValidationError) {
      res.status(400).json({
        error: "Bad Request",
        message: err.message,
      });
      return;
    }

    if (err instanceof NotFoundError) {
      res.status(404).json({
        error: "Not Found",
        message: err.message,
      });
      return;
    }

    console.error("Unhandled API error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return router;
}
