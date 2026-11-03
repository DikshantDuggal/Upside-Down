import { Router, type RequestHandler, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import type { AuthenticationService } from "../core/auth.ts";
import { ConflictError, NotFoundError, ValidationError, type CoordinatorService } from "../core/coordinator.ts";
import type { CoordinatorDatabase } from "../db/database.ts";
import { CursorExpiredError } from "../db/database.ts";
import { INTEGRATION_CONTRACT, ProtocolError } from "../core/protocolError.ts";
import { requestIdentity } from "../core/idempotency.ts";
import { IdempotencyStore } from "../core/idempotency.ts";
import type { ExecutionJobService } from "../agents/jobService.ts";

export const requireContract: RequestHandler = (req, res, next) => {
  res.setHeader("X-UD-Contract", INTEGRATION_CONTRACT);
  if (req.get("X-UD-Contract") !== INTEGRATION_CONTRACT) {
    next(new ProtocolError(426, "CONTRACT_VERSION", "X-UD-Contract: UD-IC/1.0 is required")); return;
  }
  requestIdentity.run({ key: req.get("Idempotency-Key") }, next);
};

export function createProtocolRouter(auth: AuthenticationService, coordinator: CoordinatorService, db: CoordinatorDatabase, options: { sseReplay?: boolean; jobs?: ExecutionJobService } = {}) {
  const router = Router();
  const guard = [requireContract, auth.middleware()];
  router.get("/capabilities", ...guard, (_req, res) => {
    res.json({ contractVersion: INTEGRATION_CONTRACT,
      features: { sync: true, sseReplay: !!options.sseReplay, execution: !!options.jobs,
        patchApply: !!options.jobs && coordinator.patchCompletionMode === "verified_application", checkpointMetadata: !!options.jobs },
      patchCompletionMode: coordinator.patchCompletionMode,
      authorization: { role: _req.principal!.role, canReview: _req.principal!.role !== "device" } });
  });
  router.get("/tasks/:id/patches", ...guard, (req, res, next) => {
    try { coordinator.getTask(String(req.params.id)); res.json(db.listPatches(String(req.params.id))); }
    catch (error) { next(error); }
  });
  router.get("/tasks/:id/checkpoints", ...guard, (req, res, next) => {
    try {
      coordinator.getTask(String(req.params.id));
      // Real persisted records only; no synthetic model state or resume claims.
      res.json(db.listRecords<any>("checkpoints").map((row) => row.value).filter((value) => value.taskId === req.params.id));
    } catch (error) { next(error); }
  });
  const jobs = () => {
    if (!options.jobs) throw new ProtocolError(503, "EXECUTION_UNAVAILABLE", "No trusted workspace/test configuration is installed");
    return options.jobs;
  };
  router.post("/tasks/:id/runs", ...guard, (req, res, next) => {
    try {
      const worker = jobs(); auth.requireReviewer(req.principal!);
      const run = worker.enqueueRun(String(req.params.id), req.body, req.principal!, req.get("Idempotency-Key") ?? "");
      res.status(202).json(run); worker.kick();
    } catch (error) { next(error); }
  });
  router.get("/runs/:id", ...guard, (req, res, next) => {
    try { res.json(jobs().getRun(String(req.params.id))); } catch (error) { next(error); }
  });
  router.post("/runs/:id/cancel", ...guard, (req, res, next) => {
    try {
      auth.requireReviewer(req.principal!);
      if (!req.body || Object.keys(req.body).some((key) => key !== "reason")) throw new ProtocolError(400, "INVALID_CANCELLATION", "Expected a cancellation reason");
      res.json(jobs().cancelRun(String(req.params.id), req.body.reason, req.principal!, req.get("Idempotency-Key") ?? ""));
    } catch (error) { next(error); }
  });
  router.post("/patches/:id/apply", ...guard, (req, res, next) => {
    try {
      const worker = jobs();
      const application = worker.enqueueApplication(String(req.params.id), req.body, req.principal!, req.get("Idempotency-Key") ?? "");
      res.status(202).json(application); worker.kick();
    } catch (error) { next(error); }
  });
  router.get("/applications/:id", ...guard, (req, res, next) => {
    try { res.json(jobs().getApplication(String(req.params.id))); } catch (error) { next(error); }
  });
  for (const decision of ["approve", "reject"] as const) {
    router.post(`/patches/:id/${decision}`, (req, _res, next) => {
      // Preserve the explicitly selected unauthenticated legacy embedding API.
      if (!req.principal && coordinator.patchCompletionMode === "legacy_decision") next("route"); else next();
    }, ...guard, (req, res, next) => {
      try {
        auth.requireReviewer(req.principal!);
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["reviewerId", "reason", "expectedTaskRevision", "expectedDiffHash"].includes(key))) throw new ProtocolError(400, "INVALID_DECISION", "Malformed patch decision");
        const key = req.get("Idempotency-Key");
        if (!key) throw new ProtocolError(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key is required");
        const patch = new IdempotencyStore(db).execute(`${req.principal!.id}:POST:patches/${req.params.id}/${decision}`, key, body, () => {
          const current = coordinator.getPatch(String(req.params.id));
          if ((body.expectedTaskRevision !== undefined && body.expectedTaskRevision !== coordinator.getTask(current.taskId).revision)
              || (body.expectedDiffHash !== undefined && body.expectedDiffHash !== current.diffHash)) throw new ProtocolError(409, "STALE_PATCH", "Patch identity or task revision changed");
          return decision === "approve" ? coordinator.approvePatch(current.id, req.principal!.id)
            : coordinator.rejectPatch(current.id, req.principal!.id, body.reason);
        });
        res.json(patch);
      } catch (error) { next(error); }
    });
  }
  return router;
}

export const protocolErrors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) { res.end(); return; }
  res.setHeader("X-UD-Contract", INTEGRATION_CONTRACT);
  if (error instanceof CursorExpiredError) error = new ProtocolError(410, "CURSOR_EXPIRED", error.message);
  if (error instanceof NotFoundError) error = new ProtocolError(404, "NOT_FOUND", "Requested resource was not found");
  if (error instanceof ConflictError) error = new ProtocolError(409, "STALE_REVISION", "Task revision changed", { currentRevision: error.currentRevision, baseRevision: error.baseRevision });
  if (error instanceof ValidationError) error = new ProtocolError(422, "INVALID_INPUT", error.message);
  if (!(error instanceof ProtocolError)) {
    const status = Number(error?.status);
    const busy = /(?:database is locked|SQLITE_BUSY)/i.test(String(error?.message));
    error = busy ? new ProtocolError(503, "STORAGE_BUSY", "Coordinator storage is busy", { retryAfterMs: 1000 }, true)
      : status === 413 ? new ProtocolError(413, "PAYLOAD_TOO_LARGE", "Request exceeds the configured limit")
      : status === 400 ? new ProtocolError(400, "INVALID_JSON", "Malformed JSON request")
      : new ProtocolError(500, "INTERNAL_ERROR", "Coordinator request failed");
  }
  const failure = error as ProtocolError;
  if (failure.retryable) res.setHeader("Retry-After", "1");
  res.status(failure.status).json(failure.body(randomUUID()));
};
