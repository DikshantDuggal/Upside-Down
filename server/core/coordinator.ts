/**
 * Task and Event Coordinator Service
 * Role 1 — Core Backend & Coordinator
 */

import { randomUUID } from "node:crypto";
import { CoordinatorDatabase, type PatchRecord } from "../db/database.ts";
import type {
  Task,
  TaskStatus,
  TaskCreateRequest,
  TaskTransitionRequest,
} from "../../contracts/task.ts";
import type { ActivityEvent, EventCallback } from "../../contracts/events.ts";
import type { AgentInfo } from "../../contracts/agent.ts";
import type { Project, ProjectCreateRequest } from "../../contracts/project.ts";
import type { StructuredHandoff, HandoffCreateRequest } from "../../contracts/handoff.ts";

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

  private static readonly VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: ["assigned", "blocked", "running"],
    assigned: ["running", "blocked", "pending"],
    running: ["review", "failed", "blocked"],
    review: ["done", "running", "failed"],
    blocked: ["pending", "assigned", "running"],
    failed: ["pending", "running"],
    done: [],
  };

  constructor(db: CoordinatorDatabase) {
    this.db = db;
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
    this.db.saveEvent(event);
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (err) {
        console.error("SSE broadcast error to subscriber:", err);
      }
    }
  }

  // --- Task Lifecycle ---

  public createTask(req: TaskCreateRequest, source: string = "api"): Task {
    if (!req.title || req.title.trim().length === 0) {
      throw new ValidationError("Task title is required");
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
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
      },
    });

    return task;
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
    source: string = "api"
  ): Task {
    const current = this.getTask(id);

    if (req.baseRevision !== current.revision) {
      throw new ConflictError(
        `Stale task revision: provided ${req.baseRevision}, current is ${current.revision}`,
        current.revision,
        req.baseRevision
      );
    }

    const allowed = CoordinatorService.VALID_TRANSITIONS[current.status];
    if (!allowed || !allowed.includes(req.targetStatus)) {
      throw new ValidationError(
        `Invalid task state transition from '${current.status}' to '${req.targetStatus}'. Allowed: [${(allowed || []).join(", ")}]`
      );
    }

    const updateResult = this.db.updateTaskWithRevision(
      id,
      req.targetStatus,
      req.baseRevision,
      req.ownerId
    );

    if (!updateResult.success || !updateResult.task) {
      throw new ConflictError(
        `Concurrent update conflict on task ${id}`,
        updateResult.currentRevision || current.revision,
        req.baseRevision
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
      },
    });

    return updatedTask;
  }

  // --- Events API ---

  public listEvents(taskId?: string, since?: string, limit: number = 100): ActivityEvent[] {
    return this.db.listEvents(taskId, since, limit);
  }

  // --- Agent Registry ---

  public registerAgent(agent: AgentInfo): void {
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
      },
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
    patchPath?: string
  ): PatchRecord {
    const task = this.getTask(taskId);

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
        "agent_engine"
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
      },
    });

    return patch;
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
    const patch = this.getPatch(id);
    if (patch.status !== "pending") {
      throw new ValidationError(`Patch is already ${patch.status}`);
    }

    const updated = this.db.updatePatchStatus(id, "approved", reviewerId);
    if (!updated) {
      throw new NotFoundError(`Failed to update patch ${id}`);
    }

    const task = this.getTask(patch.taskId);
    if (task.status === "review") {
      this.transitionTask(
        task.id,
        {
          targetStatus: "done",
          baseRevision: task.revision,
          reason: `Patch ${id} approved by ${reviewerId || "human_reviewer"}`,
        },
        "approval_engine"
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
      },
    });

    return updated;
  }

  public rejectPatch(id: string, reviewerId?: string, reason?: string): PatchRecord {
    const patch = this.getPatch(id);
    if (patch.status !== "pending") {
      throw new ValidationError(`Patch is already ${patch.status}`);
    }

    const updated = this.db.updatePatchStatus(id, "rejected", reviewerId, reason);
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
        "approval_engine"
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
      },
    });

    return updated;
  }

  // --- Project Management ---

  public createProject(req: ProjectCreateRequest, source: string = "api"): Project {
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

    this.db.saveProject(project);

    this.publishEvent({
      id: randomUUID(),
      source,
      type: "project_created",
      timestamp: now,
      payload: {
        projectId: project.id,
        name: project.name,
      },
    });

    return project;
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

  public recordHandoff(req: HandoffCreateRequest, source?: string): StructuredHandoff {
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

    this.db.saveHandoff(handoff);

    this.publishEvent({
      id: randomUUID(),
      taskId: handoff.taskId,
      source: source || handoff.fromAgent,
      type: "agent_handoff",
      timestamp: now,
      payload: {
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
  }

  public listHandoffs(toAgent?: string, taskId?: string): StructuredHandoff[] {
    return this.db.listHandoffs(toAgent, taskId);
  }
}

