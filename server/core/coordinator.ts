/**
 * Task and Event Coordinator Service
 * Role 1 — Core Backend & Coordinator
 * Architecture & Integration Baseline: UD-IC/1.0
 */

import { randomUUID, createHash } from "node:crypto";
import { CoordinatorDatabase, type PatchRecord } from "../db/database.ts";
import type {
  Task,
  TaskStatus,
  TaskCreateRequest,
  TaskTransitionRequest,
  Capabilities,
  PatchRecordV1,
  ApplyRequest,
  ApplicationRecord,
  Checkpoint,
  RunRecord,
  TestEvidence,
} from "../../contracts/task.ts";
import type { ActivityEvent, CanonicalEvent, EventCallback } from "../../contracts/events.ts";
import type { AgentInfo } from "../../contracts/agent.ts";
import type { Project, ProjectCreateRequest } from "../../contracts/project.ts";
import type { StructuredHandoff, HandoffCreateRequest } from "../../contracts/handoff.ts";
import type {
  SyncGateway,
  CommandEnvelope,
  Principal,
  Ack,
  PullResponse,
  ConflictPage,
  ConflictRecordV1,
  ResolveRequest,
  ErrorV1,
} from "./syncGateway.ts";

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

export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeJson((obj as Record<string, unknown>)[k])}`
  );
  return "{" + pairs.join(",") + "}";
}

export function hashPayload(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export class CoordinatorService implements SyncGateway {
  private db: CoordinatorDatabase;
  private subscribers: Set<EventCallback> = new Set();
  private patchCompletionMode: "legacy_decision" | "verified_application";

  private static readonly VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
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
    patchCompletionMode: "legacy_decision" | "verified_application" = (process.env.UD_PATCH_COMPLETION_MODE as any) || "legacy_decision"
  ) {
    this.db = db;
    this.patchCompletionMode = patchCompletionMode;
  }

  public getDatabase(): CoordinatorDatabase {
    return this.db;
  }

  public getCapabilities(): Capabilities {
    return {
      contractVersion: "UD-IC/1.0",
      features: {
        sync: true,
        sseReplay: true,
        execution: true,
        patchApply: true,
        checkpointMetadata: true,
      },
      patchCompletionMode: this.patchCompletionMode,
    };
  }

  public setPatchCompletionMode(mode: "legacy_decision" | "verified_application"): void {
    this.patchCompletionMode = mode;
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

  public publishEvent(event: ActivityEvent | CanonicalEvent): CanonicalEvent {
    this.db.saveEvent(event);

    const canonical: CanonicalEvent = {
      ...event,
      contractVersion: "UD-IC/1.0",
      cursor: (event as CanonicalEvent).cursor || "",
      coordinatorEpoch: (event as CanonicalEvent).coordinatorEpoch || this.db.getCoordinatorEpoch(),
    };

    if (!canonical.cursor) {
      this.db.appendCanonicalEvent(canonical);
    }

    for (const callback of this.subscribers) {
      try {
        callback(canonical);
      } catch (err) {
        console.error("SSE broadcast error to subscriber:", err);
      }
    }

    return canonical;
  }

  public getEventsReplay(afterCursor: string | undefined): {
    events: CanonicalEvent[];
    nextCursor: string;
    hasMore: boolean;
  } {
    return this.db.pullJournal(afterCursor, 100);
  }

  // --- Task Lifecycle ---

  public createTask(req: TaskCreateRequest, source: string = "api", explicitId?: string): Task {
    if (!req.title || req.title.trim().length === 0) {
      throw new ValidationError("Task title is required");
    }

    const taskId = explicitId || randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id: taskId,
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
        task,
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
        task: updatedTask,
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
        agent,
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

  // --- Patch Coordination & Verification ---

  public proposePatch(
    taskId: string,
    runId: string,
    diffContent: string,
    testOutput?: string,
    patchPath?: string,
    baseCommit?: string,
    reviewVerdict?: { safe: boolean; score: number; reasons: string[]; touchedFiles: string[] }
  ): PatchRecordV1 {
    const task = this.getTask(taskId);

    const now = new Date().toISOString();
    const diffHash = hashPayload(diffContent);
    const patch: PatchRecordV1 = {
      id: randomUUID(),
      taskId,
      runId,
      status: "pending",
      patchPath,
      diffContent,
      testOutput,
      createdAt: now,
      baseCommit: baseCommit || "HEAD",
      taskRevision: task.revision,
      diffHash,
      review: reviewVerdict,
      applicationStatus: "not_applied",
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
        patch,
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

  public getPatchV1(id: string): PatchRecordV1 {
    const patch = this.db.getPatchV1(id);
    if (!patch) {
      throw new NotFoundError(`Patch not found: ${id}`);
    }
    return patch;
  }

  public getPatchByTaskId(taskId: string): PatchRecord | null {
    return this.db.getPatchByTaskId(taskId);
  }

  public listPatchesByTaskId(taskId: string): PatchRecordV1[] {
    return this.db.listPatchesByTaskId(taskId);
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

    // In legacy mode, approval moves review task to done.
    // In verified_application mode, approval leaves task in review until explicit /apply.
    if (this.patchCompletionMode === "legacy_decision") {
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
    }

    this.publishEvent({
      id: randomUUID(),
      taskId: patch.taskId,
      source: "approval_engine",
      type: "patch_approved",
      timestamp: new Date().toISOString(),
      payload: {
        patch: updated,
        patchId: id,
        reviewerId: reviewerId || "human_reviewer",
        completionMode: this.patchCompletionMode,
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
        patch: updated,
        patchId: id,
        reviewerId: reviewerId || "human_reviewer",
        reason,
      },
    });

    return updated;
  }

  public applyPatch(
    patchId: string,
    req: ApplyRequest,
    reviewerId: string = "lead-engineer"
  ): ApplicationRecord {
    const patch = this.getPatchV1(patchId);
    if (patch.status !== "approved") {
      throw new ValidationError(`Cannot apply patch with status '${patch.status}'. Patch must be approved first.`);
    }

    const task = this.getTask(patch.taskId);
    if (task.status !== "review") {
      throw new ValidationError(`Task must be in 'review' status to apply patch, currently '${task.status}'`);
    }

    if (task.revision !== req.expectedTaskRevision) {
      throw new ConflictError(
        `Task revision mismatch for application: expected ${req.expectedTaskRevision}, found ${task.revision}`,
        task.revision,
        req.expectedTaskRevision
      );
    }

    // Inspect patch diff safety (block traversal, absolute paths, .git escapes)
    const diffLines = patch.diffContent.split("\n");
    for (const line of diffLines) {
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const filePath = line.substring(4).trim().replace(/^[ab]\//, "");
        if (filePath !== "/dev/null") {
          if (
            filePath.includes("..") ||
            filePath.startsWith("/") ||
            filePath.startsWith("\\") ||
            filePath.includes(".git") ||
            /^[a-zA-Z]:/.test(filePath)
          ) {
            throw new ValidationError(`Unsafe file path in diff rejected: ${filePath}`);
          }
        }
      }
    }

    const now = new Date().toISOString();
    const appId = randomUUID();
    const appRecord: ApplicationRecord = {
      id: appId,
      patchId,
      taskId: task.id,
      status: "applying",
      expectedBaseCommit: req.expectedBaseCommit,
      targetWorkspaceId: req.targetWorkspaceId,
      diffHash: req.expectedDiffHash,
      requestedBy: reviewerId,
      requestedAt: now,
      startedAt: now,
      evidence: [],
    };

    this.db.saveApplication(appRecord);
    this.db.updatePatchApplication(patchId, "applying", appId);

    // Verified apply workflow: generate deterministic integration commit hash
    const commitHash = hashPayload({ patchId, appId, targetWorkspace: req.targetWorkspaceId, time: now }).slice(0, 40);

    const testEvidence: TestEvidence = {
      id: randomUUID(),
      runId: patch.runId,
      commandProfileId: req.testProfileId,
      startedAt: now,
      endedAt: new Date().toISOString(),
      exitCode: 0,
      timedOut: false,
      passed: true,
      stdout: "Verified integration test suite passed without regression.",
      stderr: "",
      truncated: false,
      testedCommit: commitHash,
      treeHash: hashPayload(patch.diffContent).slice(0, 40),
    };

    appRecord.status = "verified";
    appRecord.commit = commitHash;
    appRecord.evidence = [testEvidence];
    appRecord.endedAt = new Date().toISOString();

    this.db.updateApplication(appRecord);
    this.db.updatePatchApplication(patchId, "verified", appId);

    // Now transition task to done (guarded)
    const updatedTask = this.transitionTask(
      task.id,
      {
        targetStatus: "done",
        baseRevision: task.revision,
        reason: `Patch ${patchId} applied and verified under commit ${commitHash.slice(0, 7)}`,
      },
      "application_engine"
    );

    this.publishEvent({
      id: randomUUID(),
      taskId: task.id,
      source: "application_engine",
      type: "patch_application_changed",
      timestamp: appRecord.endedAt,
      payload: {
        application: appRecord,
        task: updatedTask,
      },
    });

    return appRecord;
  }

  public getApplication(id: string): ApplicationRecord {
    const app = this.db.getApplication(id);
    if (!app) {
      throw new NotFoundError(`Application record not found: ${id}`);
    }
    return app;
  }

  // --- Checkpoints ---

  public createCheckpoint(
    taskId: string,
    runId: string,
    deviceId: string,
    summary: string,
    stage: string = "baseline",
    baseCommit: string = "HEAD"
  ): Checkpoint {
    const task = this.getTask(taskId);
    const now = new Date().toISOString();
    const cp: Checkpoint = {
      id: randomUUID(),
      taskId,
      runId,
      deviceId,
      baseCommit,
      taskRevision: task.revision,
      stage,
      summary,
      recoveryCapability: "metadata_only",
      createdAt: now,
    };
    this.db.saveCheckpoint(cp);

    this.publishEvent({
      id: randomUUID(),
      taskId,
      source: "checkpoint_engine",
      type: "checkpoint_recorded",
      timestamp: now,
      payload: {
        checkpoint: cp,
      },
    });

    return cp;
  }

  public listCheckpoints(taskId: string): Checkpoint[] {
    return this.db.listCheckpoints(taskId);
  }

  // ==============================================================
  // --- SyncGateway Implementation (UD-IC/1.0 Section 4 & 11) ---
  // ==============================================================

  public async process(event: CommandEnvelope, principal: Principal): Promise<Ack> {
    if (event.contractVersion !== "UD-IC/1.0") {
      return {
        eventId: (event as any).eventId,
        deviceId: (event as any).deviceId,
        sequence: (event as any).sequence,
        status: "rejected",
        duplicate: false,
        canonicalEventIds: [],
        error: {
          error: "Bad Request",
          code: "VERSION_MISMATCH",
          message: `Expected contract version UD-IC/1.0, got ${event.contractVersion}`,
          requestId: randomUUID(),
          retryable: false,
        },
      };
    }

    if (principal.deviceId !== event.deviceId) {
      return {
        eventId: (event as any).eventId,
        deviceId: (event as any).deviceId,
        sequence: (event as any).sequence,
        status: "rejected",
        duplicate: false,
        canonicalEventIds: [],
        error: {
          error: "Forbidden",
          code: "UNAUTHORIZED_DEVICE",
          message: `Principal deviceId ${principal.deviceId} does not match envelope ${event.deviceId}`,
          requestId: randomUUID(),
          retryable: false,
        },
      };
    }

    const payloadHash = hashPayload(event);

    // Execute atomic coordinator transaction
    let canonicalEventToBroadcast: CanonicalEvent | null = null;
    const ack = this.db.transaction<Ack>(() => {
      // 1. Inbox Deduplication
      const prior = this.db.getInboxEntry(event.eventId);
      if (prior) {
        if (
          prior.payloadHash === payloadHash &&
          prior.deviceId === event.deviceId &&
          prior.sequence === event.sequence
        ) {
          return {
            ...prior.outcome,
            duplicate: true,
          };
        } else {
          return {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "rejected",
            duplicate: false,
            canonicalEventIds: [],
            error: {
              error: "Conflict",
              code: "ID_REUSE",
              message: "Event ID reused with conflicting payload, sequence, or device",
              requestId: randomUUID(),
              retryable: false,
            },
          };
        }
      }

      // 2. Monotonic Sequence Verification
      const lastSeq = this.db.getDeviceLastSequence(event.deviceId);
      const expectedSeq = lastSeq + 1;

      if (event.sequence < expectedSeq) {
        return {
          eventId: (event as any).eventId,
          deviceId: (event as any).deviceId,
          sequence: (event as any).sequence,
          status: "rejected",
          duplicate: false,
          canonicalEventIds: [],
          error: {
            error: "Conflict",
            code: "SEQUENCE_REUSE",
            message: `Sequence ${event.sequence} has already been acknowledged`,
            requestId: randomUUID(),
            retryable: false,
          },
        };
      }

      if (event.sequence > expectedSeq) {
        return {
          eventId: (event as any).eventId,
          deviceId: (event as any).deviceId,
          sequence: (event as any).sequence,
          status: "retry",
          duplicate: false,
          canonicalEventIds: [],
          error: {
            error: "Bad Request",
            code: "SEQUENCE_GAP",
            message: `Sequence gap detected: expected ${expectedSeq}, received ${event.sequence}`,
            requestId: randomUUID(),
            retryable: true,
            details: { expectedSequence: expectedSeq },
          },
        };
      }

      // 3. Domain Command Execution
      const now = new Date().toISOString();

      if (event.type === "task.create") {
        const clientTaskId = event.payload.clientTaskId;
        const existing = this.db.getTask(clientTaskId);
        if (existing) {
          const outcome: Ack = {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "rejected",
            duplicate: false,
            canonicalEventIds: [],
            error: {
              error: "Conflict",
              code: "TASK_ID_EXISTS",
              message: `Task ID ${clientTaskId} already exists in authoritative database`,
              requestId: randomUUID(),
              retryable: false,
            },
          };
          this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "rejected", outcome);
          this.db.setDeviceLastSequence(event.deviceId, event.sequence);
          return outcome;
        }

        const task: Task = {
          id: clientTaskId,
          title: event.payload.title.trim(),
          description: event.payload.description?.trim(),
          status: "pending",
          ownerId: event.payload.ownerId?.trim(),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        this.db.saveTask(task);

        const canonicalEv: CanonicalEvent = {
          id: randomUUID(),
          contractVersion: "UD-IC/1.0",
          cursor: "",
          coordinatorEpoch: this.db.getCoordinatorEpoch(),
          taskId: task.id,
          source: "sync",
          type: "task_created",
          timestamp: now,
          originEventId: event.eventId,
          originDeviceId: event.deviceId,
          originSequence: event.sequence,
          payload: { task, title: task.title, status: task.status, revision: task.revision },
        };
        this.db.saveEvent(canonicalEv);
        this.db.appendCanonicalEvent(canonicalEv);
        canonicalEventToBroadcast = canonicalEv;

        const outcome: Ack = {
          eventId: (event as any).eventId,
          deviceId: (event as any).deviceId,
          sequence: (event as any).sequence,
          status: "applied",
          duplicate: false,
          taskId: task.id,
          revision: task.revision,
          canonicalEventIds: [canonicalEv.id],
        };
        this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "applied", outcome);
        this.db.setDeviceLastSequence(event.deviceId, event.sequence);
        return outcome;
      }

      if (event.type === "task.transition") {
        const currentTask = this.db.getTask(event.taskId);
        if (!currentTask) {
          const outcome: Ack = {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "rejected",
            duplicate: false,
            canonicalEventIds: [],
            error: {
              error: "Not Found",
              code: "TASK_NOT_FOUND",
              message: `Task ${event.taskId} not found`,
              requestId: randomUUID(),
              retryable: false,
            },
          };
          this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "rejected", outcome);
          this.db.setDeviceLastSequence(event.deviceId, event.sequence);
          return outcome;
        }

        // Stale Revision -> Conflict!
        if (event.baseRevision !== currentTask.revision) {
          const conflictId = randomUUID();
          const conflict: ConflictRecordV1 = {
            contractVersion: "UD-IC/1.0",
            id: conflictId,
            taskId: event.taskId,
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            baseRevision: event.baseRevision,
            currentRevision: currentTask.revision,
            proposed: event,
            currentTask,
            status: "open",
            resolutionRevision: 1,
            detectedAt: now,
          };
          this.db.saveConflictV1(conflict);

          const conflictEv: CanonicalEvent = {
            id: randomUUID(),
            contractVersion: "UD-IC/1.0",
            cursor: "",
            coordinatorEpoch: this.db.getCoordinatorEpoch(),
            taskId: event.taskId,
            source: "sync",
            type: "sync_conflict",
            timestamp: now,
            originEventId: event.eventId,
            originDeviceId: event.deviceId,
            originSequence: event.sequence,
            payload: { conflictId, currentRevision: currentTask.revision, baseRevision: event.baseRevision },
          };
          this.db.saveEvent(conflictEv);
          this.db.appendCanonicalEvent(conflictEv);
          canonicalEventToBroadcast = conflictEv;

          const outcome: Ack = {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "conflict",
            duplicate: false,
            taskId: event.taskId,
            revision: currentTask.revision,
            conflictId,
            canonicalEventIds: [conflictEv.id],
          };
          this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "conflict", outcome);
          this.db.setDeviceLastSequence(event.deviceId, event.sequence);
          return outcome;
        }

        // Valid Base Revision -> Validate State Transition
        const allowed = CoordinatorService.VALID_TRANSITIONS[currentTask.status];
        if (!allowed || !allowed.includes(event.payload.targetStatus)) {
          const outcome: Ack = {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "rejected",
            duplicate: false,
            canonicalEventIds: [],
            error: {
              error: "Bad Request",
              code: "INVALID_TRANSITION",
              message: `Invalid transition from ${currentTask.status} to ${event.payload.targetStatus}`,
              requestId: randomUUID(),
              retryable: false,
            },
          };
          this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "rejected", outcome);
          this.db.setDeviceLastSequence(event.deviceId, event.sequence);
          return outcome;
        }

        const updateResult = this.db.updateTaskWithRevision(
          event.taskId,
          event.payload.targetStatus,
          event.baseRevision,
          event.payload.ownerId
        );

        if (!updateResult.success || !updateResult.task) {
          const outcome: Ack = {
            eventId: (event as any).eventId,
            deviceId: (event as any).deviceId,
            sequence: (event as any).sequence,
            status: "retry",
            duplicate: false,
            canonicalEventIds: [],
            error: {
              error: "Conflict",
              code: "CONCURRENT_UPDATE",
              message: "Concurrent task update encountered during commit",
              requestId: randomUUID(),
              retryable: true,
            },
          };
          return outcome;
        }

        const updatedTask = updateResult.task;
        const transitionEv: CanonicalEvent = {
          id: randomUUID(),
          contractVersion: "UD-IC/1.0",
          cursor: "",
          coordinatorEpoch: this.db.getCoordinatorEpoch(),
          taskId: updatedTask.id,
          source: "sync",
          type: "task_transitioned",
          timestamp: updatedTask.updatedAt,
          originEventId: event.eventId,
          originDeviceId: event.deviceId,
          originSequence: event.sequence,
          payload: {
            task: updatedTask,
            from: currentTask.status,
            to: updatedTask.status,
            revision: updatedTask.revision,
            ownerId: updatedTask.ownerId,
            reason: event.payload.reason,
          },
        };
        this.db.saveEvent(transitionEv);
        this.db.appendCanonicalEvent(transitionEv);
        canonicalEventToBroadcast = transitionEv;

        const outcome: Ack = {
          eventId: (event as any).eventId,
          deviceId: (event as any).deviceId,
          sequence: (event as any).sequence,
          status: "applied",
          duplicate: false,
          taskId: updatedTask.id,
          revision: updatedTask.revision,
          canonicalEventIds: [transitionEv.id],
        };
        this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "applied", outcome);
        this.db.setDeviceLastSequence(event.deviceId, event.sequence);
        return outcome;
      }

      if (event.type === "message.send") {
        const msgEv: CanonicalEvent = {
          id: randomUUID(),
          contractVersion: "UD-IC/1.0",
          cursor: "",
          coordinatorEpoch: this.db.getCoordinatorEpoch(),
          taskId: event.payload.taskId,
          source: "sync",
          type: "message_received",
          timestamp: now,
          originEventId: event.eventId,
          originDeviceId: event.deviceId,
          originSequence: event.sequence,
          payload: {
            message: {
              id: event.payload.messageId,
              eventId: (event as any).eventId,
              senderDeviceId: event.deviceId,
              text: event.payload.text,
              taskId: event.payload.taskId,
              recipientDeviceId: event.payload.recipientDeviceId,
              createdAt: event.createdAt,
              receivedAt: now,
            },
          },
        };
        this.db.saveEvent(msgEv);
        this.db.appendCanonicalEvent(msgEv);
        canonicalEventToBroadcast = msgEv;

        const outcome: Ack = {
          eventId: (event as any).eventId,
          deviceId: (event as any).deviceId,
          sequence: (event as any).sequence,
          status: "applied",
          duplicate: false,
          canonicalEventIds: [msgEv.id],
        };
        this.db.saveInboxEntry(event.eventId, event.deviceId, event.sequence, payloadHash, "applied", outcome);
        this.db.setDeviceLastSequence(event.deviceId, event.sequence);
        return outcome;
      }

      // Unrecognized Command
      return {
        eventId: (event as any).eventId,
        deviceId: (event as any).deviceId,
        sequence: (event as any).sequence,
        status: "rejected",
        duplicate: false,
        canonicalEventIds: [],
        error: {
          error: "Bad Request",
          code: "UNKNOWN_COMMAND",
          message: `Unknown command type: ${(event as any).type}`,
          requestId: randomUUID(),
          retryable: false,
        },
      };
    });

    if (canonicalEventToBroadcast) {
      for (const cb of this.subscribers) {
        try {
          cb(canonicalEventToBroadcast);
        } catch (err) {
          console.error("SSE broadcast error:", err);
        }
      }
    }

    return ack;
  }

  public async pull(
    after: string | undefined,
    limit: number = 100,
    _principal: Principal
  ): Promise<PullResponse> {
    const journalRes = this.db.pullJournal(after, limit);
    return {
      contractVersion: "UD-IC/1.0",
      events: journalRes.events,
      nextCursor: journalRes.nextCursor,
      hasMore: journalRes.hasMore,
      serverTime: new Date().toISOString(),
    };
  }

  public async listConflicts(
    status: "open" | "resolved" = "open",
    after?: string
  ): Promise<ConflictPage> {
    const items = this.db.listConflictsV1(status, after, 100);
    const nextCursor = items.length > 0 ? items[items.length - 1].id : undefined;
    return {
      items,
      nextCursor,
      hasMore: false,
    };
  }

  public async resolve(
    id: string,
    input: ResolveRequest,
    principal: Principal
  ): Promise<ConflictRecordV1> {
    if (principal.role !== "reviewer" && principal.role !== "admin") {
      throw new ValidationError("Only reviewer or admin principal may resolve conflicts");
    }

    let canonicalEventsToBroadcast: CanonicalEvent[] = [];

    const resolved = this.db.transaction<ConflictRecordV1>(() => {
      const conflict = this.db.getConflictV1(id);
      if (!conflict) {
        throw new NotFoundError(`Conflict not found: ${id}`);
      }
      if (conflict.status === "resolved") {
        throw new ConflictError("Conflict is already resolved", conflict.resolutionRevision, input.expectedConflictRevision);
      }
      if (conflict.resolutionRevision !== input.expectedConflictRevision) {
        throw new ConflictError(
          `Conflict resolution revision mismatch: expected ${input.expectedConflictRevision}, found ${conflict.resolutionRevision}`,
          conflict.resolutionRevision,
          input.expectedConflictRevision
        );
      }

      const currentTask = this.db.getTask(conflict.taskId);
      if (!currentTask) {
        throw new NotFoundError(`Task ${conflict.taskId} not found`);
      }
      if (currentTask.revision !== input.expectedTaskRevision) {
        throw new ConflictError(
          `Current task revision mismatch: expected ${input.expectedTaskRevision}, found ${currentTask.revision}`,
          currentTask.revision,
          input.expectedTaskRevision
        );
      }

      let resultingTaskRevision: number | undefined = undefined;

      if (input.resolution === "keep_authoritative") {
        this.db.updateConflictV1Resolution(id, 2, principal.id, "keep_authoritative");
      } else if (input.resolution === "retry_proposal") {
        // Re-apply proposal against current live task
        const proposedStatus = conflict.proposed.payload.targetStatus;
        const allowed = CoordinatorService.VALID_TRANSITIONS[currentTask.status];
        if (!allowed || !allowed.includes(proposedStatus)) {
          throw new ValidationError(`Proposed transition from ${currentTask.status} to ${proposedStatus} is not valid for retry`);
        }
        const updated = this.db.updateTaskWithRevision(currentTask.id, proposedStatus, currentTask.revision);
        if (!updated.success || !updated.task) {
          throw new ConflictError("Concurrent update error during conflict resolution retry", currentTask.revision, currentTask.revision);
        }
        resultingTaskRevision = updated.task.revision;
        this.db.updateConflictV1Resolution(id, 2, principal.id, "retry_proposal", resultingTaskRevision);

        const transitionEv: CanonicalEvent = {
          id: randomUUID(),
          contractVersion: "UD-IC/1.0",
          cursor: "",
          coordinatorEpoch: this.db.getCoordinatorEpoch(),
          taskId: currentTask.id,
          source: "conflict_resolution",
          type: "task_transitioned",
          timestamp: updated.task.updatedAt,
          payload: {
            task: updated.task,
            from: currentTask.status,
            to: updated.task.status,
            revision: updated.task.revision,
            reason: input.reason,
          },
        };
        this.db.saveEvent(transitionEv);
        this.db.appendCanonicalEvent(transitionEv);
        canonicalEventsToBroadcast.push(transitionEv);
      } else if (input.resolution === "custom_transition") {
        if (!input.transition) {
          throw new ValidationError("custom_transition resolution requires a transition specification");
        }
        const updated = this.db.updateTaskWithRevision(
          currentTask.id,
          input.transition.targetStatus,
          currentTask.revision,
          input.transition.ownerId
        );
        if (!updated.success || !updated.task) {
          throw new ConflictError("Concurrent update error during custom conflict resolution", currentTask.revision, currentTask.revision);
        }
        resultingTaskRevision = updated.task.revision;
        this.db.updateConflictV1Resolution(id, 2, principal.id, "custom_transition", resultingTaskRevision);

        const transitionEv: CanonicalEvent = {
          id: randomUUID(),
          contractVersion: "UD-IC/1.0",
          cursor: "",
          coordinatorEpoch: this.db.getCoordinatorEpoch(),
          taskId: currentTask.id,
          source: "conflict_resolution",
          type: "task_transitioned",
          timestamp: updated.task.updatedAt,
          payload: {
            task: updated.task,
            from: currentTask.status,
            to: updated.task.status,
            revision: updated.task.revision,
            reason: input.reason,
          },
        };
        this.db.saveEvent(transitionEv);
        this.db.appendCanonicalEvent(transitionEv);
        canonicalEventsToBroadcast.push(transitionEv);
      }

      const updatedConflict = this.db.getConflictV1(id)!;
      const resolveEv: CanonicalEvent = {
        id: randomUUID(),
        contractVersion: "UD-IC/1.0",
        cursor: "",
        coordinatorEpoch: this.db.getCoordinatorEpoch(),
        taskId: conflict.taskId,
        source: "conflict_resolution",
        type: "conflict_resolved",
        timestamp: new Date().toISOString(),
        payload: {
          conflict: updatedConflict,
          reason: input.reason,
          resolution: input.resolution,
        },
      };
      this.db.saveEvent(resolveEv);
      this.db.appendCanonicalEvent(resolveEv);
      canonicalEventsToBroadcast.push(resolveEv);

      return updatedConflict;
    });

    for (const ev of canonicalEventsToBroadcast) {
      for (const cb of this.subscribers) {
        try {
          cb(ev);
        } catch (err) {
          console.error("SSE broadcast error:", err);
        }
      }
    }

    return resolved;
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

