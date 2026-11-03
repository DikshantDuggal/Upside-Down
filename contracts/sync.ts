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
