/**
 * Canonical Handoff Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 1 — Core Backend & Coordinator
 */

export const HANDOFF_CONTRACT_VERSION = "1.0.0";

export interface StructuredHandoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskId?: string;
  dependentTaskId?: string;
  handoffType: "task_completed" | "review_requested" | "blocked_dependency" | "context_sharing";
  summary: string;
  contractVersion: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HandoffCreateRequest {
  fromAgent: string;
  toAgent: string;
  taskId?: string;
  dependentTaskId?: string;
  handoffType?: "task_completed" | "review_requested" | "blocked_dependency" | "context_sharing";
  summary: string;
  payload?: Record<string, unknown>;
}
