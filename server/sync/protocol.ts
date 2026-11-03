import { createHash, randomUUID } from "node:crypto";
import type { Command, CommandEnvelope, ErrorV1, ResolveRequest } from "../../contracts/sync.ts";

export const VERSION = "UD-IC/1.0";
export const MAX_BODY = 1024 * 1024;
const statuses = new Set(["pending", "assigned", "running", "review", "done", "blocked", "failed"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProtocolError extends Error {
  status: number;
  body: ErrorV1;
  constructor(status: number, code: string, message: string, details?: ErrorV1["details"]) {
    super(message);
    this.status = status;
    this.body = { error: code, code, message, requestId: randomUUID(), retryable: status === 429 || status >= 500, ...(details ? { details } : {}) };
  }
}

export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProtocolError(400, "INVALID_BODY", "Expected a JSON object");
}
export function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new ProtocolError(400, "INVALID_UUID", "Expected a UUID");
}
export function positive(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ProtocolError(400, "INVALID_INTEGER", "Expected a positive safe integer");
}
function string(value: unknown, max: number, required = true) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new ProtocolError(400, "INVALID_STRING", `Expected a string with length 1..${max}`);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ProtocolError(400, "UNKNOWN_FIELD", "Unexpected request field");
}
function optional(value: Record<string, unknown>, key: string, max: number) {
  if (value[key] !== undefined) string(value[key], max, false);
}

export function validateCommand(value: unknown, envelope = false): asserts value is Command {
  object(value);
  const common = envelope ? ["contractVersion", "eventId", "deviceId", "sequence", "createdAt"] : [];
  object(value.payload);
  const p = value.payload;
  switch (value.type) {
    case "task.create":
      keys(value, [...common, "type", "payload"]); keys(p, ["clientTaskId", "title", "description", "ownerId"]);
      uuid(p.clientTaskId); string(p.title, 200); optional(p, "description", 16384); optional(p, "ownerId", 200); break;
    case "task.transition":
      keys(value, [...common, "type", "payload", "taskId", "baseRevision"]); keys(p, ["targetStatus", "ownerId", "reason"]);
      uuid(value.taskId); positive(value.baseRevision);
      if (!statuses.has(p.targetStatus as string)) throw new ProtocolError(400, "INVALID_STATUS", "Unknown task status");
      optional(p, "ownerId", 200); optional(p, "reason", 2048); break;
    case "message.send":
      keys(value, [...common, "type", "payload"]); keys(p, ["messageId", "text", "taskId", "recipientDeviceId"]);
      uuid(p.messageId); string(p.text, 4096);
      if (Buffer.byteLength(p.text as string) > 4096) throw new ProtocolError(413, "MESSAGE_TOO_LARGE", "Message exceeds 4096 UTF-8 bytes");
      if (p.taskId !== undefined) uuid(p.taskId);
      if (p.recipientDeviceId !== undefined) uuid(p.recipientDeviceId); break;
    default: throw new ProtocolError(400, "UNKNOWN_COMMAND", "Unsupported command type");
  }
}

export function validateEnvelope(value: unknown): asserts value is CommandEnvelope {
  validateCommand(value, true);
  const e = value as unknown as Record<string, unknown>;
  if (e.contractVersion !== VERSION) throw new ProtocolError(426, "CONTRACT_MISMATCH", "Use UD-IC/1.0");
  uuid(e.eventId); uuid(e.deviceId); positive(e.sequence);
  if (typeof e.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(e.createdAt) || !Number.isFinite(Date.parse(e.createdAt))) throw new ProtocolError(400, "INVALID_TIME", "createdAt must be an ISO timestamp");
}

export function validateResolve(value: unknown): asserts value is ResolveRequest {
  object(value); keys(value, ["resolution", "expectedConflictRevision", "expectedTaskRevision", "transition", "reason"]);
  positive(value.expectedConflictRevision); positive(value.expectedTaskRevision); string(value.reason, 2048);
  if (!["keep_authoritative", "retry_proposal", "custom_transition"].includes(value.resolution as string)) throw new ProtocolError(400, "INVALID_RESOLUTION", "Unknown resolution");
  if (value.resolution === "custom_transition") {
    object(value.transition); keys(value.transition, ["targetStatus", "ownerId", "reason"]);
    if (!statuses.has(value.transition.targetStatus as string)) throw new ProtocolError(400, "INVALID_STATUS", "Unknown target status");
    string(value.transition.reason, 2048); optional(value.transition, "ownerId", 200);
  } else if (value.transition !== undefined) throw new ProtocolError(400, "INVALID_RESOLUTION", "transition is only allowed for custom_transition");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
export function bodyHash(value: unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function safeError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  if (error && typeof error === "object") {
    const err = error as any;
    if (err.code === "CURSOR_EXPIRED") {
      return new ProtocolError(410, "CURSOR_EXPIRED", err.message || "Cursor has expired");
    }
  }
  return new ProtocolError(500, "INTERNAL_ERROR", "The operation could not be completed");
}
