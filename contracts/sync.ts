/**
 * Canonical Synchronization Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 4 — Offline Sync & Communication
 */

export const SYNC_CONTRACT_VERSION = "1.0.0";

export interface SyncEvent {
  eventId: string;
  deviceId: string;
  sequence: number;
  taskId?: string;
  baseRevision?: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface ConflictRecord {
  id: string;
  taskId: string;
  localRevision: number;
  incomingRevision: number;
  localPayload: Record<string, unknown>;
  incomingPayload: Record<string, unknown>;
  detectedAt: string;
  resolved: boolean;
  resolution?: "accepted_incoming" | "kept_local" | "custom_merge";
}

import type { Task, TaskStatus } from "./task.ts";
import type { ActivityEvent } from "./events.ts";
import type { AgentInfo } from "./agent.ts";
import type { PatchRecord } from "../server/db/database.ts";

export const INTEGRATION_CONTRACT_VERSION = "UD-IC/1.0" as const;
export type Version = "UD-IC/1.0";
export type Command =
  | { type: "task.create"; payload: { clientTaskId: string; title: string; description?: string; ownerId?: string } }
  | { type: "task.transition"; taskId: string; baseRevision: number; payload: { targetStatus: TaskStatus; ownerId?: string; reason?: string } }
  | { type: "message.send"; payload: { messageId: string; text: string; taskId?: string; recipientDeviceId?: string } };
export type CommandEnvelope = Command & {
  contractVersion: Version; eventId: string; deviceId: string;
  sequence: number; createdAt: string;
};
export type LocalCommandRequest = Command; // service adds identity/time/sequence
export interface Message {
  id: string; eventId: string; senderDeviceId: string; text: string;
  taskId?: string; recipientDeviceId?: string; createdAt: string; receivedAt: string;
}
export interface CanonicalEvent extends ActivityEvent {
  contractVersion: Version; cursor: string; coordinatorEpoch: string;
  originEventId?: string; originDeviceId?: string; originSequence?: number;
}
export interface PushRequest { contractVersion: Version; deviceId: string; events: CommandEnvelope[] }
export interface Ack {
  eventId: string; deviceId: string; sequence: number;
  status: "applied" | "conflict" | "rejected" | "retry";
  duplicate: boolean; taskId?: string; revision?: number; conflictId?: string;
  canonicalEventIds: string[]; error?: ErrorV1;
}
export interface PushResponse {
  contractVersion: Version; acks: Ack[]; receivedThrough: number; serverTime: string;
}
export interface PullResponse {
  contractVersion: Version; events: CanonicalEvent[]; nextCursor: string;
  hasMore: boolean; serverTime: string;
}
export interface ConflictRecordV1 {
  contractVersion: Version; id: string; taskId: string; eventId: string;
  deviceId: string; baseRevision: number; currentRevision: number;
  proposed: Extract<Command, { type: "task.transition" }>;
  currentTask: Task; detectedAt: string; status: "open" | "resolved";
  resolutionRevision: number; resolvedAt?: string; resolvedBy?: string;
  resolution?: "keep_authoritative" | "retry_proposal" | "custom_transition";
  resultingTaskRevision?: number;
}
export interface ResolveRequest {
  resolution: "keep_authoritative" | "retry_proposal" | "custom_transition";
  expectedConflictRevision: number; expectedTaskRevision: number;
  transition?: { targetStatus: TaskStatus; ownerId?: string; reason: string };
  reason: string;
}
export interface ConflictPage { items: ConflictRecordV1[]; nextCursor?: string; hasMore: boolean }
export interface ErrorV1 {
  error: string; code: string; message: string; requestId: string; retryable: boolean;
  details?: { currentRevision?: number; baseRevision?: number; conflictId?: string;
    expectedSequence?: number; retryAfterMs?: number; [key: string]: unknown };
}
export interface LocalReceipt {
  eventId: string; deviceId: string; sequence: number;
  state: "queued" | "sending" | "applied" | "conflict" | "rejected";
  queuedAt: string; attempts: number; ack?: Ack; lastError?: ErrorV1;
}
export interface LocalHealth {
  contractVersion: Version; deviceId: string;
  coordinatorReachable: boolean; internetReachable: "unknown" | boolean;
  pendingCount: number; lastSyncAt?: string; lastError?: ErrorV1;
}
export interface LocalState {
  contractVersion: Version; deviceId: string; localCursor: string; remoteCursor?: string;
  cachedAt?: string; stale: boolean; tasks: Task[]; agents: AgentInfo[];
  events: CanonicalEvent[]; patches: PatchRecordV1[]; messages: Message[];
  conflicts: ConflictRecordV1[]; pending: LocalReceipt[]; health: LocalHealth;
}

export interface TestEvidence {
  id: string; runId: string; commandProfileId: string; startedAt: string; endedAt: string;
  exitCode: number | null; timedOut: boolean; passed: boolean;
  stdout: string; stderr: string; truncated: boolean; testedCommit?: string; treeHash: string;
}
export interface Checkpoint {
  id: string; taskId: string; runId: string; deviceId: string;
  baseCommit: string; taskRevision: number; stage: string; createdAt: string;
  artifactHash?: string; summary: string; recoveryCapability: "metadata_only";
}
export interface RunRecord {
  id: string; taskId: string; baseRevision: number; workspaceId: string;
  baseCommit: string; provider: "offline-heuristic-provider";
  status: "queued" | "running" | "review" | "completed" | "failed" | "blocked" | "cancelled" | "timeout";
  stage: "queued" | "baseline" | "repair" | "verification" | "review" | "finished";
  attempts: number; maxAttempts: number; cancellationRequested: boolean;
  createdAt: string; startedAt?: string; endedAt?: string;
  patchId?: string; evidence: TestEvidence[]; error?: ErrorV1;
}
export interface PatchRecordV1 extends PatchRecord {
  baseCommit?: string; taskRevision?: number; diffHash?: string;
  review?: { safe: boolean; score: number; reasons: string[]; touchedFiles: string[] };
  applicationStatus?: "not_applied" | "queued" | "applying" | "verified" | "failed" | "blocked";
  applicationId?: string; evidence?: TestEvidence[];
}
export interface ApplyRequest {
  expectedTaskRevision: number; expectedBaseCommit: string; expectedDiffHash: string;
  targetWorkspaceId: string; testProfileId: string;
}
export interface ApplicationRecord {
  id: string; patchId: string; taskId: string;
  status: "queued" | "applying" | "verified" | "failed" | "blocked";
  expectedBaseCommit: string; targetWorkspaceId: string; diffHash: string;
  requestedBy: string; requestedAt: string; startedAt?: string; endedAt?: string;
  commit?: string; evidence: TestEvidence[]; error?: ErrorV1;
}

export interface SyncGateway {
  // Owns one atomic coordinator DB transaction per event.
  process(event: CommandEnvelope, principal: Principal): Promise<Ack>;
  // Canonical durable journal, not timestamp history.
  pull(after: string | undefined, limit: number, principal: Principal): Promise<PullResponse>;
  listConflicts(status: "open" | "resolved", after?: string): Promise<ConflictPage>;
  resolve(id: string, input: ResolveRequest, principal: Principal): Promise<ConflictRecordV1>;
}
export interface Principal {
  id: string;
  deviceId: string;
  role: "device" | "reviewer" | "admin";
}
// Backend B exports createSyncRouter(gateway: SyncGateway, authenticate: middleware).
// Backend A mounts it at /api/sync and implements the gateway inside server/core/.
// A also owns coordinator-side inbox/log/conflict migrations in server/db/.
