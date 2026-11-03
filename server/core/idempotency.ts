import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { CoordinatorDatabase } from "../db/database.ts";
import { ProtocolError } from "./protocolError.ts";

export const requestIdentity = new AsyncLocalStorage<{ key?: string }>();
export function canonicalHash(input: unknown): string {
  const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])])) : value;
  return createHash("sha256").update(JSON.stringify(normalize(input)), "utf8").digest("hex");
}

export class IdempotencyStore {
  private db: CoordinatorDatabase;
  constructor(db: CoordinatorDatabase) { this.db = db; }
  lookup<T>(scope: string, key: string, body: unknown): { result: T } | undefined {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new ProtocolError(400, "INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key");
    const prior = this.db.readRecord<{ hash: string; result: T }>("idempotency", canonicalHash([scope, key]));
    if (prior && prior.hash !== canonicalHash(body)) throw new ProtocolError(409, "IDEMPOTENCY_KEY_REUSE", "Idempotency key was used with different content");
    return prior ? { result: prior.result } : undefined;
  }
  execute<T>(scope: string, key: string | undefined, body: unknown, operation: () => T): T {
    if (key === undefined) return this.db.transaction(operation);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new ProtocolError(400, "INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key");
    return this.db.transaction(() => {
      const id = canonicalHash([scope, key]);
      const hash = canonicalHash(body);
      const prior = this.db.readRecord<{ hash: string; result: T }>("idempotency", id);
      if (prior) {
        if (prior.hash !== hash) throw new ProtocolError(409, "IDEMPOTENCY_KEY_REUSE", "Idempotency key was used with different content");
        return prior.result;
      }
      const result = operation();
      this.db.insertRecord("idempotency", id, { hash, result });
      return result;
    });
  }
}
