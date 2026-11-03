/**
 * Canonical SyncGateway Interface & Wire Types
 * Architecture & Integration Baseline: UD-IC/1.0
 * Primary Owner: Role 1 — Coordinator and Execution (Laptop 1 / Computer A)
 */

import type { Task, TaskStatus } from "../../contracts/task.ts";
import type { CanonicalEvent } from "../../contracts/events.ts";

export type Version = "UD-IC/1.0";

export type Command =
  | { type: "task.create"; payload: { clientTaskId: string; title: string; description?: string; ownerId?: string } }
  | { type: "task.transition"; taskId: string; baseRevision: number; payload: { targetStatus: TaskStatus; ownerId?: string; reason?: string } }
  | { type: "message.send"; payload: { messageId: string; text: string; taskId?: string; recipientDeviceId?: string } };

export type CommandEnvelope = Command & {
  contractVersion: Version;
  eventId: string;
  deviceId: string;
  sequence: number;
  createdAt: string;
};

export interface Principal {
  id: string;
  deviceId: string;
  role: "device" | "reviewer" | "admin";
}

export interface ErrorV1 {
  error: string;
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  details?: {
    currentRevision?: number;
    baseRevision?: number;
    conflictId?: string;
    expectedSequence?: number;
    retryAfterMs?: number;
    [key: string]: unknown;
  };
}

export interface Ack {
  eventId: string;
  deviceId: string;
  sequence: number;
  status: "applied" | "conflict" | "rejected" | "retry";
  duplicate: boolean;
  taskId?: string;
  revision?: number;
  conflictId?: string;
  canonicalEventIds: string[];
  error?: ErrorV1;
}

export interface PushRequest {
  contractVersion: Version;
  deviceId: string;
  events: CommandEnvelope[];
}

export interface PushResponse {
  contractVersion: Version;
  acks: Ack[];
  receivedThrough: number;
  serverTime: string;
}

export interface PullResponse {
  contractVersion: Version;
  events: CanonicalEvent[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: string;
}

export interface ConflictRecordV1 {
  contractVersion: Version;
  id: string;
  taskId: string;
  eventId: string;
  deviceId: string;
  baseRevision: number;
  currentRevision: number;
  proposed: Extract<Command, { type: "task.transition" }>;
  currentTask: Task;
  detectedAt: string;
  status: "open" | "resolved";
  resolutionRevision: number;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: "keep_authoritative" | "retry_proposal" | "custom_transition";
  resultingTaskRevision?: number;
}

export interface ResolveRequest {
  resolution: "keep_authoritative" | "retry_proposal" | "custom_transition";
  expectedConflictRevision: number;
  expectedTaskRevision: number;
  transition?: { targetStatus: TaskStatus; ownerId?: string; reason: string };
  reason: string;
}

export interface ConflictPage {
  items: ConflictRecordV1[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SyncGateway {
  // Owns one atomic coordinator DB transaction per event.
  process(event: CommandEnvelope, principal: Principal): Promise<Ack>;
  // Canonical durable journal, not timestamp history.
  pull(after: string | undefined, limit: number, principal: Principal): Promise<PullResponse>;
  listConflicts(status: "open" | "resolved", after?: string): Promise<ConflictPage>;
  resolve(id: string, input: ResolveRequest, principal: Principal): Promise<ConflictRecordV1>;
}
