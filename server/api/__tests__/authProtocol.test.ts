import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "../../index.ts";

async function fixture() {
  const instance = createServer(":memory:", { authenticate: true, allowedOrigins: ["http://127.0.0.1:5173"], sseReplay: true });
  const credential = instance.auth.enroll(randomUUID());
  const reviewer = instance.auth.enroll(randomUUID(), "reviewer");
  const server = instance.app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { ...instance, credential, reviewer, url: `http://127.0.0.1:${address.port}/api`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); instance.db.close(); } };
}

test("new endpoints require version and a valid credential; revoked credentials return 403", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url + "/capabilities")).status, 401);
    const headers = { Authorization: `Bearer ${f.credential.token}` };
    const version = await fetch(f.url + "/capabilities", { headers }); assert.equal(version.status, 426);
    const body = await version.json() as any;
    assert.equal(body.code, "CONTRACT_VERSION"); assert.ok(body.requestId); assert.equal(body.retryable, false);
    const accepted = await fetch(f.url + "/capabilities", { headers: { ...headers, "X-UD-Contract": "UD-IC/1.0" } });
    assert.equal(accepted.status, 200);
    const capabilities = await accepted.json() as any;
    assert.equal(capabilities.features.sseReplay, true);
    assert.equal(capabilities.features.sync, true); assert.equal(capabilities.features.execution, false); assert.equal(capabilities.features.patchApply, false);
    f.auth.revoke(f.credential.principal.id);
    assert.equal((await fetch(f.url + "/capabilities", { headers })).status, 403);
  } finally { await f.close(); }
});

test("device credential and forged reviewerId cannot approve; enrolled reviewer can", async () => {
  const f = await fixture();
  try {
    const task = f.coordinator.createTask({ title: "review" });
    f.coordinator.transitionTask(task.id, { baseRevision: 1, targetStatus: "running" });
    const patch = f.coordinator.proposePatch(task.id, randomUUID(), "legacy fixture diff");
    const decide = (token: string) => fetch(`${f.url}/patches/${patch.id}/approve`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-UD-Contract": "UD-IC/1.0", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ reviewerId: "admin" }) });
    assert.equal((await decide(f.credential.token)).status, 403);
    assert.equal(f.coordinator.getPatch(patch.id).status, "pending");
    assert.equal((await decide(f.reviewer.token)).status, 200);
    assert.equal(f.coordinator.getPatch(patch.id).reviewerId, f.reviewer.principal.id);
  } finally { await f.close(); }
});

test("unapproved browser Origin is rejected and enrollment is not exposed over HTTP", async () => {
  const f = await fixture();
  try {
    const forbidden = await fetch(f.url + "/health", { headers: { Authorization: `Bearer ${f.credential.token}`, Origin: "https://untrusted.example" } });
    assert.equal(forbidden.status, 403); assert.equal((await forbidden.json() as any).code, "ORIGIN_FORBIDDEN");
    const allowed = await fetch(f.url + "/health", { headers: { Authorization: `Bearer ${f.credential.token}`, Origin: "http://127.0.0.1:5173" } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173");
    assert.equal((await fetch(f.url + "/enroll", { method: "POST", headers: { Authorization: `Bearer ${f.credential.token}` } })).status, 404);
  } finally { await f.close(); }
});

test("private message bodies never appear in an unrelated device's authenticated history", async () => {
  const f = await fixture();
  try {
    const recipient = f.auth.enroll(randomUUID());
    f.coordinator.recordExternalEvent({ id: randomUUID(), source: "sync", type: "message_sent", timestamp: new Date().toISOString(),
      payload: { message: { senderDeviceId: recipient.principal.deviceId, recipientDeviceId: randomUUID(), text: "private message" } } });
    const response = await fetch(f.url + "/events", { headers: { Authorization: `Bearer ${f.credential.token}` } });
    assert.equal(response.status, 200); assert.equal((await response.json() as any[]).length, 0);
  } finally { await f.close(); }
});

test("missing resources and malformed JSON use deterministic secret-safe error bodies", async () => {
  const f = await fixture();
  try {
    const headers = { Authorization: `Bearer ${f.credential.token}`, "X-UD-Contract": "UD-IC/1.0" };
    const missing = await fetch(`${f.url}/tasks/${randomUUID()}/patches`, { headers });
    assert.equal(missing.status, 404); assert.equal((await missing.json() as any).code, "NOT_FOUND");
    const malformed = await fetch(f.url + "/tasks", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{" });
    assert.equal(malformed.status, 400);
    const body = await malformed.text(); assert.match(body, /INVALID_JSON/); assert.doesNotMatch(body, /stack|node_modules|\.db/);
  } finally { await f.close(); }
});
