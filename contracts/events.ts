/**
 * Canonical Event Contract
 * Protocol Version: 1.0 (Four-Agent Protocol) / Integration Baseline: UD-IC/1.0
 * Primary Owner: Role 1 — Core Backend & Coordinator
 */

export const EVENTS_CONTRACT_VERSION = "1.0.0";

export interface ActivityEvent {
  id: string;
  taskId?: string;
  source: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface CanonicalEvent extends ActivityEvent {
  contractVersion: "UD-IC/1.0";
  cursor: string;
  coordinatorEpoch: string;
  originEventId?: string;
  originDeviceId?: string;
  originSequence?: number;
}

export type EventCallback = (event: ActivityEvent | CanonicalEvent) => void;
