// Deliberately labeled test fixtures; never imported by production source.
import {
  CONTRACT,
  type ActivityEvent,
  type LocalState,
  type Patch,
  type Receipt,
  type Task,
  type TestEvidence,
} from "../src/api/types";
export const time = "2026-11-04T01:00:00.000Z";
export const task: Task = {
  id: "test-task",
  title: "TEST FIXTURE: Repair parser",
  description: "Only used in automated tests",
  status: "running",
  revision: 3,
  createdAt: time,
  updatedAt: time,
};
export const event: ActivityEvent = {
  id: "event-1",
  taskId: task.id,
  source: "test-fixture",
  type: "task_created",
  timestamp: time,
  payload: { title: task.title },
};
export const receipt: Receipt = {
  eventId: "command-1",
  deviceId: "device-1",
  sequence: 1,
  state: "queued",
  queuedAt: time,
  attempts: 0,
};
export const patch: Patch = {
  id: "patch-1",
  taskId: task.id,
  runId: "run-1",
  status: "pending",
  diffContent:
    "--- a/src/parser.ts\n+++ b/src/parser.ts\n@@ -1 +1 @@\n-return 0;\n+return 1;\n+<script>window.TEST_XSS = true</script>",
  testOutput: "PASS (unverified legacy text)",
  createdAt: time,
};
export const evidence: TestEvidence = {
  id: "evidence-1",
  runId: "run-1",
  commandProfileId: "fixture-tests",
  startedAt: time,
  endedAt: time,
  exitCode: 0,
  timedOut: false,
  passed: true,
  stdout: "1 test passed",
  stderr: "",
  truncated: false,
  treeHash: "a".repeat(40),
  testedCommit: "b".repeat(40),
};
export const localState: LocalState = {
  contractVersion: CONTRACT,
  deviceId: "device-1",
  localCursor: "local:3",
  remoteCursor: "epoch:2",
  cachedAt: time,
  stale: false,
  tasks: [task],
  agents: [
    {
      id: "agent-1",
      name: "TEST FIXTURE: Heuristic worker",
      status: "idle",
      runtimeAvailable: true,
      lastSeenAt: time,
    },
  ],
  events: [
    {
      ...event,
      contractVersion: CONTRACT,
      cursor: "epoch:2",
      coordinatorEpoch: "epoch",
    },
  ],
  patches: [patch],
  messages: [],
  conflicts: [],
  pending: [],
  health: {
    contractVersion: CONTRACT,
    deviceId: "device-1",
    coordinatorReachable: true,
    internetReachable: "unknown",
    pendingCount: 0,
  },
};
export const capabilities = {
  contractVersion: CONTRACT,
  features: {
    sync: true,
    sseReplay: false,
    execution: false,
    patchApply: false,
    checkpointMetadata: false,
  },
  patchCompletionMode: "legacy_decision",
};
export const conflict = {
  contractVersion: CONTRACT,
  id: "conflict-1",
  taskId: task.id,
  eventId: "stale-proposal",
  deviceId: "device-2",
  baseRevision: 2,
  currentRevision: 3,
  proposed: {
    type: "task.transition" as const,
    taskId: task.id,
    baseRevision: 2,
    payload: { targetStatus: "review" as const },
  },
  currentTask: task,
  detectedAt: time,
  status: "open" as const,
  resolutionRevision: 1,
};
export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-UD-Contract": CONTRACT,
      ...headers,
    },
  });
