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
