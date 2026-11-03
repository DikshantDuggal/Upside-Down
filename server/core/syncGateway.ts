import { randomUUID } from "node:crypto";
import type { Task, TaskStatus } from "../../contracts/task.ts";
import type { EventPage } from "../../contracts/events.ts";
import type { CoordinatorDatabase } from "../db/database.ts";
import {
  CoordinatorService,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "./coordinator.ts";
import {
  AuthenticationService,
  canReadEvent,
  type AuthenticatedPrincipal,
} from "./auth.ts";
import {
  ProtocolError,
  type ErrorV1,
  INTEGRATION_CONTRACT,
} from "./protocolError.ts";
import {
  canonicalHash,
  IdempotencyStore,
  requestIdentity,
} from "./idempotency.ts";

import type {
  Command,
  CommandEnvelope as Envelope,
  Ack as Outcome,
  ConflictRecordV1 as Conflict,
  ResolveRequest as Resolution,
  Message,
  SyncGateway,
} from "../../contracts/sync.ts";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = [
  "pending",
  "assigned",
  "running",
  "review",
  "done",
  "blocked",
  "failed",
];
function invalid(): never {
  throw new ProtocolError(
    400,
    "INVALID_ENVELOPE",
    "Malformed command envelope",
  );
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, any>;
}
function fields(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function text(value: unknown, max: number, required = false) {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    invalid();
}
function id(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) invalid();
}
function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    invalid();
}
export function validateEnvelope(input: unknown): Envelope {
  const e = object(input);
  fields(e, [
    "type",
    "payload",
    "taskId",
    "baseRevision",
    "contractVersion",
    "eventId",
    "deviceId",
    "sequence",
    "createdAt",
  ]);
  if (e.contractVersion !== INTEGRATION_CONTRACT)
    throw new ProtocolError(426, "CONTRACT_VERSION", "UD-IC/1.0 is required");
  id(e.eventId);
  id(e.deviceId);
  revision(e.sequence);
  if (
    typeof e.createdAt !== "string" ||
    e.createdAt.length > 64 ||
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(e.createdAt) ||
    !Number.isFinite(Date.parse(e.createdAt))
  )
    invalid();
  const p = object(e.payload);
  if (e.type === "task.create") {
    fields(p, ["clientTaskId", "title", "description", "ownerId"]);
    id(p.clientTaskId);
    text(p.title, 200, true);
    text(p.description, 16384);
    text(p.ownerId, 200);
    if (e.taskId !== undefined || e.baseRevision !== undefined) invalid();
  } else if (e.type === "task.transition") {
    fields(p, ["targetStatus", "ownerId", "reason"]);
    id(e.taskId);
    revision(e.baseRevision);
    if (!statuses.includes(p.targetStatus)) invalid();
    text(p.ownerId, 200);
    text(p.reason, 2048);
  } else if (e.type === "message.send") {
    fields(p, ["messageId", "text", "taskId", "recipientDeviceId"]);
    id(p.messageId);
    text(p.text, 4096, true);
    if (Buffer.byteLength(p.text, "utf8") > 4096)
      throw new ProtocolError(
        413,
        "MESSAGE_TOO_LARGE",
        "Message exceeds 4096 UTF-8 bytes",
      );
    if (p.taskId !== undefined) id(p.taskId);
    if (p.recipientDeviceId !== undefined) id(p.recipientDeviceId);
    if (e.taskId !== undefined || e.baseRevision !== undefined) invalid();
  } else invalid();
  return structuredClone(e) as Envelope;
}

export class CoordinatorSyncGateway implements SyncGateway {
  private db: CoordinatorDatabase;
  private coordinator: CoordinatorService;
  private auth: AuthenticationService;
  private idempotency: IdempotencyStore;
  constructor(
    db: CoordinatorDatabase,
    coordinator: CoordinatorService,
    auth: AuthenticationService,
  ) {
    this.db = db;
    this.coordinator = coordinator;
    this.auth = auth;
    this.idempotency = new IdempotencyStore(db);
  }
  async process(
    input: unknown,
    principal: AuthenticatedPrincipal,
  ): Promise<Outcome> {
    const e = validateEnvelope(input);
    if (e.deviceId !== principal.deviceId)
      throw new ProtocolError(
        403,
        "DEVICE_MISMATCH",
        "Envelope identity does not match the authenticated device",
      );
    return this.db.transaction(() => {
      const hash = canonicalHash(e);
      const prior = this.db.readRecord<{ hash: string; ack: Outcome }>(
        "sync_outcomes",
        e.eventId,
      );
      if (prior) {
        if (
          prior.hash !== hash ||
          prior.ack.deviceId !== principal.deviceId ||
          prior.ack.sequence !== e.sequence
        ) {
          throw new ProtocolError(
            409,
            "ID_REUSE",
            "Event ID was reused with different content or identity",
          );
        }
        return { ...prior.ack, duplicate: true };
      }
      const progress = this.receivedThrough(e.deviceId);
      const sequenceId = `${e.deviceId}:${e.sequence}`;
      if (
        e.sequence <= progress ||
        this.db.readRecord("sync_sequences", sequenceId)
      ) {
        throw new ProtocolError(
          409,
          "SEQUENCE_REUSE",
          "Device sequence was already used by another event",
        );
      }
      const ack: Outcome = {
        eventId: e.eventId,
        deviceId: e.deviceId,
        sequence: e.sequence,
        status: "applied",
        duplicate: false,
        canonicalEventIds: [],
      };
      if (e.sequence !== progress + 1) {
        return {
          ...ack,
          status: "retry",
          error: new ProtocolError(
            409,
            "SEQUENCE_GAP",
            "Missing earlier device sequence",
            { expectedSequence: progress + 1 },
            true,
          ).body(),
        };
      }
      const before = this.db.latestEventCursor();
      this.db.withEventOrigin(
        {
          originEventId: e.eventId,
          originDeviceId: e.deviceId,
          originSequence: e.sequence,
        },
        () => {
          try {
            this.db.transaction(() => this.applyCommand(e, ack));
          } catch (error) {
            if (
              !(error instanceof ValidationError) &&
              !(error instanceof NotFoundError) &&
              !(error instanceof ProtocolError)
            )
              throw error;
            if (
              error instanceof ProtocolError &&
              ![404, 409, 422].includes(error.status)
            )
              throw error;
            ack.status = "rejected";
            const rejected =
              error instanceof ProtocolError
                ? error
                : new ProtocolError(
                    422,
                    error instanceof NotFoundError
                      ? "TASK_NOT_FOUND"
                      : "INVALID_TRANSITION",
                    error.message,
                  );
            ack.error = rejected.body();
          }
        },
      );
      ack.canonicalEventIds = this.db
        .listCanonicalEvents(before, 200)
        .events.map((event) => event.id);
      this.db.insertRecord("sync_outcomes", e.eventId, { hash, ack });
      this.db.insertRecord("sync_sequences", sequenceId, e.eventId);
      this.db.putRecord("sync_progress", e.deviceId, e.sequence);
      return ack;
    });
  }

  receivedThrough(deviceId: string): number {
    return this.db.readRecord<number>("sync_progress", deviceId) ?? 0;
  }

  private applyCommand(e: Envelope, ack: Outcome) {
    if (e.type === "task.create") {
      if (this.db.getTask(e.payload.clientTaskId))
        throw new ProtocolError(
          409,
          "TASK_ID_EXISTS",
          "Task ID already exists",
        );
      const task = this.coordinator.createTask(
        e.payload,
        "sync",
        e.payload.clientTaskId,
      );
      ack.taskId = task.id;
      ack.revision = task.revision;
    } else if (e.type === "task.transition") {
      const current = this.coordinator.getTask(e.taskId);
      ack.taskId = current.id;
      ack.revision = current.revision;
      if (current.revision !== e.baseRevision) {
        const conflict: Conflict = {
          contractVersion: INTEGRATION_CONTRACT,
          id: randomUUID(),
          taskId: e.taskId,
          eventId: e.eventId,
          deviceId: e.deviceId,
          baseRevision: e.baseRevision,
          currentRevision: current.revision,
          proposed: {
            type: e.type,
            taskId: e.taskId,
            baseRevision: e.baseRevision,
            payload: e.payload,
          },
          currentTask: current,
          detectedAt: new Date().toISOString(),
          status: "open",
          resolutionRevision: 1,
        };
        this.db.insertRecord("sync_conflicts", conflict.id, conflict);
        this.coordinator.recordExternalEvent({
          id: randomUUID(),
          source: "sync",
          taskId: e.taskId,
          type: "sync_conflict",
          timestamp: conflict.detectedAt,
          payload: {
            conflictId: conflict.id,
            currentRevision: current.revision,
            baseRevision: e.baseRevision,
          },
        });
        ack.status = "conflict";
        ack.conflictId = conflict.id;
      } else {
        const task = this.coordinator.transitionTask(
          e.taskId,
          { ...e.payload, baseRevision: e.baseRevision },
          "sync",
        );
        ack.revision = task.revision;
      }
    } else {
      if (this.db.readRecord("messages", e.payload.messageId))
        throw new ProtocolError(
          409,
          "MESSAGE_ID_EXISTS",
          "Message ID already exists",
        );
      if (e.payload.taskId) this.coordinator.getTask(e.payload.taskId);
      const message: Message = {
        id: e.payload.messageId,
        eventId: e.eventId,
        senderDeviceId: e.deviceId,
        text: e.payload.text,
        ...(e.payload.taskId ? { taskId: e.payload.taskId } : {}),
        ...(e.payload.recipientDeviceId
          ? { recipientDeviceId: e.payload.recipientDeviceId }
          : {}),
        createdAt: e.createdAt,
        receivedAt: new Date().toISOString(),
      };
      this.db.insertRecord("messages", message.id, message);
      this.coordinator.recordExternalEvent({
        id: randomUUID(),
        source: "sync",
        taskId: message.taskId,
        type: "message_sent",
        timestamp: message.receivedAt,
        payload: { message },
      });
      if (message.taskId) ack.taskId = message.taskId;
    }
  }

  async pull(
    after: string | undefined,
    limit: number,
    principal: AuthenticatedPrincipal,
  ): Promise<EventPage> {
    const page = this.db.listCanonicalEvents(after, limit);
    return {
      ...page,
      events: page.events.filter((event) => canReadEvent(event, principal)),
    };
  }

  async listConflicts(
    status: "open" | "resolved",
    after?: string,
  ): Promise<{ items: Conflict[]; nextCursor?: string; hasMore: boolean }> {
    if (
      !["open", "resolved"].includes(status) ||
      (after !== undefined && !uuid.test(after))
    ) {
      throw new ProtocolError(
        400,
        "INVALID_CONFLICT_QUERY",
        "Invalid conflict status or cursor",
      );
    }
    const items: Conflict[] = [];
    let cursor = after ?? "";
    let exhausted = false;
    while (items.length < 101 && !exhausted) {
      const rows = this.db.listRecords<Conflict>("sync_conflicts", cursor, 200);
      for (const row of rows)
        if (row.value.status === status) items.push(row.value);
      cursor = rows.at(-1)?.id ?? cursor;
      exhausted = rows.length < 200;
    }
    const page = items.slice(0, 100);
    return {
      items: page,
      ...(items.length > 100 ? { nextCursor: page.at(-1)!.id } : {}),
      hasMore: items.length > 100,
    };
  }

  async resolve(
    conflictId: string,
    input: Resolution,
    principal: AuthenticatedPrincipal,
  ): Promise<Conflict> {
    this.auth.requireReviewer(principal);
    id(conflictId);
    const r = object(input);
    fields(r, [
      "resolution",
      "expectedConflictRevision",
      "expectedTaskRevision",
      "transition",
      "reason",
    ]);
    revision(r.expectedConflictRevision);
    revision(r.expectedTaskRevision);
    text(r.reason, 2048, true);
    if (
      !["keep_authoritative", "retry_proposal", "custom_transition"].includes(
        r.resolution,
      )
    )
      invalid();
    if (r.transition !== undefined) {
      const t = object(r.transition);
      fields(t, ["targetStatus", "ownerId", "reason"]);
      if (!statuses.includes(t.targetStatus)) invalid();
      text(t.ownerId, 200);
      text(t.reason, 2048, true);
    }
    if (r.resolution === "custom_transition" && !r.transition) invalid();
    return this.idempotency.execute(
      `${principal.id}:resolve:${conflictId}`,
      requestIdentity.getStore()?.key,
      r,
      () => {
        const conflict = this.db.readRecord<Conflict>(
          "sync_conflicts",
          conflictId,
        );
        if (!conflict)
          throw new ProtocolError(
            404,
            "CONFLICT_NOT_FOUND",
            "Conflict not found",
          );
        if (conflict.status !== "open")
          throw new ProtocolError(
            409,
            "CONFLICT_RESOLVED",
            "Conflict is already resolved",
          );
        const task = this.coordinator.getTask(conflict.taskId);
        if (
          conflict.resolutionRevision !== r.expectedConflictRevision ||
          task.revision !== r.expectedTaskRevision
        ) {
          throw new ProtocolError(
            409,
            "STALE_REVISION",
            "Conflict or task changed; refresh before resolving",
            {
              currentRevision: task.revision,
              baseRevision: r.expectedTaskRevision,
            },
          );
        }
        let resultingTaskRevision: number | undefined;
        if (r.resolution !== "keep_authoritative") {
          const transition =
            r.resolution === "retry_proposal"
              ? conflict.proposed.payload
              : r.transition;
          try {
            resultingTaskRevision = this.coordinator.transitionTask(
              task.id,
              { ...transition, baseRevision: task.revision },
              "conflict_resolution",
            ).revision;
          } catch (error) {
            if (error instanceof ValidationError)
              throw new ProtocolError(422, "INVALID_TRANSITION", error.message);
            if (error instanceof ConflictError)
              throw new ProtocolError(
                409,
                "STALE_REVISION",
                "Task changed while resolving",
              );
            throw error;
          }
        }
        const resolved: Conflict = {
          ...conflict,
          status: "resolved",
          resolutionRevision: conflict.resolutionRevision + 1,
          resolution: r.resolution,
          resolvedAt: new Date().toISOString(),
          resolvedBy: principal.id,
          ...(resultingTaskRevision === undefined
            ? {}
            : { resultingTaskRevision }),
        };
        this.db.putRecord("sync_conflicts", conflictId, resolved);
        this.coordinator.recordExternalEvent({
          id: randomUUID(),
          source: "conflict_resolution",
          taskId: task.id,
          type: "conflict_resolved",
          timestamp: resolved.resolvedAt!,
          payload: { conflict: resolved },
        });
        return resolved;
      },
    );
  }
}
