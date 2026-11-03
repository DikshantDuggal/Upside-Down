import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LocalStore, type Change } from "./store.ts";
import { CoordinatorClient, SyncWorker } from "./transport.ts";
import { MAX_BODY, object, ProtocolError, safeError, uuid, VERSION } from "../../server/sync/protocol.ts";

export type LocalOptions = { store: LocalStore; client?: CoordinatorClient; reviewerClient?: CoordinatorClient; pairingKey: string; port?: number; allowedOrigins?: string[]; startWorker?: boolean };

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new ProtocolError(415, "JSON_REQUIRED", "Use Content-Type application/json");
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ProtocolError(413, "BODY_TOO_LARGE", "Body exceeds 1 MiB");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProtocolError(400, "INVALID_JSON", "Invalid JSON body"); }
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-UD-Contract": VERSION, "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
function same(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }


function validateCollaboration(route: string, body: Record<string, unknown>) {
  const project = route === "/api/projects";
  const allowed = project ? ["id", "name", "description"] : ["fromAgent", "toAgent", "taskId", "dependentTaskId", "handoffType", "summary", "payload"];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ProtocolError(400, "UNKNOWN_FIELD", "Unexpected collaboration field");
  const text = (value: unknown, max: number, required = true) => {
    if (value === undefined && !required) return;
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new ProtocolError(400, "INVALID_STRING", "Invalid collaboration text length");
  };
  if (project) { text(body.name, 200); text(body.description, 16384, false); if (body.id !== undefined) uuid(body.id); }
  else {
    text(body.fromAgent, 200); text(body.toAgent, 200); text(body.summary, 2048);
    for (const field of ["taskId", "dependentTaskId"]) if (body[field] !== undefined) uuid(body[field]);
    if (body.handoffType !== undefined && !["task_completed", "review_requested", "blocked_dependency", "context_sharing"].includes(body.handoffType as string)) throw new ProtocolError(400, "INVALID_HANDOFF_TYPE", "Unknown handoff type");
    if (body.payload !== undefined) { object(body.payload); if (Buffer.byteLength(JSON.stringify(body.payload)) > 32768) throw new ProtocolError(413, "PAYLOAD_TOO_LARGE", "Handoff context exceeds 32768 bytes"); }
  }
}

/** Exact route allowlist. There is no URL supplied by the browser and no arbitrary forwarding target. */
export function readProxyPath(url: URL): string | undefined {
  const path = url.pathname;
  const list = new Map<string, string[]>([["/api/health", []], ["/api/capabilities", []], ["/api/projects", []], ["/api/handoffs", ["toAgent", "taskId"]], ["/api/tasks", ["status"]], ["/api/agents", []], ["/api/events", ["taskId", "since", "limit"]], ["/api/events/stream", ["after", "contractVersion"]], ["/api/sync/conflicts", ["status", "after"]]]);
  let allowed = list.get(path);
  if (!allowed) {
    if (/^\/api\/projects\/[^/]+$/.test(path)) { if (url.search) throw new ProtocolError(400, 'INVALID_QUERY', 'Project detail does not accept query parameters'); uuid(path.split('/').at(-1)); return path; }
    const match = path.match(/^\/api\/(tasks|patches|runs|applications)\/([^/]+)(?:\/(patches|checkpoints))?$/);
    if (!match || (match[3] && match[1] !== "tasks")) return undefined;
    uuid(match[2]); allowed = [];
  }
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ProtocolError(400, "INVALID_QUERY", "Unsupported or repeated query parameter");
  if (url.searchParams.has("toAgent") && (url.searchParams.get("toAgent")!.length > 200 || !url.searchParams.get("toAgent")!.trim())) throw new ProtocolError(400, "INVALID_QUERY", "Invalid recipient agent");
  if (url.searchParams.has("taskId")) uuid(url.searchParams.get("taskId"));
  if (url.searchParams.has("limit") && (!/^\d+$/.test(url.searchParams.get("limit")!) || Number(url.searchParams.get("limit")) < 1 || Number(url.searchParams.get("limit")) > 200)) throw new ProtocolError(400, "INVALID_QUERY", "limit must be 1..200");
  if (url.searchParams.has("status")) {
    const choices = path === "/api/sync/conflicts" ? ["open", "resolved"] : ["pending", "assigned", "running", "review", "done", "blocked", "failed"];
    if (!choices.includes(url.searchParams.get("status")!)) throw new ProtocolError(400, "INVALID_QUERY", "Unknown status");
  }
  url.searchParams.sort(); return path + url.search;
}

export async function createLocalService(options: LocalOptions) {
  const { store, client } = options;
  if (options.pairingKey.length < 32) throw new Error("Local pairing key must contain at least 32 characters");
  if (client && options.reviewerClient && (client.token === options.reviewerClient.token || client.base.origin !== options.reviewerClient.base.origin)) throw new Error("Reviewer requires a separate credential for the same coordinator");
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const sockets = new Set<ServerResponse>();
  const worker = client ? new SyncWorker(store, client) : undefined;
  let origin = "";
  let origins = new Set(options.allowedOrigins ?? []);
  const server = createServer(async (req, res) => {
    res.setHeader("X-UD-Contract", VERSION); res.setHeader("Cache-Control", "no-store");
    try {
      if (!req.url || !req.headers.host || ![...origins].some(o => new URL(o).host === req.headers.host)) throw new ProtocolError(403, "HOST_FORBIDDEN", "Host is not allowed");
      if (req.headers.origin && !origins.has(req.headers.origin)) throw new ProtocolError(403, "ORIGIN_FORBIDDEN", "Origin is not allowed");
      if (req.headers["sec-fetch-site"] === "cross-site") throw new ProtocolError(403, "ORIGIN_FORBIDDEN", "Cross-site requests are forbidden");
      const url = new URL(req.url, origin);
      const isStream = url.pathname.endsWith("/stream");
      if ((isStream ? (req.headers["x-ud-contract"] ?? url.searchParams.get("contractVersion")) : req.headers["x-ud-contract"]) !== VERSION) throw new ProtocolError(426, "CONTRACT_MISMATCH", "Use X-UD-Contract: UD-IC/1.0");
      const write = !["GET", "HEAD"].includes(req.method ?? "");
      if (write && !req.headers.origin) throw new ProtocolError(403, "ORIGIN_REQUIRED", "Local writes require an allowed Origin");
      if (url.pathname === "/local/session" && req.method === "POST") {
        const input = await readJson(req); object(input);
        if (typeof input.pairingKey !== "string" || !same(input.pairingKey, options.pairingKey)) throw new ProtocolError(401, "PAIRING_REQUIRED", "Invalid local pairing key");
        const now = Date.now(); for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
        if (sessions.size >= 64) throw new ProtocolError(429, "SESSION_LIMIT", "Too many local sessions");
        const sid = randomBytes(32).toString("hex"); const csrf = randomBytes(32).toString("hex");
        sessions.set(sid, { csrf, expires: now + 12 * 60 * 60 * 1000 });
        res.setHeader("Set-Cookie", `ud_local=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers.origin?.startsWith("https://") ? "; Secure" : ""}`);
        json(res, 200, { contractVersion: VERSION, csrfToken: csrf }); return;
      }
      const sid = (req.headers.cookie ?? "").split(";").map(c => c.trim()).find(c => c.startsWith("ud_local="))?.slice(9);
      const session = sid ? sessions.get(sid) : undefined;
      if (!session || session.expires < Date.now()) throw new ProtocolError(401, "LOCAL_SESSION_REQUIRED", "Pair this browser with the local service");
      if (write && (typeof req.headers["x-csrf-token"] !== "string" || !same(req.headers["x-csrf-token"], session.csrf))) throw new ProtocolError(403, "CSRF_REQUIRED", "Valid X-CSRF-Token required");
      if (url.pathname === "/local/session" && req.method === "GET") { json(res, 200, { contractVersion: VERSION, csrfToken: session.csrf }); return; }
      if (url.pathname === "/local/authorization" && req.method === "GET") {
        // Never infer authority from pairing, a configured filename or cached capabilities.
        let authorization = { role: "device", canReview: false };
        if (options.reviewerClient) {
          try {
            const capabilities = await options.reviewerClient.request("/api/capabilities");
            const verified = capabilities?.authorization;
            if (capabilities?.contractVersion === VERSION && verified?.canReview === true && ["reviewer", "admin"].includes(verified.role)) {
              authorization = { role: verified.role, canReview: true };
            }
          } catch { /* Unreachable, revoked or malformed authority cannot grant browser rights. */ }
        }
        json(res, 200, { contractVersion: VERSION, authorization }); return;
      }
      if (url.pathname === "/local/health" && req.method === "GET") { json(res, 200, store.health()); return; }
      if (url.pathname === "/local/state" && req.method === "GET") { json(res, 200, store.state()); return; }
      if (url.pathname === "/local/commands" && req.method === "POST") {
        const input = await readJson(req);
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string") throw new ProtocolError(400, "IDEMPOTENCY_KEY_REQUIRED", "Use Idempotency-Key");
        json(res, 202, store.enqueue(input, store.deviceId, key)); return;
      }
      if (url.pathname.startsWith("/local/commands/") && req.method === "GET") { const id = url.pathname.slice(16); uuid(id); json(res, 200, store.lookup(id)); return; }
      if (url.pathname === "/local/events/stream" && req.method === "GET") {
        const after = url.searchParams.get("after") ?? (typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : store.cursor());
        const replay = store.changesAfter(after);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        if (!replay || replay.length > 1000) { res.end('event: reset\ndata: {"reason":"CURSOR_EXPIRED"}\n\n'); return; }
        sockets.add(res);
        const send = (change: Change) => { if (!res.write(`id: ${change.localCursor}\nevent: local_change\ndata: ${JSON.stringify(change)}\n\n`)) res.destroy(); };
        // Database reads and listener registration are synchronous in one event loop turn.
        store.listeners.add(send); for (const change of replay) send(change);
        res.write(": connected\n\n");
        const timer = setInterval(() => { if (Date.now() >= session.expires) res.end(); else if (!res.write(": keepalive\n\n")) res.destroy(); }, 15000); timer.unref();
        res.on("close", () => { clearInterval(timer); store.listeners.delete(send); sockets.delete(res); }); return;
      }
      if (req.method === "GET") {
        const path = readProxyPath(url);
        if (path) {
          if (url.pathname === "/api/events/stream") {
            if (!client) throw new ProtocolError(503, "COORDINATOR_UNREACHABLE", "Coordinator is not configured");
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), client.timeoutMs); timer.unref();
            const close = () => abort.abort(); res.on("close", close);
            let expiry: ReturnType<typeof setTimeout> | undefined;
            try {
              const upstream = await fetch(new URL(path, client.base), { redirect: "error", signal: abort.signal,
                headers: { Authorization: `Bearer ${client.token}`, "X-UD-Contract": VERSION,
                  ...(typeof req.headers["last-event-id"] === "string" ? { "Last-Event-ID": req.headers["last-event-id"] } : {}) } });
              clearTimeout(timer);
              if (!upstream.ok) { await upstream.body?.cancel(); throw new ProtocolError(upstream.status, `UPSTREAM_${upstream.status}`, "Coordinator stream unavailable"); }
              if (!upstream.headers.get("Content-Type")?.startsWith("text/event-stream") || !upstream.body) { await upstream.body?.cancel(); throw new ProtocolError(502, "INVALID_STREAM", "Coordinator did not return an event stream"); }
              res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
              sockets.add(res); expiry = setTimeout(() => { res.end(); abort.abort(); }, Math.max(1, session.expires - Date.now())); expiry.unref();
              // Forward frames and IDs unchanged; this makes no additional remote replay guarantee.
              await pipeline(Readable.fromWeb(upstream.body as any), res);
            } catch (error) { if (res.headersSent) res.destroy(); else throw error instanceof ProtocolError ? error : new ProtocolError(503, "COORDINATOR_UNREACHABLE", "Coordinator stream disconnected"); }
            finally { clearTimeout(timer); clearTimeout(expiry); res.off("close", close); sockets.delete(res); abort.abort(); }
            return;
          }
          if (client) {
            try { const body = await client.request(path); store.cacheWrite(path, body); json(res, 200, body); return; }
            catch (error) {
              if (!(error instanceof ProtocolError) || ![500, 502, 503, 504].includes(error.status)) throw error;
            }
          }
          let cached = store.cacheRead(path);
          if (!cached && url.pathname === "/api/tasks") { let tasks = store.entities("tasks"); if (url.searchParams.has("status")) tasks = tasks.filter(t => t.status === url.searchParams.get("status")); if (store.get("cachedAt")) cached = { body: tasks, cachedAt: store.get("cachedAt")! }; }
          if (!cached && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) { const task = store.entities("tasks").find(t => t.id === url.pathname.split("/").at(-1)); if (task) cached = { body: task, cachedAt: store.get("cachedAt")! }; }
          if (!cached) throw new ProtocolError(503, "CACHE_MISS", "Coordinator unavailable and this read is not cached");
          res.setHeader("X-UD-Stale", "true"); res.setHeader("X-UD-Cached-At", cached.cachedAt); json(res, 200, cached.body); return;
        }
      }
      if (req.method === "POST") {
        const registry = url.pathname === "/api/agents/register";
        const collaboration = url.pathname === "/api/projects" || url.pathname === "/api/handoffs";
        const action = url.pathname.match(/^\/api\/(?:patches\/([^/]+)\/(approve|reject|apply)|tasks\/([^/]+)\/runs|runs\/([^/]+)\/cancel|sync\/conflicts\/([^/]+)\/resolve)$/);
        if (registry || collaboration || action) {
          if (url.search) throw new ProtocolError(400, "INVALID_QUERY", "Online action routes do not accept query parameters");
          if (action) uuid(action[1] ?? action[3] ?? action[4] ?? action[5]);
          const deviceAction = registry || collaboration;
          const online = deviceAction ? client : options.reviewerClient;
          if (!online) throw new ProtocolError(503, deviceAction ? "COORDINATOR_UNREACHABLE" : "REVIEWER_SESSION_UNAVAILABLE", deviceAction ? "Coordinator is not configured" : "A separately enrolled reviewer credential must be configured for this local service");
          const input = await readJson(req); object(input);
          if (collaboration) validateCollaboration(url.pathname, input);
          const key = req.headers["idempotency-key"];
          if (typeof key !== "string" || !key || key.length > 200) throw new ProtocolError(400, "IDEMPOTENCY_KEY_REQUIRED", "Online writes require a stable Idempotency-Key");
          // Exactly one attempt. Ambiguous failures stay online-only and must be reconciled with A.
          const result = await online.requestResult(url.pathname, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(input) });
          if (collaboration) store.invalidateCollaborationReads();
          json(res, result.status, result.body); return;
        }
      }
      throw new ProtocolError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const failure = safeError(error); if (failure.status === 429) res.setHeader("Retry-After", "30"); json(res, failure.status, failure.body);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 64;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 4100, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  origins = new Set([origin, ...(options.allowedOrigins ?? [])]);
  if (options.startWorker !== false) worker?.start();
  return { server, origin, worker, async close() { await worker?.stop(); for (const res of sockets) res.end(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); } };
}
