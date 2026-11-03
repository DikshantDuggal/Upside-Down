/**
 * Canonical Task Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 1 — Core Backend & Coordinator
 */

export const TASK_CONTRACT_VERSION = "1.0.0";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "review"
  | "done"
  | "blocked"
  | "failed";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  ownerId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCreateRequest {
  title: string;
  description?: string;
  ownerId?: string;
}

export interface TaskTransitionRequest {
  targetStatus: TaskStatus;
  baseRevision: number;
  ownerId?: string;
  reason?: string;
}

export interface TaskTransitionResult {
  success: boolean;
  task?: Task;
  error?: string;
  currentRevision?: number;
}
