/**
 * REST API Routes & SSE Stream
 * Role 1 — Core Backend & Coordinator
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import {
  CoordinatorService,
  ConflictError,
  ValidationError,
  NotFoundError,
} from "../core/coordinator.ts";
import type { TaskStatus } from "../../contracts/task.ts";
import { streamReplay, type ReplayOptions } from "./eventStream.ts";
import { canReadEvent } from "../core/auth.ts";
import { ProtocolError } from "../core/protocolError.ts";

export function createApiRouter(coordinator: CoordinatorService, options: ReplayOptions = {}): Router {
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
      res.json(req.principal ? events.filter((event) => canReadEvent(event, req.principal!)) : events);
    } catch (err) {
      next(err);
    }
  });

  // --- Server-Sent Events (SSE) Stream ---

  router.get("/events/stream", (req: Request, res: Response) => {
    if (options.sseReplay) {
      streamReplay(req, res, coordinator, { ...options,
        ...(req.principal ? { canReadEvent: (event) => canReadEvent(event, req.principal!) } : {}) });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: new Date().toISOString() })}\n\n`);

    const unsubscribe = coordinator.subscribe((event) => {
      if (req.principal && !canReadEvent(event, req.principal)) return;
      res.write(`id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
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
      const { taskId, runId, diffContent, testOutput, patchPath } = req.body;
      if (!taskId || !runId || !diffContent) {
        throw new ValidationError("taskId, runId, and diffContent are required");
      }
      const patch = coordinator.proposePatch(taskId, runId, diffContent, testOutput, patchPath);
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
      if (req.principal?.role === "device") throw new ProtocolError(403, "REVIEWER_REQUIRED", "A separate reviewer credential is required");
      const patchId = String(req.params.id);
      const { reviewerId } = req.body;
      const patch = coordinator.approvePatch(patchId, req.principal?.id ?? reviewerId);
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  router.post("/patches/:id/reject", (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.principal?.role === "device") throw new ProtocolError(403, "REVIEWER_REQUIRED", "A separate reviewer credential is required");
      const patchId = String(req.params.id);
      const { reviewerId, reason } = req.body;
      const patch = coordinator.rejectPatch(patchId, req.principal?.id ?? reviewerId, reason);
      res.json(patch);
    } catch (err) {
      next(err);
    }
  });

  // --- Centralized Error Handling ---

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (_req.principal && !(err instanceof ConflictError) && !(err instanceof ValidationError) && !(err instanceof NotFoundError)) { _next(err); return; }
    if (err instanceof ProtocolError) { res.status(err.status).json(err.body()); return; }
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
