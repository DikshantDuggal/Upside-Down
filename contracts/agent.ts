/**
 * Canonical Agent Execution Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 2 — AI Agent Execution Engine
 */

export const AGENT_CONTRACT_VERSION = "1.1.0";

export interface AgentRunRequest {
  runId: string;
  taskId: string;
  workspacePath: string;
  trigger: "test_failed" | "manual";
  testOutput?: string;
  failedTestName?: string;
}

export interface AgentRunResult {
  runId: string;
  status: "completed" | "failed" | "blocked" | "cancelled" | "timeout";
  patchPath?: string;
  diffContent?: string;
  testOutput?: string;
  verificationOutput?: string;
  error?: string;
  durationMs: number;
  attempts: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: "idle" | "running" | "offline" | "error";
  runtimeAvailable: boolean;
  currentTaskId?: string;
  lastSeenAt: string;
}

export interface WatcherConfig {
  watchDir: string;
  ignoredPatterns: string[];
  debounceMs: number;
  testCommand: string;
}

export interface RepairOptions {
  maxAttempts: number;
  timeoutMs: number;
  allowedExtensions: string[];
  worktreeDir?: string;
}

export interface ReviewVerdict {
  safe: boolean;
  score: number; // 0 to 100
  reasons: string[];
  touchedFiles: string[];
}
