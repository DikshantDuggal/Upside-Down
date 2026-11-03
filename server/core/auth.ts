import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { ActivityEvent } from "../../contracts/events.ts";
import type { CoordinatorDatabase } from "../db/database.ts";
import { ProtocolError } from "./protocolError.ts";

import type { Principal } from "../../contracts/sync.ts";
export type AuthenticatedPrincipal = Principal;
interface CredentialRecord { principal: AuthenticatedPrincipal; revoked: boolean; createdAt: string }
declare global { namespace Express { interface Request { principal?: AuthenticatedPrincipal } } }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export class AuthenticationService {
  private db: CoordinatorDatabase;
  constructor(db: CoordinatorDatabase) { this.db = db; }

  /** Local admin operation only. There is deliberately no enrollment HTTP route. */
  enroll(deviceId: string, role: AuthenticatedPrincipal["role"] = "device") {
    if (!uuid.test(deviceId) || !["device", "reviewer", "admin"].includes(role)) {
      throw new ProtocolError(422, "INVALID_ENROLLMENT", "Enrollment requires a UUIDv4 device and a known role");
    }
    const token = randomBytes(32).toString("base64url");
    const principal: AuthenticatedPrincipal = { id: randomUUID(), deviceId, role };
    this.db.insertRecord("credentials", hash(token), { principal, revoked: false, createdAt: new Date().toISOString() });
    return { token, principal };
  }

  authenticate(token: string | undefined): AuthenticatedPrincipal {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ProtocolError(401, "AUTH_REQUIRED", "A valid bearer credential is required");
    const record = this.db.readRecord<CredentialRecord>("credentials", hash(token));
    if (!record) throw new ProtocolError(401, "AUTH_REQUIRED", "A valid bearer credential is required");
    if (record.revoked) throw new ProtocolError(403, "CREDENTIAL_REVOKED", "This credential has been revoked");
    return structuredClone(record.principal);
  }

  /** Revocation is indexed by nonsecret principal ID; tokens are never stored. */
  revoke(principalId: string): void {
    this.db.transaction(() => {
      let after = "";
      for (;;) {
        const page = this.db.listRecords<CredentialRecord>("credentials", after);
        for (const { id, value } of page) if (value.principal.id === principalId) {
          this.db.putRecord("credentials", id, { ...value, revoked: true });
        }
        if (page.length < 1000) break;
        after = page.at(-1)!.id;
      }
    });
  }

  requireReviewer(principal: AuthenticatedPrincipal): void {
    if (principal.role !== "reviewer" && principal.role !== "admin") {
      throw new ProtocolError(403, "REVIEWER_REQUIRED", "A separate reviewer or admin credential is required");
    }
  }

  middleware(): RequestHandler {
    return (req, res, next) => {
      try {
        const authorization = req.get("Authorization");
        const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
        req.principal = this.authenticate(match?.[1]);
        res.locals.principal = req.principal;
        next();
      } catch (error) { next(error); }
    };
  }
}

export function canReadEvent(event: ActivityEvent, principal: AuthenticatedPrincipal): boolean {
  const message = event.payload.message;
  if (!message || typeof message !== "object") return true;
  const addressed = message as { senderDeviceId?: string; recipientDeviceId?: string };
  return !addressed.recipientDeviceId || principal.role === "admin"
    || addressed.senderDeviceId === principal.deviceId || addressed.recipientDeviceId === principal.deviceId;
}
