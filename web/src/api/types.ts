import { z } from "zod";

// Frontend runtime mapping of contract.md UD-IC/1.0. Shared backend files stay read-only.
export const CONTRACT = "UD-IC/1.0" as const;
const text = z.string();
const instant = z.iso.datetime({ offset: true });
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const taskStatuses = [
  "pending",
  "assigned",
  "running",
  "review",
  "done",
  "blocked",
  "failed",
] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export const taskSchema = z.object({
  id: text.min(1),
  title: text,
  description: text.optional(),
  status: taskStatusSchema,
  ownerId: text.optional(),
  revision,
  createdAt: instant,
  updatedAt: instant,
});
export const agentSchema = z.object({
  id: text.min(1),
  name: text,
  status: z.enum(["idle", "running", "offline", "error"]),
  runtimeAvailable: z.boolean(),
  currentTaskId: text.optional(),
  lastSeenAt: instant,
});
export const eventSchema = z.object({
  id: text.min(1),
  taskId: text.optional(),
  source: text,
  type: text,
  timestamp: instant,
  payload: z.record(text, z.unknown()),
  contractVersion: z.literal(CONTRACT).optional(),
  cursor: text.optional(),
  coordinatorEpoch: text.optional(),
  originEventId: text.optional(),
  originDeviceId: text.optional(),
  originSequence: revision.optional(),
});
export const errorSchema = z.object({
  error: text,
  code: text,
  message: text,
  requestId: text,
  retryable: z.boolean(),
  details: z.record(text, z.unknown()).optional(),
});
export const evidenceSchema = z.object({
  id: text,
  runId: text,
  commandProfileId: text,
  startedAt: instant,
  endedAt: instant,
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  passed: z.boolean(),
  stdout: text,
  stderr: text,
  truncated: z.boolean(),
  testedCommit: text.optional(),
  treeHash: text,
});
export const patchSchema = z.object({
  id: text.min(1),
  taskId: text,
  runId: text,
  status: z.enum(["pending", "approved", "rejected"]),
  patchPath: text.optional(),
  diffContent: text,
  testOutput: text.optional(),
  createdAt: instant,
  reviewedAt: instant.optional(),
  reviewerId: text.optional(),
  rejectionReason: text.optional(),
  baseCommit: text.optional(),
  taskRevision: revision.optional(),
  diffHash: text.optional(),
  review: z
    .object({
      safe: z.boolean(),
      score: z.number(),
      reasons: z.array(text),
      touchedFiles: z.array(text),
    })
    .optional(),
  applicationStatus: z
    .enum([
      "not_applied",
      "queued",
      "applying",
      "verified",
      "failed",
      "blocked",
    ])
    .optional(),
  applicationId: text.optional(),
  evidence: z.array(evidenceSchema).optional(),
});
export const ackSchema = z.object({
  eventId: text,
  deviceId: text,
  sequence: revision,
  status: z.enum(["applied", "conflict", "rejected", "retry"]),
  duplicate: z.boolean(),
  taskId: text.optional(),
  revision: revision.optional(),
  conflictId: text.optional(),
  canonicalEventIds: z.array(text),
  error: errorSchema.optional(),
});
export const receiptSchema = z.object({
  eventId: text,
  deviceId: text,
  sequence: revision,
  state: z.enum(["queued", "sending", "applied", "conflict", "rejected"]),
  queuedAt: instant,
  attempts: z.number().int().nonnegative(),
  ack: ackSchema.optional(),
  lastError: errorSchema.optional(),
});
export const transitionCommandSchema = z.object({
  type: z.literal("task.transition"),
  taskId: text,
  baseRevision: revision,
  payload: z.object({
    targetStatus: taskStatusSchema,
    ownerId: text.optional(),
    reason: text.max(2048).optional(),
  }),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task.create"),
    payload: z.object({
      clientTaskId: z.uuid(),
      title: text.trim().min(1).max(200),
      description: text.max(16384).optional(),
      ownerId: text.optional(),
    }),
  }),
  transitionCommandSchema,
  z.object({
    type: z.literal("message.send"),
    payload: z.object({
      messageId: z.uuid(),
      text: text
        .min(1)
        .refine(
          (v) => new TextEncoder().encode(v).length <= 4096,
          "Message exceeds 4096 UTF-8 bytes",
        ),
      taskId: text.optional(),
      recipientDeviceId: text.optional(),
    }),
  }),
]);
export const conflictSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  id: text,
  taskId: text,
  eventId: text,
  deviceId: text,
  baseRevision: revision,
  currentRevision: revision,
  proposed: transitionCommandSchema,
  currentTask: taskSchema,
  detectedAt: instant,
  status: z.enum(["open", "resolved"]),
  resolutionRevision: revision,
  resolvedAt: instant.optional(),
  resolvedBy: text.optional(),
  resolution: z
    .enum(["keep_authoritative", "retry_proposal", "custom_transition"])
    .optional(),
  resultingTaskRevision: revision.optional(),
});
export const messageSchema = z.object({
  id: text,
  eventId: text,
  senderDeviceId: text,
  text,
  taskId: text.optional(),
  recipientDeviceId: text.optional(),
  createdAt: instant,
  receivedAt: instant,
});
export const localHealthSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  deviceId: text,
  coordinatorReachable: z.boolean(),
  internetReachable: z.union([z.literal("unknown"), z.boolean()]),
  pendingCount: z.number().int().nonnegative(),
  lastSyncAt: instant.optional(),
  lastError: errorSchema.optional(),
});
export const localStateSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  deviceId: text,
  localCursor: text,
  remoteCursor: text.optional(),
  cachedAt: instant.optional(),
  stale: z.boolean(),
  tasks: z.array(taskSchema),
  agents: z.array(agentSchema),
  events: z.array(
    eventSchema.extend({
      contractVersion: z.literal(CONTRACT),
      cursor: text,
      coordinatorEpoch: text,
    }),
  ),
  patches: z.array(patchSchema),
  messages: z.array(messageSchema),
  conflicts: z.array(conflictSchema),
  pending: z.array(receiptSchema),
  health: localHealthSchema,
});
export const capabilitiesSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  features: z.object({
    sync: z.boolean(),
    sseReplay: z.boolean(),
    execution: z.boolean(),
    patchApply: z.boolean(),
    checkpointMetadata: z.boolean(),
  }),
  patchCompletionMode: z.enum(["legacy_decision", "verified_application"]),
});
export const healthSchema = z.object({
  status: z.literal("ok"),
  timestamp: instant,
});
export const runSchema = z.object({
  id: text,
  taskId: text,
  baseRevision: revision,
  workspaceId: text,
  baseCommit: text,
  provider: z.literal("offline-heuristic-provider"),
  status: z.enum([
    "queued",
    "running",
    "review",
    "completed",
    "failed",
    "blocked",
    "cancelled",
    "timeout",
  ]),
  stage: z.enum([
    "queued",
    "baseline",
    "repair",
    "verification",
    "review",
    "finished",
  ]),
  attempts: z.number().int().nonnegative(),
  maxAttempts: revision,
  cancellationRequested: z.boolean(),
  createdAt: instant,
  startedAt: instant.optional(),
  endedAt: instant.optional(),
  patchId: text.optional(),
  evidence: z.array(evidenceSchema),
  error: errorSchema.optional(),
});
export const applicationSchema = z.object({
  id: text,
  patchId: text,
  taskId: text,
  status: z.enum(["queued", "applying", "verified", "failed", "blocked"]),
  expectedBaseCommit: text,
  targetWorkspaceId: text,
  diffHash: text,
  requestedBy: text,
  requestedAt: instant,
  startedAt: instant.optional(),
  endedAt: instant.optional(),
  commit: text.optional(),
  evidence: z.array(evidenceSchema),
  error: errorSchema.optional(),
});
export const checkpointSchema = z.object({
  id: text,
  taskId: text,
  runId: text,
  deviceId: text,
  baseCommit: text,
  taskRevision: revision,
  stage: text,
  createdAt: instant,
  artifactHash: text.optional(),
  summary: text,
  recoveryCapability: z.literal("metadata_only"),
});
export type Task = z.infer<typeof taskSchema>;
export type TaskStatus = Task["status"];
export type Agent = z.infer<typeof agentSchema>;
export type ActivityEvent = z.infer<typeof eventSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type TestEvidence = z.infer<typeof evidenceSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Command = z.infer<typeof commandSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
export type LocalState = z.infer<typeof localStateSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type Run = z.infer<typeof runSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Message = z.infer<typeof messageSchema>;
export interface ResolveRequest {
  resolution: "keep_authoritative" | "retry_proposal" | "custom_transition";
  expectedConflictRevision: number;
  expectedTaskRevision: number;
  transition?: { targetStatus: TaskStatus; ownerId?: string; reason: string };
  reason: string;
}
export const transitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ["assigned", "blocked", "running"],
  assigned: ["running", "blocked", "pending"],
  running: ["review", "failed", "blocked"],
  review: ["running", "failed"],
  blocked: ["pending", "assigned", "running"],
  failed: ["pending", "running"],
  done: [],
};
