import { Router } from "express";
import { IdempotencyStore } from "../core/idempotency.ts";
import { ProtocolError } from "../core/protocolError.ts";
import type { CoordinatorService } from "../core/coordinator.ts";
import type { CoordinatorDatabase } from "../db/database.ts";
import type { FrontendController } from "../core/frontendController.ts";
import { requireContract } from "./protocol.ts";

/** Existing prototype collaboration extensions, kept separate from canonical sync commands. */
export function createCollaborationRouter(
  coordinator: CoordinatorService,
  db: CoordinatorDatabase,
  frontend: FrontendController,
  authenticate: boolean,
) {
  const router = Router(),
    keys = new IdempotencyStore(db);
  if (authenticate)
    router.use((req, res, next) => {
      if (
        /^\/(projects|handoffs)(\/|$)|^\/frontend\/status$|^\/agents\/register$/.test(
          req.path,
        )
      )
        requireContract(req, res, next);
      else next();
    });
  function object(
    input: unknown,
    allowed: string[],
  ): asserts input is Record<string, any> {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.includes(key))
    )
      throw new ProtocolError(
        400,
        "INVALID_BODY",
        "Unexpected or malformed collaboration fields",
      );
  }
  function text(input: unknown, max: number, required = true) {
    if (input === undefined && !required) return;
    if (
      typeof input !== "string" ||
      input.length > max ||
      (required && !input.trim())
    )
      throw new ProtocolError(
        422,
        "INVALID_INPUT",
        "Invalid collaboration text length",
      );
  }
  function uuid(value: unknown) {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new ProtocolError(422, "INVALID_UUID", "Expected a UUIDv4");
  }
  function write(req: any, route: string, operation: () => unknown) {
    const key = req.get("Idempotency-Key");
    if (authenticate && !key)
      throw new ProtocolError(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key is required",
      );
    return keys.execute(
      `${req.principal?.id ?? "legacy"}:POST:${route}`,
      key,
      req.body,
      operation,
    );
  }
  router.get("/projects", (_req, res, next) => {
    try {
      res.json(coordinator.listProjects());
    } catch (error) {
      next(error);
    }
  });
  router.get("/projects/:id", (req, res, next) => {
    try {
      res.json(coordinator.getProject(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/projects", (req, res, next) => {
    try {
      object(req.body, ["id", "name", "description"]);
      text(req.body.name, 200);
      text(req.body.description, 16384, false);
      if (req.body.id !== undefined) uuid(req.body.id);
      res
        .status(201)
        .json(
          write(req, "projects", () =>
            coordinator.createProject(req.body, req.principal?.id ?? "api"),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
  router.get("/handoffs", (req, res, next) => {
    try {
      if (
        Object.keys(req.query).some(
          (key) => !["toAgent", "taskId"].includes(key),
        )
      )
        throw new ProtocolError(
          400,
          "INVALID_QUERY",
          "Unsupported handoff query",
        );
      if (req.query.toAgent !== undefined) text(req.query.toAgent, 200);
      if (req.query.taskId !== undefined) uuid(req.query.taskId);
      res.json(
        coordinator.listHandoffs(
          req.query.toAgent as string | undefined,
          req.query.taskId as string | undefined,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/handoffs", (req, res, next) => {
    try {
      object(req.body, [
        "fromAgent",
        "toAgent",
        "taskId",
        "dependentTaskId",
        "handoffType",
        "summary",
        "payload",
      ]);
      text(req.body.fromAgent, 200);
      text(req.body.toAgent, 200);
      text(req.body.summary, 2048);
      for (const field of ["taskId", "dependentTaskId"])
        if (req.body[field] !== undefined) uuid(req.body[field]);
      if (
        req.body.handoffType !== undefined &&
        ![
          "task_completed",
          "review_requested",
          "blocked_dependency",
          "context_sharing",
        ].includes(req.body.handoffType)
      )
        throw new ProtocolError(
          422,
          "INVALID_HANDOFF_TYPE",
          "Unsupported handoff type",
        );
      if (
        req.body.payload !== undefined &&
        (!req.body.payload ||
          typeof req.body.payload !== "object" ||
          Array.isArray(req.body.payload) ||
          Buffer.byteLength(JSON.stringify(req.body.payload)) > 32768)
      )
        throw new ProtocolError(
          422,
          "INVALID_PAYLOAD",
          "Handoff payload must be an object of at most 32768 bytes",
        );
      if (authenticate) {
        const agents = coordinator.listAgents();
        if (
          !agents.some((agent) => agent.id === req.body.fromAgent) ||
          !agents.some((agent) => agent.id === req.body.toAgent)
        )
          throw new ProtocolError(
            422,
            "UNKNOWN_AGENT",
            "Handoff agents must be registered",
          );
        const owner = db.readRecord<string>("agent_owners", req.body.fromAgent);
        if (
          req.principal!.role === "device" &&
          owner !== req.principal!.deviceId
        )
          throw new ProtocolError(
            403,
            "AGENT_OWNERSHIP",
            "Device does not own the sending agent",
          );
        const ackId = req.body.payload?.ackFor;
        if (ackId !== undefined) {
          uuid(ackId);
          const source = coordinator
            .listHandoffs()
            .find((handoff) => handoff.id === ackId);
          if (
            !source ||
            source.toAgent !== req.body.fromAgent ||
            source.fromAgent !== req.body.toAgent ||
            source.taskId !== req.body.taskId
          )
            throw new ProtocolError(
              422,
              "INVALID_ACK",
              "Acknowledgement must reverse the original handoff and task association",
            );
        }
      }
      res.status(201).json(
        write(req, "handoffs", () => {
          const acknowledgement = req.body.payload?.ackFor;
          if (acknowledgement) {
            const prior = coordinator
              .listHandoffs()
              .find((handoff) => handoff.payload.ackFor === acknowledgement);
            if (prior) return prior;
          }
          return coordinator.recordHandoff(req.body, req.principal?.id);
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/agents/register", (req, res, next) => {
    if (!authenticate) {
      next();
      return;
    }
    try {
      object(req.body, [
        "id",
        "name",
        "status",
        "runtimeAvailable",
        "currentTaskId",
        "lastSeenAt",
      ]);
      const agent = req.body;
      text(agent.id, 200);
      text(agent.name, 200);
      const owner = db.readRecord<string>("agent_owners", agent.id);
      if (
        req.principal!.role === "device" &&
        ((owner && owner !== req.principal!.deviceId) ||
          (!owner &&
            coordinator
              .listAgents()
              .some((existing) => existing.id === agent.id)))
      )
        throw new ProtocolError(
          403,
          "AGENT_OWNERSHIP",
          "Agent belongs to another device",
        );
      db.transaction(() => {
        coordinator.registerAgent({
          ...agent,
          id: agent.id,
          name: agent.name,
          status: agent.status ?? "idle",
          runtimeAvailable: agent.runtimeAvailable ?? false,
          lastSeenAt: new Date().toISOString(),
        });
        db.putRecord("agent_owners", agent.id, req.principal!.deviceId);
      });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  router.get("/frontend/status", (_req, res, next) => {
    try {
      res.json(frontend.getStatus());
    } catch (error) {
      next(error);
    }
  });
  return router;
}
