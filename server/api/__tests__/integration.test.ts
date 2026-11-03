import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "../../index.ts";
import { LocalStore } from "../../../client-local/src/store.ts";
import { CoordinatorClient } from "../../../client-local/src/transport.ts";
import { createLocalService } from "../../../client-local/src/server.ts";

const VERSION = "UD-IC/1.0";
async function listen(instance: ReturnType<typeof createServer>, port = 0) {
  const server = instance.app.listen(port, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { origin: `http://127.0.0.1:${address.port}`, port: address.port,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
async function device(file: string, origin: string, enroll: (id: string) => string, reviewerToken?: string) {
  const store = new LocalStore(file), token = enroll(store.deviceId);
  const client = new CoordinatorClient(origin, token, 2000);
  const pairingKey = randomUUID();
  const service = await createLocalService({ store, client, pairingKey, port: 0, startWorker: false,
    reviewerClient: reviewerToken ? new CoordinatorClient(origin, reviewerToken) : undefined });
  const paired = await fetch(service.origin + "/local/session", { method: "POST", headers: {
    "X-UD-Contract": VERSION, "Content-Type": "application/json", Origin: service.origin }, body: JSON.stringify({ pairingKey }) });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get("set-cookie")!.split(";")[0], csrf = (await paired.json() as any).csrfToken;
  const request = (route: string, body?: unknown, key: string = randomUUID()) => fetch(service.origin + route, {
    method: body === undefined ? "GET" : "POST", headers: { "X-UD-Contract": VERSION, Cookie: cookie,
      Origin: service.origin, "X-CSRF-Token": csrf, "Content-Type": "application/json", "Idempotency-Key": key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const queue = async (command: unknown, key: string = randomUUID()) => { const response = await request("/local/commands", command, key); assert.equal(response.status, 202, await response.clone().text()); return response.json() as Promise<any>; };
  const tick = async () => { await service.worker!.tick(); clearTimeout(service.worker!.timer); };
  return { store, client, token, service, request, queue, tick,
    close: async () => { await service.close(); store.close(); } };
}
function cleanup(root: string) {
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("ud-joined-"));
  fs.rmSync(root, { recursive: true, force: true });
}

test("two real local services: offline restart, delivery, stale conflict, reviewer resolution and private message filtering", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-joined-"));
  const a = createServer(path.join(root, "coordinator.db"), { authenticate: true, sseReplay: true });
  let remote = await listen(a); const reviewer = a.auth.enroll(randomUUID(), "reviewer");
  const enroll = (id: string) => a.auth.enroll(id).token;
  let b = await device(path.join(root, "b.db"), remote.origin, enroll, reviewer.token);
  const c = await device(path.join(root, "c.db"), remote.origin, enroll);
  try {
    const taskId = randomUUID(), command = { type: "task.create", payload: { clientTaskId: taskId, title: "Offline durable task" } };
    const remotePort = remote.port; await remote.close();
    const receipt = await b.queue(command, "browser-stable-key"), identity = b.store.deviceId, token = b.token;
    // Worker deliberately has not run: the only task copy is B's durable SQLite queue.
    await b.tick(); assert.equal(b.store.lookup(receipt.eventId).state, "queued");
    assert.throws(() => a.coordinator.getTask(taskId));
    await b.close(); b = await device(path.join(root, "b.db"), remote.origin, () => token, reviewer.token);
    assert.equal(b.store.deviceId, identity); assert.equal(b.store.lookup(receipt.eventId).sequence, receipt.sequence);
    assert.equal((await b.queue(command, "browser-stable-key")).eventId, receipt.eventId);
    remote = await listen(a, remotePort);
    await b.tick(); assert.equal(b.store.lookup(receipt.eventId).ack?.status, "applied");
    await c.tick(); assert.ok(c.store.state().tasks.some(task => task.id === taskId));
    await b.queue({ type: "task.transition", taskId, baseRevision: 1, payload: { targetStatus: "running" } });
    await b.tick(); assert.equal(a.coordinator.getTask(taskId).revision, 2);
    const stale = await c.queue({ type: "task.transition", taskId, baseRevision: 1, payload: { targetStatus: "blocked", reason: "offline proposal" } });
    await c.tick(); const ack = c.store.lookup(stale.eventId).ack!;
    assert.equal(ack.status, "conflict"); assert.equal(a.coordinator.getTask(taskId).revision, 2);
    const conflict = (await a.gateway.listConflicts("open")).items[0];
    const resolution = { resolution: "keep_authoritative", expectedConflictRevision: conflict.resolutionRevision, expectedTaskRevision: 2, reason: "retain current state" };
    assert.equal((await c.request(`/api/sync/conflicts/${conflict.id}/resolve`, resolution, "resolve")).status, 503);
    const resolved = await b.request(`/api/sync/conflicts/${conflict.id}/resolve`, resolution, "resolve");
    assert.equal(resolved.status, 200, await resolved.clone().text());
    assert.equal((await b.request(`/api/sync/conflicts/${conflict.id}/resolve`, resolution, "resolve")).status, 200);
    const unrelated = a.auth.enroll(randomUUID());
    await b.queue({ type: "message.send", payload: { messageId: randomUUID(), text: "only B and C", recipientDeviceId: c.store.deviceId } });
    await b.tick(); await c.tick();
    assert.ok(c.store.state().messages.some(message => message.text === "only B and C"));
    const unseen = await new CoordinatorClient(remote.origin, unrelated.token).request("/api/sync/pull?limit=200");
    assert.ok(!JSON.stringify(unseen.events).includes("only B and C"));
    assert.equal((await b.request("/api/capabilities").then(r => r.json()) as any).authorization.canReview, false);
    const reviewerCapabilities = await new CoordinatorClient(remote.origin, reviewer.token).request("/api/capabilities");
    assert.equal(reviewerCapabilities.authorization.canReview, true);
  } finally { await b.close(); await c.close(); await remote.close(); a.db.close(); cleanup(root); }
});

test("lost ACK survives coordinator restart and retries one immutable envelope without duplicating a task", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-joined-")), file = path.join(root, "coordinator.db");
  let a = createServer(file, { authenticate: true }); let remote = await listen(a);
  const b = await device(path.join(root, "b.db"), remote.origin, id => a.auth.enroll(id).token);
  try {
    const taskId = randomUUID(), receipt = await b.queue({ type: "task.create", payload: { clientTaskId: taskId, title: "ACK lost" } });
    const result = await b.client.request("/api/sync/push", { method: "POST", body: JSON.stringify({ contractVersion: VERSION, deviceId: b.store.deviceId, events: b.store.batch() }) });
    assert.equal(result.acks[0].duplicate, false); // Deliberately do not persist this received ACK on B.
    const port = remote.port; await remote.close(); a.db.close();
    a = createServer(file, { authenticate: true }); remote = await listen(a, port);
    await b.tick();
    assert.equal(b.store.lookup(receipt.eventId).ack?.duplicate, true);
    assert.equal(a.coordinator.listTasks().filter(task => task.id === taskId).length, 1);
    const invalid = await fetch(remote.origin + "/api/sync/pull?after=invalid", { headers: { Authorization: `Bearer ${b.token}`, "X-UD-Contract": VERSION } });
    assert.equal(invalid.status, 410); assert.equal((await invalid.json() as any).code, "CURSOR_EXPIRED");
    assert.equal((await fetch(remote.origin + "/api/sync/pull", { headers: { "X-UD-Contract": VERSION } })).status, 401);
  } finally { await b.close(); await remote.close(); a.db.close(); cleanup(root); }
});

test("HTTP run -> safe review -> separate reviewer approval -> explicit apply -> verified Git commit -> done", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-joined-")), source = path.join(root, "source"), integration = path.join(root, "integration");
  fs.mkdirSync(source);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(source, "init", "--quiet", "--initial-branch=source"); git(source, "config", "core.autocrlf", "false");
  git(source, "config", "user.name", "Joined Fixture"); git(source, "config", "user.email", "fixture@localhost");
  fs.writeFileSync(path.join(source, "source.cjs"), "module.exports = () => 1 / 0;\n");
  fs.writeFileSync(path.join(source, "check.cjs"), "process.exit(require('./source.cjs')()===1 ? 0 : 1);\n");
  git(source, "add", "source.cjs", "check.cjs"); git(source, "commit", "--quiet", "-m", "base"); const base = git(source, "rev-parse", "HEAD");
  git(source, "worktree", "add", "-b", "integration", integration, base);
  const a = createServer(path.join(root, "coordinator.db"), { authenticate: true, patchCompletionMode: "verified_application", execution: {
    runtimeDirectory: path.join(root, "runtime"), workspaces: [
      { id: "source", repositoryPath: source, repairTargetFile: "source.cjs", allowedPaths: ["source.cjs"], testProfileIds: ["check"] },
      { id: "integration", repositoryPath: integration, integrationBranch: "integration", allowedPaths: ["source.cjs"], testProfileIds: ["check"] } ],
    testProfiles: [{ id: "check", executable: process.execPath, args: ["check.cjs"], timeoutMs: 5000 }] } });
  const remote = await listen(a), reviewer = a.auth.enroll(randomUUID(), "reviewer");
  const b = await device(path.join(root, "b.db"), remote.origin, id => a.auth.enroll(id).token, reviewer.token);
  try {
    const task = a.coordinator.createTask({ title: "Repair source via HTTP" });
    const input = { baseRevision: 1, workspaceId: "source", testProfileId: "check", trigger: "manual" };
    const deviceAttempt = await b.client.requestResult(`/api/tasks/${task.id}/runs`, { method: "POST", headers: { "Idempotency-Key": "forged" }, body: JSON.stringify(input) }).catch(error => error);
    assert.equal(deviceAttempt.status, 403);
    const invalid = await b.request(`/api/tasks/${task.id}/runs`, { ...input, workspaceId: "arbitrary-path" }, "bad"); assert.equal(invalid.status, 422);
    const start = await b.request(`/api/tasks/${task.id}/runs`, input, "run"); assert.equal(start.status, 202);
    const run = await start.json() as any; await a.jobs!.idle();
    const finished = await b.request(`/api/runs/${run.id}`).then(r => r.json()) as any;
    assert.equal(finished.status, "review", JSON.stringify(finished.error)); assert.equal(finished.evidence.length, 2);
    assert.equal((await b.request(`/api/tasks/${task.id}/runs`, input, "run").then(r => r.json()) as any).id, run.id);
    const patch = a.coordinator.getPatch(finished.patchId);
    const decision = { expectedTaskRevision: patch.taskRevision, expectedDiffHash: patch.diffHash };
    assert.equal((await b.request(`/api/patches/${patch.id}/approve`, decision, "decision")).status, 200);
    assert.equal((await b.request(`/api/patches/${patch.id}/approve`, decision, "decision")).status, 200);
    assert.equal(a.coordinator.getTask(task.id).status, "review"); assert.equal(git(integration, "rev-parse", "HEAD"), base);
    const applicationResponse = await b.request(`/api/patches/${patch.id}/apply`, { expectedTaskRevision: patch.taskRevision,
      expectedBaseCommit: base, expectedDiffHash: patch.diffHash, targetWorkspaceId: "integration", testProfileId: "check" }, "apply");
    assert.equal(applicationResponse.status, 202, await applicationResponse.clone().text());
    const application = await applicationResponse.json() as any; await a.jobs!.idle();
    const verified = await b.request(`/api/applications/${application.id}`).then(r => r.json()) as any;
    assert.equal(verified.status, "verified", JSON.stringify(verified.error)); assert.ok(verified.evidence[0].passed);
    assert.equal(git(integration, "rev-parse", "HEAD"), verified.commit); assert.equal(a.coordinator.getTask(task.id).status, "done");
    assert.ok(fs.readFileSync(path.join(source, "source.cjs"), "utf8").includes("/ 0"));
    const checkpoints = await b.request(`/api/tasks/${task.id}/checkpoints`).then(r => r.json()) as any[];
    assert.ok(checkpoints.length > 1); assert.ok(checkpoints.every(cp => cp.recoveryCapability === "metadata_only"));
  } finally { await b.close(); await remote.close(); await a.jobs!.shutdown(); a.db.close(); cleanup(root); }
});



test("local enrollment CLI writes B-compatible protected token files and revocation is enforced", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-joined-")), dbFile = path.join(root, "coordinator.db"), tokenFile = path.join(root, "device.token");
  let a: ReturnType<typeof createServer> | undefined, remote: Awaited<ReturnType<typeof listen>> | undefined;
  try {
    const deviceId = randomUUID();
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "server/api/enroll.ts", "--db", dbFile,
      "--device", deviceId, "--role", "device", "--out", tokenFile], { encoding: "utf8", windowsHide: true });
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/); assert.ok(!output.includes(token));
    a = createServer(dbFile, { authenticate: true }); remote = await listen(a);
    const principal = a.auth.authenticate(token); assert.equal(principal.deviceId, deviceId);
    const client = new CoordinatorClient(remote.origin, token);
    assert.equal((await client.request("/api/health")).status, "ok");
    const original = fs.readFileSync(tokenFile, "utf8");
    assert.throws(() => execFileSync(process.execPath, ["server/api/enroll.ts", "--db", dbFile, "--device", deviceId, "--out", tokenFile], { stdio: "pipe", windowsHide: true }));
    assert.equal(fs.readFileSync(tokenFile, "utf8"), original);
    execFileSync(process.execPath, ["server/api/enroll.ts", "--db", dbFile, "--revoke", principal.id], { stdio: "pipe", windowsHide: true });
    await assert.rejects(() => client.request("/api/health"), { status: 403 });
  } finally { await remote?.close(); a?.db.close(); cleanup(root); }
});
