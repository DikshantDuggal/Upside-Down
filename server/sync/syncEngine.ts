/**
 * Offline Synchronization & Communication Engine
 * Module D — Offline-First Multi-Agent Platform
 * Protocol Version: 1.0 & 3.0
 */

import { randomUUID } from "node:crypto";
import type { CoordinatorDatabase, OutboxItem } from "../db/database.ts";
import type { CoordinatorService } from "../core/coordinator.ts";
import type { SyncEvent, ConflictRecord } from "../../contracts/sync.ts";
import type { Task, TaskStatus } from "../../contracts/task.ts";

export interface SyncEngineOptions {
  deviceId?: string;
  isOnline?: boolean;
  transportSender?: (item: OutboxItem) => Promise<boolean>;
}

export interface IngestResult {
  status: "applied" | "duplicate" | "conflict";
  eventId: string;
  conflictId?: string;
  applied: boolean;
  message?: string;
}

export class SyncEngine {
  private db: CoordinatorDatabase;
  private coordinator: CoordinatorService;
  private deviceId: string;
  private isOnline: boolean;
  private sequenceCounter: number = 0;
  private transportSender?: (item: OutboxItem) => Promise<boolean>;

  constructor(
    db: CoordinatorDatabase,
    coordinator: CoordinatorService,
    options: SyncEngineOptions = {}
  ) {
    this.db = db;
    this.coordinator = coordinator;
    this.deviceId = options.deviceId || `device-${randomUUID().substring(0, 8)}`;
    this.isOnline = options.isOnline !== undefined ? options.isOnline : true;
    this.transportSender = options.transportSender;
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public setOnlineStatus(online: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = online;

    this.coordinator.recordExternalEvent({
      id: randomUUID(),
      source: "syncEngine",
      type: "SYNC_CONNECTIVITY_CHANGED",
      timestamp: new Date().toISOString(),
      payload: {
        deviceId: this.deviceId,
        isOnline: this.isOnline,
        previousState: wasOnline,
      },
    });

    if (!wasOnline && online) {
      // Reconnected! Automatically flush pending outbox
      this.flushOutbox().catch((err) => {
        console.error("[SyncEngine] Error flushing outbox on reconnect:", err);
      });
    }
  }

  /**
   * Enqueue an event into the durable SQLite offline outbox.
   */
  public enqueueOutbox(
    destination: string,
    type: string,
    payload: Record<string, unknown>,
    taskId?: string,
    baseRevision?: number
  ): OutboxItem {
    this.sequenceCounter++;
    const eventId = `sync-${randomUUID()}`;
    const outboxId = `outbox-${randomUUID()}`;
    const now = new Date().toISOString();

    const syncEvent: SyncEvent = {
      eventId,
      deviceId: this.deviceId,
      sequence: this.sequenceCounter,
      taskId,
      baseRevision,
      type,
      payload,
    };

    const outboxItem: OutboxItem = {
      id: outboxId,
      eventId,
      destination,
      status: "pending",
      payload: syncEvent as unknown as Record<string, unknown>,
      retryCount: 0,
      createdAt: now,
    };

    this.db.saveOutboxItem(outboxItem);

    this.coordinator.recordExternalEvent({
      id: randomUUID(),
      taskId,
      source: "syncEngine",
      type: "SYNC_EVENT_QUEUED",
      timestamp: now,
      payload: {
        outboxId,
        eventId,
        destination,
        eventType: type,
        isOnline: this.isOnline,
      },
    });

    // If online and transport sender is configured, attempt immediate dispatch
    if (this.isOnline && this.transportSender) {
      this.dispatchItem(outboxItem).catch(() => {});
    }

    return outboxItem;
  }

  /**
   * Flush all pending outbox items.
   */
  public async flushOutbox(): Promise<{ delivered: number; failed: number }> {
    if (!this.isOnline) {
      return { delivered: 0, failed: 0 };
    }

    const pending = this.db.getPendingOutbox();
    let delivered = 0;
    let failed = 0;

    for (const item of pending) {
      const success = await this.dispatchItem(item);
      if (success) {
        delivered++;
      } else {
        failed++;
      }
    }

    return { delivered, failed };
  }

  private async dispatchItem(item: OutboxItem): Promise<boolean> {
    if (!this.transportSender) {
      // Default offline loopback / mock transport marks delivered if online
      this.db.updateOutboxStatus(item.id, "delivered");
      return true;
    }

    try {
      const delivered = await this.transportSender(item);
      if (delivered) {
        this.db.updateOutboxStatus(item.id, "delivered");
        return true;
      } else {
        this.db.updateOutboxStatus(item.id, "failed", "Transport rejected delivery");
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.updateOutboxStatus(item.id, "failed", msg);
      return false;
    }
  }

  /**
   * Ingest an incoming synchronization event from a remote peer, LAN broadcast, or GitHub Message Board.
   */
  public ingestIncomingEvent(event: SyncEvent): IngestResult {
    // 1. Duplicate check (Idempotency)
    if (this.db.hasSyncEvent(event.eventId)) {
      return {
        status: "duplicate",
        eventId: event.eventId,
        applied: false,
        message: `Duplicate event suppressed: ${event.eventId}`,
      };
    }

    // 2. Conflict detection for task-related mutations
    if (event.taskId) {
      const localTask = this.db.getTask(event.taskId);

      if (localTask && event.baseRevision !== undefined) {
        // If incoming baseRevision does not match current local revision, we have concurrent divergence!
        if (event.baseRevision !== localTask.revision) {
          const conflictId = `conflict-${randomUUID()}`;
          const conflict: ConflictRecord = {
            id: conflictId,
            taskId: event.taskId,
            localRevision: localTask.revision,
            incomingRevision: event.baseRevision + 1,
            localPayload: localTask as unknown as Record<string, unknown>,
            incomingPayload: event.payload,
            detectedAt: new Date().toISOString(),
            resolved: false,
          };

          this.db.saveConflict(conflict);
          this.db.saveSyncEvent(event); // Record that we saw the event

          this.coordinator.recordExternalEvent({
            id: randomUUID(),
            taskId: event.taskId,
            source: "syncEngine",
            type: "SYNC_CONFLICT_DETECTED",
            timestamp: conflict.detectedAt,
            payload: {
              conflictId,
              taskId: event.taskId,
              localRevision: localTask.revision,
              incomingBaseRevision: event.baseRevision,
            },
          });

          return {
            status: "conflict",
            eventId: event.eventId,
            conflictId,
            applied: false,
            message: `Revision conflict on task ${event.taskId}: local=${localTask.revision}, incomingBase=${event.baseRevision}`,
          };
        }
      }

      // Apply task mutation locally if matching or new
      this.applyTaskEventLocally(event, localTask);
    }

    // 3. Persist incoming event to prevent re-processing
    this.db.saveSyncEvent(event);

    this.coordinator.recordExternalEvent({
      id: randomUUID(),
      taskId: event.taskId,
      source: "syncEngine",
      type: "SYNC_EVENT_APPLIED",
      timestamp: new Date().toISOString(),
      payload: {
        eventId: event.eventId,
        deviceId: event.deviceId,
        eventType: event.type,
      },
    });

    return {
      status: "applied",
      eventId: event.eventId,
      applied: true,
    };
  }

  private applyTaskEventLocally(event: SyncEvent, existingTask: Task | null): void {
    if (!existingTask) {
      // Create task if it came from remote
      const title = String(event.payload.title || `Sync Task ${event.taskId}`);
      const status = (event.payload.status as TaskStatus) || "pending";
      const task: Task = {
        id: event.taskId!,
        title,
        description: event.payload.description ? String(event.payload.description) : undefined,
        status,
        ownerId: event.payload.ownerId ? String(event.payload.ownerId) : undefined,
        revision: event.baseRevision ? event.baseRevision + 1 : 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.db.saveTask(task);
    } else {
      // Transition or update
      const targetStatus = event.payload.targetStatus as TaskStatus | undefined;
      const ownerId = event.payload.ownerId ? String(event.payload.ownerId) : existingTask.ownerId;
      if (targetStatus && targetStatus !== existingTask.status) {
        this.db.updateTaskWithRevision(existingTask.id, targetStatus, existingTask.revision, ownerId);
      }
    }
  }

  /**
   * Resolve an existing conflict.
   */
  public resolveConflict(
    conflictId: string,
    resolution: "accepted_incoming" | "kept_local" | "custom_merge",
    customPayload?: Record<string, unknown>
  ): void {
    const conflicts = this.db.getConflicts();
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    const localTask = this.db.getTask(conflict.taskId);
    if (!localTask) {
      throw new Error(`Task ${conflict.taskId} not found`);
    }

    if (resolution === "accepted_incoming") {
      const incomingStatus = (conflict.incomingPayload.targetStatus || conflict.incomingPayload.status) as TaskStatus;
      if (incomingStatus) {
        this.db.updateTaskWithRevision(localTask.id, incomingStatus, localTask.revision, conflict.incomingPayload.ownerId as string);
      }
    } else if (resolution === "custom_merge" && customPayload) {
      if (customPayload.status) {
        this.db.updateTaskWithRevision(localTask.id, customPayload.status as TaskStatus, localTask.revision, customPayload.ownerId as string);
      }
    }
    // "kept_local" keeps the local state as is

    this.db.resolveConflict(conflictId, resolution);

    this.coordinator.recordExternalEvent({
      id: randomUUID(),
      taskId: conflict.taskId,
      source: "syncEngine",
      type: "SYNC_CONFLICT_RESOLVED",
      timestamp: new Date().toISOString(),
      payload: {
        conflictId,
        taskId: conflict.taskId,
        resolution,
      },
    });
  }

  public getPendingOutbox(): OutboxItem[] {
    return this.db.getPendingOutbox();
  }

  public getConflicts(resolved?: boolean): ConflictRecord[] {
    return this.db.getConflicts(resolved);
  }
}
