/**
 * Canonical Agent Execution Contract
 * Protocol Version: 1.0 (Four-Agent Protocol)
 * Primary Owner: Role 2 — AI Agent Execution Engine
 */

export const AGENT_CONTRACT_VERSION = "1.0.0";

export interface AgentRunRequest {
  runId: string;
  taskId: string;
  workspacePath: string;
  trigger: "test_failed" | "manual";
}

export interface AgentRunResult {
  runId: string;
  status: "completed" | "failed" | "blocked";
  patchPath?: string;
  testOutput?: string;
  error?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: "idle" | "running" | "offline" | "error";
  runtimeAvailable: boolean;
  currentTaskId?: string;
  lastSeenAt: string;
}
