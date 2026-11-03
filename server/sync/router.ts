import { Router, json, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { Principal, SyncGateway, CommandEnvelope, Ack } from "../../contracts/sync.ts";
import { MAX_BODY, object, ProtocolError, safeError, uuid, validateEnvelope, validateResolve, VERSION } from "./protocol.ts";

/** A's middleware must set res.locals.principal from authenticated credentials, never request JSON. */
export function createSyncRouter(gateway: SyncGateway, authenticate: RequestHandler): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("X-UD-Contract", VERSION); res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(authenticate);
  router.use((req, _res, next) => { if (req.headers["x-ud-contract"] !== VERSION) next(new ProtocolError(426, "CONTRACT_MISMATCH", "Use UD-IC/1.0")); else next(); });
  router.use(json({ limit: MAX_BODY, strict: true }));
  const route = (fn: (req: Request, res: Response, principal: Principal) => Promise<void>): RequestHandler => (req, res, next) => {
    const principal = res.locals.principal as Principal | undefined;
    if (!principal) { next(new ProtocolError(401, "UNAUTHENTICATED", "Authentication required")); return; }
    if (typeof principal.id !== "string" || !["device", "reviewer", "admin"].includes(principal.role)) { next(new ProtocolError(403, "INVALID_PRINCIPAL", "Invalid authenticated principal")); return; }
    try { uuid(principal.deviceId); } catch { next(new ProtocolError(403, "INVALID_PRINCIPAL", "Principal device is not enrolled")); return; }
    void fn(req, res, principal).catch(next);
  };
  router.post("/push", route(async (req, res, principal) => {
    object(req.body);
    if (req.body.contractVersion !== VERSION) throw new ProtocolError(426, "CONTRACT_MISMATCH", "Use UD-IC/1.0");
    uuid(req.body.deviceId);
    if (req.body.deviceId !== principal.deviceId) throw new ProtocolError(403, "DEVICE_MISMATCH", "Device token does not match batch");
    if (!Array.isArray(req.body.events) || req.body.events.length < 1 || req.body.events.length > 100) throw new ProtocolError(400, "INVALID_BATCH", "Batch must contain 1..100 envelopes");
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new ProtocolError(413, "BODY_TOO_LARGE", "Batch exceeds 1 MiB");
    const events: CommandEnvelope[] = req.body.events;
    for (const event of events) { validateEnvelope(event); if (event.deviceId !== principal.deviceId) throw new ProtocolError(403, "DEVICE_MISMATCH", "Envelope belongs to another device"); }
    // The entire batch has now been validated; no gateway calls preceded validation.
    const acks: Ack[] = []; let blocked = false;
    for (const event of events) {
      if (blocked) break;
      try {
        const ack = await gateway.process(event, principal);
        if (ack.eventId !== event.eventId || ack.deviceId !== event.deviceId || ack.sequence !== event.sequence || !["applied", "conflict", "rejected", "retry"].includes(ack.status)) throw new ProtocolError(502, "INVALID_GATEWAY_ACK", "Gateway acknowledgement identity mismatch");
        acks.push(ack); blocked = ack.status === "retry";
      } catch (error) {
        const failure = safeError(error);
        if (!acks.length || failure.status < 500) throw failure;
        // Earlier commands already committed in A. Return those acks even if the next transaction fails.
        acks.push({ eventId: event.eventId, deviceId: event.deviceId, sequence: event.sequence, status: "retry", duplicate: false, canonicalEventIds: [], error: failure.body });
        blocked = true;
      }
    }
    // This is a conservative contiguous prefix confirmed by these acks; clients MUST match individual acks.
    let through = 0;
    for (const ack of acks) {
      if (ack.status === "retry") { if (ack.error?.code === "SEQUENCE_GAP" && Number.isSafeInteger(ack.error.details?.expectedSequence)) through = Math.max(through, ack.error!.details!.expectedSequence! - 1); break; }
      through = Math.max(through, ack.sequence);
    }
    res.json({ contractVersion: VERSION, acks, receivedThrough: through, serverTime: new Date().toISOString() });
  }));
  router.get("/pull", route(async (req, res, principal) => {
    const after = req.query.after;
    if (after !== undefined && (typeof after !== "string" || after.length > 2048)) throw new ProtocolError(400, "INVALID_CURSOR", "after must be one opaque cursor");
    const value = req.query.limit ?? "100";
    if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 200) throw new ProtocolError(400, "INVALID_LIMIT", "limit must be 1..200");
    res.json(await gateway.pull(after, Number(value), principal));
  }));
  router.get("/conflicts", route(async (req, res) => {
    const status = req.query.status ?? "open"; const after = req.query.after;
    if (status !== "open" && status !== "resolved") throw new ProtocolError(400, "INVALID_STATUS", "status must be open or resolved");
    if (after !== undefined && typeof after !== "string") throw new ProtocolError(400, "INVALID_CURSOR", "after must be one cursor");
    res.json(await gateway.listConflicts(status, after));
  }));
  router.post("/conflicts/:id/resolve", route(async (req, res, principal) => {
    if (principal.role !== "reviewer" && principal.role !== "admin") throw new ProtocolError(403, "REVIEWER_REQUIRED", "Reviewer or admin authorization required");
    uuid(req.params.id); validateResolve(req.body);
    res.json(await gateway.resolve(req.params.id, req.body, principal));
  }));
  router.use((_req, _res, next) => next(new ProtocolError(404, "NOT_FOUND", "Sync route not found")));
  router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    let failure = safeError(error);
    if (error?.type === "entity.too.large") failure = new ProtocolError(413, "BODY_TOO_LARGE", "Batch exceeds 1 MiB");
    else if (error?.type === "entity.parse.failed") failure = new ProtocolError(400, "INVALID_JSON", "Invalid JSON body");
    res.status(failure.status).json(failure.body);
  });
  return router;
}
