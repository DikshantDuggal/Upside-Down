import type { Ack, CommandEnvelope, Message, PullResponse, PushResponse } from "../../contracts/sync.ts";
import { randomUUID } from "node:crypto";
import { object, positive, ProtocolError, uuid, VERSION } from "../../server/sync/protocol.ts";
import { LocalStore } from "./store.ts";

export class CoordinatorClient {
  base: URL;
  token: string;
  timeoutMs: number;
  pending = new Set<AbortController>();
  constructor(base: string, token: string, timeoutMs = 8000) {
    this.base = new URL(base); this.token = token; this.timeoutMs = timeoutMs;
    if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.pathname !== "/" || this.base.search || this.base.hash) throw new Error("Coordinator must be an explicit HTTP(S) origin");
  }
  async request(path: string, init: RequestInit = {}): Promise<any> {
    if (!path.startsWith("/api/")) throw new Error("Only coordinator API routes are permitted");
    const controller = new AbortController(); this.pending.add(controller);
    try {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.base), { ...init, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs), ...(init.signal ? [init.signal] : [])]),
        headers: { "Content-Type": "application/json", "X-UD-Contract": VERSION, Authorization: `Bearer ${this.token}`, ...init.headers } });
    } catch { throw new ProtocolError(503, "COORDINATOR_UNREACHABLE", "Coordinator is unreachable"); }
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 16 * 1024 * 1024) { controller.abort(); throw new ProtocolError(502, "UPSTREAM_TOO_LARGE", "Coordinator response exceeds local limits"); } chunks.push(value); } }
      finally { reader.releaseLock(); }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      let body: any; try { body = JSON.parse(raw); } catch { /* Legacy non-JSON errors. */ }
      const retry = response.headers.get("Retry-After");
      const ms = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : undefined;
      throw new ProtocolError(response.status, body?.code ?? `UPSTREAM_${response.status}`, "Coordinator request failed", {
        ...(body?.details?.expectedSequence ? { expectedSequence: body.details.expectedSequence } : {}),
        ...(Number.isFinite(ms) ? { retryAfterMs: ms } : {}) });
    }
    if (path.startsWith("/api/sync/") && response.headers.get("X-UD-Contract") !== VERSION) throw new ProtocolError(426, "CONTRACT_MISMATCH", "Coordinator does not advertise UD-IC/1.0");
    try { return JSON.parse(raw); } catch { throw new ProtocolError(502, "INVALID_RESPONSE", "Coordinator returned invalid JSON"); }
    } finally { this.pending.delete(controller); }
  }
  abortPending() { for (const controller of this.pending) controller.abort(); }
}

function validatePage(page: unknown): asserts page is PullResponse {
  object(page);
  if (page.contractVersion !== VERSION || !Array.isArray(page.events) || page.events.length > 200 || typeof page.nextCursor !== "string" || !page.nextCursor || typeof page.hasMore !== "boolean" || typeof page.serverTime !== "string") throw new ProtocolError(502, "INVALID_PULL", "Invalid coordinator pull page");
  let epoch: string | undefined;
  const ids = new Set<string>();
  for (const e of page.events) {
    object(e); uuid(e.id); object(e.payload);
    if (e.contractVersion !== VERSION || typeof e.cursor !== "string" || typeof e.coordinatorEpoch !== "string" || !e.coordinatorEpoch || typeof e.type !== "string" || typeof e.timestamp !== "string" || typeof e.source !== "string" || ids.has(e.id) || (epoch && epoch !== e.coordinatorEpoch)) throw new ProtocolError(502, "INVALID_EVENT", "Invalid canonical event");
    ids.add(e.id); epoch = e.coordinatorEpoch;
  }
}

export class SyncWorker {
  store: LocalStore;
  client: CoordinatorClient;
  running = false;
  stopped = false;
  timer?: ReturnType<typeof setTimeout>;
  failures = 0;
  paused = false;
  senderId = randomUUID();
  constructor(store: LocalStore, client: CoordinatorClient) { this.store = store; this.client = client; }
  start() { this.stopped = false; this.schedule(0); }
  schedule(ms: number) {
    if (this.stopped || this.paused) return;
    this.timer = setTimeout(() => void this.tick(), ms); this.timer.unref();
  }
  resume() { this.paused = false; this.failures = 0; this.schedule(0); }
  async stop() {
    this.stopped = true; clearTimeout(this.timer); this.client.abortPending();
    while (this.running) await new Promise(resolve => setTimeout(resolve, 20));
  }
  async hydrate(page: PullResponse) {
    const snapshots: { kind: string; id: string; value: unknown }[] = [];
    const taskIds = new Set(page.events.flatMap(e => e.taskId ? [e.taskId] : []));
    // Full task snapshots preserve descriptions and current revision; event payloads alone are incomplete.
    for (const id of taskIds) { uuid(id); const task = await this.client.request(`/api/tasks/${id}`); object(task); uuid(task.id); positive(task.revision); if (task.id !== id) throw new ProtocolError(502, "INVALID_TASK", "Task identity mismatch"); snapshots.push({ kind: "tasks", id, value: task }); }
    if (!this.store.get("remoteCursor") || page.events.some(e => e.type.startsWith("agent_"))) {
      const agents = await this.client.request("/api/agents");
      if (!Array.isArray(agents)) throw new ProtocolError(502, "INVALID_AGENTS", "Expected agent snapshots");
      for (const agent of agents) { object(agent); if (typeof agent.id !== "string") throw new ProtocolError(502, "INVALID_AGENT", "Invalid agent snapshot"); snapshots.push({ kind: "agents", id: agent.id, value: agent }); }
    }
    for (const e of page.events) {
      if (typeof e.payload.patchId === "string") {
        uuid(e.payload.patchId); const patch = await this.client.request(`/api/patches/${e.payload.patchId}`);
        object(patch); if (patch.id !== e.payload.patchId) throw new ProtocolError(502, "INVALID_PATCH", "Patch identity mismatch");
        snapshots.push({ kind: "patches", id: e.payload.patchId, value: patch });
      }
      if (e.type === "message_sent" || e.type === "message.sent") {
        // A must supply a complete Message in payload.message; no message GET exists in UD-IC/1.0.
        const message = e.payload.message as Message; object(message); uuid(message.id); uuid(message.eventId); uuid(message.senderDeviceId);
        if (typeof message.text !== "string" || typeof message.createdAt !== "string" || typeof message.receivedAt !== "string" || (message.recipientDeviceId && message.recipientDeviceId !== this.store.deviceId && message.senderDeviceId !== this.store.deviceId)) throw new ProtocolError(502, "INVALID_MESSAGE", "Missing or unauthorized message snapshot");
        snapshots.push({ kind: "messages", id: message.id, value: message });
      }
    }
    // The conflict detection event has only IDs/revisions; obtain full proposal/currentTask evidence.
    if (!this.store.get("remoteCursor") || page.events.some(e => e.type === "sync_conflict" || e.type === "conflict_resolved")) {
      for (const status of ["open", "resolved"]) {
        let after: string | undefined; const seen = new Set<string>();
        do {
          const result = await this.client.request(`/api/sync/conflicts?status=${status}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
          if (!Array.isArray(result.items) || typeof result.hasMore !== "boolean") throw new ProtocolError(502, "INVALID_CONFLICTS", "Invalid conflict page");
          for (const item of result.items) { object(item); uuid(item.id); snapshots.push({ kind: "conflicts", id: item.id, value: item }); }
          if (!result.hasMore) break;
          if (typeof result.nextCursor !== "string" || seen.has(result.nextCursor)) throw new ProtocolError(502, "INVALID_CURSOR", "Conflict page did not advance");
          after = result.nextCursor; seen.add(after!);
        } while (true);
      }
    }
    return snapshots;
  }
  async pull() {
    let more = true;
    const seen = new Set<string>();
    while (more && !this.stopped) {
      const after = this.store.get("remoteCursor");
      const page = await this.client.request(`/api/sync/pull?limit=200${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      validatePage(page);
      const priorEpoch = this.store.get("epoch");
      if (priorEpoch && page.events.length && page.events[0].coordinatorEpoch !== priorEpoch) {
        this.store.resetRemote(); throw new ProtocolError(503, "EPOCH_CHANGED", "Rebuilding cache before pending commands resume");
      }
      if (page.hasMore && (page.nextCursor === after || seen.has(page.nextCursor))) throw new ProtocolError(502, "INVALID_CURSOR", "Pull cursor did not advance");
      seen.add(page.nextCursor);
      if (page.events.length || page.nextCursor !== after || this.store.get("rebuilding") === "true") this.store.applyPull(page, await this.hydrate(page));
      more = page.hasMore;
    }
  }
  async tick() {
    if (this.running || this.stopped || this.paused) return;
    this.running = true;
    let events: CommandEnvelope[] = []; let delay = 1800 + Math.random() * 400;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!this.store.claimSender(this.senderId)) return;
      heartbeat = setInterval(() => { try { if (!this.store.claimSender(this.senderId)) this.paused = true; } catch { this.paused = true; } }, 5000); heartbeat.unref();
      // Check/rebuild coordinator epoch before sending proposals against a restored database.
      await this.pull();
      if (this.stopped || this.paused) return;
      events = this.store.batch();
      if (events.length) {
        this.store.markSending(events);
        const result = await this.client.request("/api/sync/push", { method: "POST", body: JSON.stringify({ contractVersion: VERSION, deviceId: this.store.deviceId, events }) }) as PushResponse;
        if (result.contractVersion !== VERSION || !Array.isArray(result.acks)) throw new ProtocolError(502, "INVALID_ACK", "Invalid push response");
        this.store.recordAcks(events, result.acks);
        const retry = result.acks.find((a: Ack) => a.status === "retry");
        if (retry || result.acks.length < events.length) throw new ProtocolError(503, retry?.error?.code ?? "ACK_MISSING", "Some commands await a durable acknowledgement", retry?.error?.details);
        await this.pull();
      }
      this.failures = 0; this.store.setHealth(true);
    } catch (error) {
      const failure = error instanceof ProtocolError ? error : new ProtocolError(503, "SYNC_FAILED", "Synchronization failed; retained local data");
      this.failures++;
      delay = Math.max(Math.random() * Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5)), failure.body.details?.retryAfterMs ?? 0);
      if (failure.status === 410 || failure.body.code === "CURSOR_EXPIRED") this.store.resetRemote();
      // A malformed local envelope/sequence collision cannot be dropped or silently resequenced.
      if ([400, 401, 403, 409, 413, 426].includes(failure.status)) this.paused = true;
      try { this.store.retry(events, failure.body, Date.now() + delay); this.store.setHealth(!["COORDINATOR_UNREACHABLE", "SYNC_FAILED"].includes(failure.body.code), failure.body); }
      catch { this.paused = true; /* Do not spin or erase a queue after storage failure. */ }
    } finally { clearInterval(heartbeat); try { this.store.releaseSender(this.senderId); } catch { this.paused = true; } this.running = false; this.schedule(delay); }
  }
}
