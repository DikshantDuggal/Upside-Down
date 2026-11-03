import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "../../index.ts";
import { FrontendController } from "../../core/frontendController.ts";
const root = path.resolve(import.meta.dirname, "../../..");
const version = "UD-IC/1.0";
async function fixture() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "ud-release-"));
  const file = path.join(directory, "coordinator.db");
  let instance = createServer(file, { authenticate: true, sseReplay: true, patchCompletionMode: "verified_application" });
  let server = instance.app.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = () => `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const a = instance.auth.enroll(randomUUID()), b = instance.auth.enroll(randomUUID());
  const request = (token: string, route: string, body?: unknown, key = "stable") => fetch(origin() + "/api" + route, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "X-UD-Contract": version,
      "Content-Type": "application/json", "Idempotency-Key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function stop() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); instance.db.close(); }
  return { directory, a, b, request, get instance() { return instance; }, async restart() { await stop(); instance = createServer(file, { authenticate: true, sseReplay: true, patchCompletionMode: "verified_application" }); server = instance.app.listen(0, "127.0.0.1"); await once(server, "listening"); }, async close() { await stop(); remove(directory); } };
}
function remove(directory: string) { assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("ud-release-")); fs.rmSync(directory, { recursive: true, force: true }); }

test("retained projects/handoffs persist, are idempotent and bind sender/ACK to authenticated device", async () => {
  const f = await fixture();
  try {
    const projectBody = { name: "Release fixture", description: "Explicit test records" };
    const response = await f.request(f.a.token, "/projects", projectBody, "project"); assert.equal(response.status, 201);
    const project = await response.json() as any;
    assert.equal((await f.request(f.a.token, "/projects", projectBody, "project").then(r => r.json()) as any).id, project.id);
    assert.equal((await f.request(f.a.token, "/projects", { name: "changed" }, "project")).status, 409);
    for (const [token, id] of [[f.a.token, "backend-fixture"], [f.b.token, "frontend-fixture"]]) {
      assert.equal((await f.request(token, "/agents/register", { id, name: id, status: "idle", runtimeAvailable: false })).status, 200);
    }
    assert.equal((await f.request(f.b.token, "/agents/register", { id: "backend-fixture", name: "spoofed" })).status, 403);
    const task = f.instance.coordinator.createTask({ title: "Handoff fixture", ownerId: "backend-fixture" });
    const input = { fromAgent: "backend-fixture", toAgent: "frontend-fixture", taskId: task.id, handoffType: "context_sharing", summary: "Actual persisted API handoff", payload: { contract: version } };
    assert.equal((await f.request(f.b.token, "/handoffs", input, "forged")).status, 403);
    const sent = await f.request(f.a.token, "/handoffs", input, "handoff"); assert.equal(sent.status, 201);
    const handoff = await sent.json() as any;
    const ack = { ...input, fromAgent: input.toAgent, toAgent: input.fromAgent, summary: "Received", payload: { ackFor: handoff.id } };
    assert.equal((await f.request(f.b.token, "/handoffs", ack, "ack")).status, 201);
    assert.equal((await f.request(f.b.token, "/handoffs", ack, "ack")).status, 201);
    await f.restart();
    assert.equal((await f.request(f.a.token, "/projects").then(r => r.json()) as any[]).length, 1);
    assert.equal((await f.request(f.b.token, "/handoffs").then(r => r.json()) as any[]).length, 2);
    assert.equal((await f.request(f.a.token, "/projects", projectBody, "project").then(r => r.json()) as any).id, project.id);
    assert.equal(f.instance.coordinator.listEvents().filter(event => event.type === "agent_handoff").length, 2);
  } finally { await f.close(); }
});

test("prototype X-Principal-Role and reviewer-looking bearer cannot authorize privileged actions", async () => {
  const f = await fixture();
  try {
    const server = f.instance.app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
      const headers = { "X-UD-Contract": version, "X-Principal-Role": "admin", Authorization: "Bearer reviewer-anything", "Content-Type": "application/json" };
      assert.equal((await fetch(origin + "/api/sync/conflicts", { headers })).status, 401);
      assert.equal((await fetch(origin + "/api/patches/anything/approve", { method: "POST", headers, body: "{}" })).status, 401);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await f.close(); }
});

test("actual official frontend activation and demo rollback use built assets and isolated state", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "ud-release-"));
  try {
    const configPath = path.join(directory, "frontend.json");
    const controller = new FrontendController(root, configPath);
    const modulePath = new URL("../../../scripts/web-host.mjs", import.meta.url).href;
    const { startWebHost } = await import(modulePath);
    const host = await startWebHost({ port: 0, localOrigin: "http://127.0.0.1:1", configPath });
    const origin = `http://127.0.0.1:${host.server.address().port}`;
    try {
    assert.equal(controller.getStatus().sourceDir, "web");
    assert.equal(controller.validateCandidate(path.join(directory, "not-an-app")).valid, false);
    const activated = controller.activateTeamFrontend(); assert.equal(activated.success, true, activated.error);
    const html = fs.readFileSync(path.join(controller.getActivePublicDir(), "index.html"), "utf8");
    assert.match(html, /assets\/index-.*\.js/);
    assert.match(await fetch(origin).then(response => response.text()), /assets\/index-.*\.js/);
    assert.equal(controller.rollbackFrontend().success, true);
    assert.equal(controller.getStatus().activeFrontend, "demo");
    assert.match(fs.readFileSync(path.join(controller.getActivePublicDir(), "index.html"), "utf8"), /app\.js/);
    assert.match(await fetch(origin).then(response => response.text()), /app\.js/);
    assert.equal((await fetch(origin + "/app.js")).status, 200);
    assert.equal(controller.activateTeamFrontend().success, true);
    assert.match(await fetch(origin).then(response => response.text()), /assets\/index-.*\.js/);
    } finally { await host.close(); }
  } finally { remove(directory); }
});

async function freePort() {
  const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function stopManaged(state: string) {
  const record = JSON.parse(fs.readFileSync(path.join(state, "launch-control.json"), "utf8"));
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(record.pipe); socket.on("data", () => {}); socket.once("error", reject); socket.once("close", () => resolve());
    socket.once("connect", () => socket.end(JSON.stringify({ token: record.token, command: "stop" }) + "\n"));
  });
}
async function startManaged(state: string, ports: number[]) {
  const child = spawn(process.execPath, ["scripts/dev-all.mjs", "--state-dir", state, "--coordinator-port", String(ports[0]), "--local-port", String(ports[1]), "--web-port", String(ports[2]), "--skip-build"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const finished = new Promise<number | null>(resolve => child.once("exit", resolve));
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Launcher timeout: " + output.slice(-2000))), 25000);
    const receive = (chunk: Buffer) => { output = (output + chunk).slice(-16000); if (output.includes("READY: official frontend")) { clearTimeout(timeout); resolve(); } };
    child.stdout!.on("data", receive); child.stderr!.on("data", receive);
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Launcher exited ${code}: ${output.slice(-2000)}`)); });
  }).catch(error => { if (child.pid) { if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else child.kill(); } throw error; });
  return { child, finished };
}

test("one-command launcher gracefully stops/restarts and retains identity, credentials and actual task", { timeout: 60000 }, async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "ud-release-"));
  const ports = [await freePort(), await freePort(), await freePort()];
  let launched: Awaited<ReturnType<typeof startManaged>> | undefined;
  try {
    launched = await startManaged(directory, ports);
    const token = fs.readFileSync(path.join(directory, "device.token"), "utf8").trim();
    const identity = fs.readFileSync(path.join(directory, "device.token"), "utf8");
    const headers = { Authorization: `Bearer ${token}`, "X-UD-Contract": version, "Content-Type": "application/json" };
    const origin = `http://127.0.0.1:${ports[0]}`;
    const task = await fetch(origin + "/api/tasks", { method: "POST", headers, body: JSON.stringify({ title: "Restart persistence" }) }).then(r => r.json()) as any;
    assert.ok(task.id); assert.equal((await fetch(`http://127.0.0.1:${ports[2]}`).then(r => r.text())).includes("Team workspace"), true);
    await stopManaged(directory); assert.equal(await launched.finished, 0); launched = undefined;
    launched = await startManaged(directory, ports);
    assert.equal(fs.readFileSync(path.join(directory, "device.token"), "utf8"), identity);
    const tasks = await fetch(origin + "/api/tasks", { headers }).then(r => r.json()) as any[];
    assert.equal(tasks.filter(existing => existing.id === task.id).length, 1);
    await stopManaged(directory); assert.equal(await launched.finished, 0); launched = undefined;
    for (const port of ports) {
      await new Promise<void>((resolve, reject) => { const listener = net.createServer(); listener.once("error", reject); listener.listen(port, "127.0.0.1", () => listener.close(() => resolve())); });
    }
  } finally { if (launched) { await stopManaged(directory); await launched.finished; } remove(directory); }
});


test("occupied ports fail safely without terminating the existing listener", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "ud-release-"));
  const listener = net.createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  try {
    const occupied = (listener.address() as net.AddressInfo).port;
    const child = spawn(process.execPath, ["scripts/dev-all.mjs", "--state-dir", directory, "--coordinator-port", String(occupied), "--skip-build"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout!.on("data", chunk => output += chunk); child.stderr!.on("data", chunk => output += chunk);
    const [exit] = await once(child, "exit"); assert.equal(exit, 1); assert.match(output, /occupied.*Existing processes were left running/s);
    assert.equal(listener.listening, true);
  } finally { await new Promise<void>(resolve => listener.close(() => resolve())); remove(directory); }
});
