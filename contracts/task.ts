/**
 * Canonical Task Contract
 * Protocol Version: 1.0 (Four-Agent Protocol) / Integration Baseline: UD-IC/1.0
 * Primary Owner: Role 1 — Core Backend & Coordinator
 */

export const TASK_CONTRACT_VERSION = "1.0.0";
export const INTEGRATION_CONTRACT_VERSION = "UD-IC/1.0";

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

// ==========================================
// UD-IC/1.0 Specification Additions
// ==========================================

export interface Capabilities {
  contractVersion: "UD-IC/1.0";
  features: {
    sync: boolean;
    sseReplay: boolean;
    execution: boolean;
    patchApply: boolean;
    checkpointMetadata: boolean;
  };
  patchCompletionMode: "legacy_decision" | "verified_application";
}

export interface TestEvidence {
  id: string;
  runId: string;
  commandProfileId: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  timedOut: boolean;
  passed: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  testedCommit?: string;
  treeHash: string;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  runId: string;
  deviceId: string;
  baseCommit: string;
  taskRevision: number;
  stage: string;
  createdAt: string;
  artifactHash?: string;
  summary: string;
  recoveryCapability: "metadata_only";
}

export interface RunRecord {
  id: string;
  taskId: string;
  baseRevision: number;
  workspaceId: string;
  baseCommit: string;
  provider: "offline-heuristic-provider";
  status: "queued" | "running" | "review" | "completed" | "failed" | "blocked" | "cancelled" | "timeout";
  stage: "queued" | "baseline" | "repair" | "verification" | "review" | "finished";
  attempts: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  patchId?: string;
  evidence: TestEvidence[];
  error?: {
    error: string;
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}

export interface PatchRecordV1 {
  id: string;
  taskId: string;
  runId: string;
  status: "pending" | "approved" | "rejected";
  patchPath?: string;
  diffContent: string;
  testOutput?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewerId?: string;
  rejectionReason?: string;
  baseCommit?: string;
  taskRevision?: number;
  diffHash?: string;
  review?: {
    safe: boolean;
    score: number;
    reasons: string[];
    touchedFiles: string[];
  };
  applicationStatus?: "not_applied" | "queued" | "applying" | "verified" | "failed" | "blocked";
  applicationId?: string;
  evidence?: TestEvidence[];
}

export interface ApplyRequest {
  expectedTaskRevision: number;
  expectedBaseCommit: string;
  expectedDiffHash: string;
  targetWorkspaceId: string;
  testProfileId: string;
}

export interface ApplicationRecord {
  id: string;
  patchId: string;
  taskId: string;
  status: "queued" | "applying" | "verified" | "failed" | "blocked";
  expectedBaseCommit: string;
  targetWorkspaceId: string;
  diffHash: string;
  requestedBy: string;
  requestedAt: string;
  startedAt?: string;
  endedAt?: string;
  commit?: string;
  evidence: TestEvidence[];
  error?: {
    error: string;
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}
