/**
 * Canonical Event Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
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

export type EventCallback = (event: ActivityEvent) => void;

/** Additive durable journal metadata; legacy wire fields remain unchanged. */
export interface CanonicalEvent extends ActivityEvent {
  contractVersion: "UD-IC/1.0";
  cursor: string;
  coordinatorEpoch: string;
  originEventId?: string;
  originDeviceId?: string;
  originSequence?: number;
}

export interface EventPage {
  contractVersion: "UD-IC/1.0";
  events: CanonicalEvent[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: string;
}
