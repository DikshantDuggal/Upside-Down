/**
 * Task and Event Coordinator Service
 * Role 1 — Core Backend & Coordinator
 */

import type { Project, ProjectCreateRequest } from "../../contracts/project.ts";
import type {
  StructuredHandoff,
  HandoffCreateRequest,
} from "../../contracts/handoff.ts";
import { randomUUID, createHash } from "node:crypto";
import { CoordinatorDatabase, type PatchRecord } from "../db/database.ts";
import type {
  Task,
  TaskStatus,
  TaskCreateRequest,
  TaskTransitionRequest,
} from "../../contracts/task.ts";
import type {
  ActivityEvent,
  EventCallback,
  EventPage,
} from "../../contracts/events.ts";
import type { AgentInfo } from "../../contracts/agent.ts";

export class ConflictError extends Error {
  public currentRevision: number;
  public baseRevision: number;

  constructor(message: string, currentRevision: number, baseRevision: number) {
    super(message);
    this.name = "ConflictError";
    this.currentRevision = currentRevision;
    this.baseRevision = baseRevision;
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class CoordinatorService {
  private db: CoordinatorDatabase;
  private subscribers: Set<EventCallback> = new Set();
  private broadcastCursor: string;
  private broadcasting = false;
  readonly patchCompletionMode: "legacy_decision" | "verified_application";
  private verifiedCompletion = false;

  private static readonly VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> =
    {
      pending: ["assigned", "blocked", "running"],
      assigned: ["running", "blocked", "pending"],
      running: ["review", "failed", "blocked"],
      review: ["done", "running", "failed"],
      blocked: ["pending", "assigned", "running"],
      failed: ["pending", "running"],
      done: [],
    };

  constructor(
    db: CoordinatorDatabase,
    options: {
      patchCompletionMode?: "legacy_decision" | "verified_application";
    } = {},
  ) {
    this.db = db;
    this.patchCompletionMode = options.patchCompletionMode ?? "legacy_decision";
    this.broadcastCursor = db.latestEventCursor();
  }

  // --- SSE Subscription Management ---

  public subscribe(callback: EventCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public getSubscriberCount(): number {
    return this.subscribers.size;
  }

  public recordExternalEvent(event: ActivityEvent): void {
    this.publishEvent(event);
  }

  private publishEvent(event: ActivityEvent): void {
    if (this.db.saveEvent(event)) {
      this.db.afterCommit(() => this.flushCommittedEvents());
    }
  }

  private flushCommittedEvents(): void {
    if (this.broadcasting) return;
    this.broadcasting = true;
    try {
      // Read committed journal order, including all events in a compound command.
      // Reentrant commands are drained after earlier committed rows, never ahead.
      for (;;) {
        const page = this.db.listCanonicalEvents(this.broadcastCursor, 200);
        if (page.events.length === 0) break;
        for (const event of page.events) {
          this.broadcastCursor = event.cursor;
          for (const callback of [...this.subscribers]) {
            try {
              callback(structuredClone(event));
            } catch {
              console.error("SSE subscriber failed; event remains persisted");
            }
          }
        }
      }
    } finally {
      this.broadcasting = false;
    }
  }

  public replayEvents(after?: string, limit = 100): EventPage {
    return this.db.listCanonicalEvents(after, limit);
  }

  public getEventCursor(id: string): string {
    return this.db.eventCursor(id);
  }
  public getLatestEventCursor(): string {
    return this.db.latestEventCursor();
  }

  // --- Task Lifecycle ---

  public createTask(
    req: TaskCreateRequest,
    source: string = "api",
    requestedId?: string,
  ): Task {
    return this.db.transaction(() => {
      if (
        !req ||
        typeof req.title !== "string" ||
        req.title.trim().length === 0 ||
        req.title.trim().length > 200
      ) {
        throw new ValidationError("Task title is required");
      }
      this.validateOptionalText(req.description, "description", 16384);
      this.validateOptionalText(req.ownerId, "ownerId", 200);

      const now = new Date().toISOString();
      const task: Task = {
        id: requestedId ?? randomUUID(),
        title: req.title.trim(),
        description: req.description?.trim(),
        status: "pending",
        ownerId: req.ownerId?.trim(),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };

      this.db.saveTask(task);

      this.publishEvent({
        id: randomUUID(),
        taskId: task.id,
        source,
        type: "task_created",
        timestamp: now,
        payload: {
          title: task.title,
          status: task.status,
          revision: task.revision,
          ownerId: task.ownerId,
          task,
        },
      });

      return task;
    });
  }

  public getTask(id: string): Task {
    const task = this.db.getTask(id);
    if (!task) {
      throw new NotFoundError(`Task not found: ${id}`);
    }
    return task;
  }

  public listTasks(statusFilter?: TaskStatus): Task[] {
    return this.db.listTasks(statusFilter);
  }

  public transitionTask(
    id: string,
    req: TaskTransitionRequest,
    source: string = "api",
  ): Task {
    return this.db.transaction(() => {
      if (
        !req ||
        !Number.isSafeInteger(req.baseRevision) ||
        req.baseRevision < 1
      ) {
        throw new ValidationError(
          "baseRevision must be a positive safe integer",
        );
      }
      this.validateOptionalText(req.ownerId, "ownerId", 200);
      this.validateOptionalText(req.reason, "reason", 2048);
      const current = this.getTask(id);
      if (
        this.patchCompletionMode === "verified_application" &&
        req.targetStatus === "done" &&
        !this.verifiedCompletion
      ) {
        throw new ValidationError(
          "Only a verified application job may complete this task",
        );
      }
      if (
        this.db.readRecord("application_task_locks", id) &&
        !this.verifiedCompletion
      ) {
        throw new ValidationError(
          "Task is locked by a controlled application job",
        );
      }

      if (req.baseRevision !== current.revision) {
        throw new ConflictError(
          `Stale task revision: provided ${req.baseRevision}, current is ${current.revision}`,
          current.revision,
          req.baseRevision,
        );
      }

      const allowed = CoordinatorService.VALID_TRANSITIONS[current.status];
      if (!allowed || !allowed.includes(req.targetStatus)) {
        throw new ValidationError(
          `Invalid task state transition from '${current.status}' to '${req.targetStatus}'. Allowed: [${(allowed || []).join(", ")}]`,
        );
      }

      const updateResult = this.db.updateTaskWithRevision(
        id,
        req.targetStatus,
        req.baseRevision,
        req.ownerId,
      );

      if (!updateResult.success || !updateResult.task) {
        throw new ConflictError(
          `Concurrent update conflict on task ${id}`,
          updateResult.currentRevision || current.revision,
          req.baseRevision,
        );
      }

      const updatedTask = updateResult.task;

      this.publishEvent({
        id: randomUUID(),
        taskId: updatedTask.id,
        source,
        type: "task_transitioned",
        timestamp: updatedTask.updatedAt,
        payload: {
          from: current.status,
          to: updatedTask.status,
          revision: updatedTask.revision,
          ownerId: updatedTask.ownerId,
          reason: req.reason,
          task: updatedTask,
        },
      });

      return updatedTask;
    });
  }

  // --- Events API ---

  public listEvents(
    taskId?: string,
    since?: string,
    limit: number = 100,
  ): ActivityEvent[] {
    return this.db.listEvents(taskId, since, limit);
  }

  // --- Agent Registry ---

  public registerAgent(agent: AgentInfo): void {
    return this.db.transaction(() => {
      this.db.upsertAgent(agent);
      this.publishEvent({
        id: randomUUID(),
        taskId: agent.currentTaskId,
        source: "agent_registry",
        type: "agent_heartbeat",
        timestamp: agent.lastSeenAt,
        payload: {
          agentId: agent.id,
          name: agent.name,
          status: agent.status,
          runtimeAvailable: agent.runtimeAvailable,
          currentTaskId: agent.currentTaskId,
          agent,
        },
      });
    });
  }

  public listAgents(): AgentInfo[] {
    return this.db.listAgents();
  }

  // --- Patch Coordination ---

  public proposePatch(
    taskId: string,
    runId: string,
    diffContent: string,
    testOutput?: string,
    patchPath?: string,
    expectedTaskRevision?: number,
    metadata?: Pick<
      PatchRecord,
      "baseCommit" | "diffHash" | "review" | "evidence"
    >,
  ): PatchRecord {
    return this.db.transaction(() => {
      const task = this.getTask(taskId);
      if (
        expectedTaskRevision !== undefined &&
        task.revision !== expectedTaskRevision
      ) {
        throw new ConflictError(
          "Repair run no longer owns this task revision",
          task.revision,
          expectedTaskRevision,
        );
      }

      const now = new Date().toISOString();
      const patch: PatchRecord = {
        id: randomUUID(),
        taskId,
        runId,
        status: "pending",
        patchPath,
        diffContent,
        testOutput,
        createdAt: now,
        ...(metadata
          ? {
              ...metadata,
              taskRevision:
                task.status === "running" ? task.revision + 1 : task.revision,
              applicationStatus: "not_applied" as const,
            }
          : {}),
      };

      this.db.savePatch(patch);

      if (task.status === "running") {
        this.transitionTask(
          taskId,
          {
            targetStatus: "review",
            baseRevision: task.revision,
            reason: `Patch proposed by run ${runId}`,
          },
          "agent_engine",
        );
      }

      this.publishEvent({
        id: randomUUID(),
        taskId,
        source: "agent_engine",
        type: "patch_proposed",
        timestamp: now,
        payload: {
          patchId: patch.id,
          runId,
          hasTestOutput: Boolean(testOutput),
          patch,
        },
      });

      return patch;
    });
  }

  public getPatch(id: string): PatchRecord {
    const patch = this.db.getPatch(id);
    if (!patch) {
      throw new NotFoundError(`Patch not found: ${id}`);
    }
    return patch;
  }

  public getPatchByTaskId(taskId: string): PatchRecord | null {
    return this.db.getPatchByTaskId(taskId);
  }

  public approvePatch(id: string, reviewerId?: string): PatchRecord {
    return this.db.transaction(() => {
      const patch = this.getPatch(id);
      if (patch.status !== "pending") {
        throw new ValidationError(`Patch is already ${patch.status}`);
      }
      if (this.patchCompletionMode === "verified_application") {
        const task = this.getTask(patch.taskId);
        if (
          !patch.review?.safe ||
          !patch.baseCommit ||
          !patch.diffHash ||
          patch.diffHash !==
            createHash("sha256").update(patch.diffContent, "utf8").digest("hex")
        ) {
          throw new ValidationError(
            "Patch has no safe immutable application metadata",
          );
        }
        if (patch.taskRevision !== task.revision || task.status !== "review") {
          throw new ConflictError(
            "Patch task revision changed",
            task.revision,
            patch.taskRevision ?? 0,
          );
        }
      }

      const updated = this.db.updatePatchStatus(id, "approved", reviewerId);
      if (!updated) {
        throw new NotFoundError(`Failed to update patch ${id}`);
      }

      const task = this.getTask(patch.taskId);
      if (
        task.status === "review" &&
        this.patchCompletionMode === "legacy_decision"
      ) {
        this.transitionTask(
          task.id,
          {
            targetStatus: "done",
            baseRevision: task.revision,
            reason: `Patch ${id} approved by ${reviewerId || "human_reviewer"}`,
          },
          "approval_engine",
        );
      }

      this.publishEvent({
        id: randomUUID(),
        taskId: patch.taskId,
        source: "approval_engine",
        type: "patch_approved",
        timestamp: new Date().toISOString(),
        payload: {
          patchId: id,
          reviewerId: reviewerId || "human_reviewer",
          patch: updated,
        },
      });

      return updated;
    });
  }

  public rejectPatch(
    id: string,
    reviewerId?: string,
    reason?: string,
  ): PatchRecord {
    return this.db.transaction(() => {
      const patch = this.getPatch(id);
      if (patch.status !== "pending") {
        throw new ValidationError(`Patch is already ${patch.status}`);
      }

      const updated = this.db.updatePatchStatus(
        id,
        "rejected",
        reviewerId,
        reason,
      );
      if (!updated) {
        throw new NotFoundError(`Failed to update patch ${id}`);
      }

      const task = this.getTask(patch.taskId);
      if (task.status === "review") {
        this.transitionTask(
          task.id,
          {
            targetStatus: "running",
            baseRevision: task.revision,
            reason: `Patch ${id} rejected: ${reason || "needs refinement"}`,
          },
          "approval_engine",
        );
      }

      this.publishEvent({
        id: randomUUID(),
        taskId: patch.taskId,
        source: "approval_engine",
        type: "patch_rejected",
        timestamp: new Date().toISOString(),
        payload: {
          patchId: id,
          reviewerId: reviewerId || "human_reviewer",
          reason,
          patch: updated,
        },
      });

      return updated;
    });
  }

  private validateOptionalText(
    value: unknown,
    field: string,
    max: number,
  ): void {
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > max)
    ) {
      throw new ValidationError(
        `${field} must be a string of at most ${max} characters`,
      );
    }
  }

  public finishVerifiedApplication(
    applicationId: string,
    expectedRevision: number,
  ): Task {
    return this.db.transaction(() => {
      const application = this.db.readRecord<
        import("../../contracts/agent.ts").ApplicationRecord
      >("applications", applicationId);
      const patch = application
        ? this.getPatch(application.patchId)
        : undefined;
      if (
        this.patchCompletionMode !== "verified_application" ||
        !application ||
        application.status !== "verified" ||
        !application.commit ||
        !application.evidence.at(-1)?.passed ||
        patch?.status !== "approved"
      ) {
        throw new ValidationError("Application is not durably verified");
      }
      this.verifiedCompletion = true;
      try {
        return this.transitionTask(
          application.taskId,
          {
            baseRevision: expectedRevision,
            targetStatus: "done",
            reason: `Verified application ${application.id}`,
          },
          "application_worker",
        );
      } finally {
        this.verifiedCompletion = false;
      }
    });
  }
  public createProject(
    req: ProjectCreateRequest,
    source: string = "api",
  ): Project {
    if (!req.name || req.name.trim().length === 0) {
      throw new ValidationError("Project name is required");
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: req.id ? req.id.trim() : randomUUID(),
      name: req.name.trim(),
      description: req.description?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    return this.db.transaction(() => {
      if (this.db.getProject(project.id))
        throw new ValidationError("Project ID already exists");
      this.db.saveProject(project);

      this.publishEvent({
        id: randomUUID(),
        source,
        type: "project_created",
        timestamp: now,
        payload: {
          project,
          projectId: project.id,
          name: project.name,
        },
      });

      return project;
    });
  }

  public getProject(id: string): Project {
    const project = this.db.getProject(id);
    if (!project) {
      throw new NotFoundError(`Project not found: ${id}`);
    }
    return project;
  }

  public listProjects(): Project[] {
    return this.db.listProjects();
  }

  // --- Structured Handoffs ---

  public recordHandoff(
    req: HandoffCreateRequest,
    source?: string,
  ): StructuredHandoff {
    if (!req.fromAgent || req.fromAgent.trim().length === 0) {
      throw new ValidationError("fromAgent is required for handoff");
    }
    if (!req.toAgent || req.toAgent.trim().length === 0) {
      throw new ValidationError("toAgent is required for handoff");
    }
    if (!req.summary || req.summary.trim().length === 0) {
      throw new ValidationError("summary is required for handoff");
    }

    const now = new Date().toISOString();
    const handoff: StructuredHandoff = {
      id: randomUUID(),
      fromAgent: req.fromAgent.trim(),
      toAgent: req.toAgent.trim(),
      taskId: req.taskId?.trim(),
      dependentTaskId: req.dependentTaskId?.trim(),
      handoffType: req.handoffType || "task_completed",
      summary: req.summary.trim(),
      contractVersion: "1.0.0",
      payload: req.payload || {},
      createdAt: now,
    };

    return this.db.transaction(() => {
      if (handoff.taskId) this.getTask(handoff.taskId);
      if (handoff.dependentTaskId) this.getTask(handoff.dependentTaskId);
      this.db.saveHandoff(handoff);

      this.publishEvent({
        id: randomUUID(),
        taskId: handoff.taskId,
        source: source || handoff.fromAgent,
        type: "agent_handoff",
        timestamp: now,
        payload: {
          handoff,
          handoffId: handoff.id,
          fromAgent: handoff.fromAgent,
          toAgent: handoff.toAgent,
          taskId: handoff.taskId,
          dependentTaskId: handoff.dependentTaskId,
          handoffType: handoff.handoffType,
          summary: handoff.summary,
          details: handoff.payload,
        },
      });

      return handoff;
    });
  }

  public listHandoffs(toAgent?: string, taskId?: string): StructuredHandoff[] {
    return this.db.listHandoffs(toAgent, taskId);
  }
}
