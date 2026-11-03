import { randomUUID } from "node:crypto";

export const INTEGRATION_CONTRACT = "UD-IC/1.0" as const;
import type { ErrorV1 } from "../../contracts/sync.ts";
export type { ErrorV1 } from "../../contracts/sync.ts";

export class ProtocolError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorV1["details"];
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, details?: ErrorV1["details"], retryable = false) {
    super(message); this.name = "ProtocolError"; this.status = status;
    this.code = code; this.details = details; this.retryable = retryable;
  }
  body(requestId = randomUUID()): ErrorV1 {
    const labels: Record<number, string> = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
      409: "Conflict", 410: "Gone", 413: "Payload Too Large", 422: "Unprocessable Entity", 426: "Upgrade Required", 503: "Service Unavailable" };
    return { error: labels[this.status] ?? "Internal Server Error", code: this.code, message: this.message,
      requestId, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) };
  }
}
