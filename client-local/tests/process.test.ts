import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { VERSION } from "../../server/sync/protocol.ts";

async function unusedPort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const port = (server.address() as AddressInfo).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
async function boot(db: string) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
    env: { ...process.env, UD_DEVICE_DB: db, UD_LOCAL_PORT: String(await unusedPort()), UD_COORDINATOR_URL: "", UD_DEVICE_TOKEN_FILE: "", UD_ALLOWED_ORIGINS: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Local process startup timed out")); }, 10000);
    let output = "";
    child.stdout!.on("data", chunk => { output += chunk; const match = output.match(/local service: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Local process exited before readiness: ${code}`)); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  return { child, origin };
}
async function kill(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGKILL"); }); }
async function pair(origin: string, db: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-UD-Contract": VERSION, Origin: origin };
  const response = await fetch(`${origin}/local/session`, { method: "POST", headers, body: readFileSync(`${db}.session.json`, "utf8") }); assert.equal(response.status, 200);
  headers.Cookie = response.headers.get("set-cookie")!.split(";")[0]; headers["X-CSRF-Token"] = (await response.json() as any).csrfToken;
  return headers;
}

test("real local process kill/restart retains committed identity, queue and idempotency mapping", async () => {
  const dir = mkdtempSync(join(tmpdir(), "upside-process-")); const db = join(dir, "device.db"); let running: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    running = await boot(db); let headers = await pair(running.origin, db); headers["Idempotency-Key"] = "browser-lost-response";
    const body = JSON.stringify({ type: "task.create", payload: { clientTaskId: randomUUID(), title: "Survive process death" } });
    let response = await fetch(`${running.origin}/local/commands`, { method: "POST", headers, body }); assert.equal(response.status, 202); const first = await response.json() as any;
    await kill(running.child); running = await boot(db); headers = await pair(running.origin, db); headers["Idempotency-Key"] = "browser-lost-response";
    response = await fetch(`${running.origin}/local/commands`, { method: "POST", headers, body }); assert.equal(response.status, 202); const retried = await response.json() as any;
    assert.equal(retried.eventId, first.eventId); assert.equal(retried.deviceId, first.deviceId); assert.equal(retried.sequence, 1); assert.equal(retried.state, "queued");
    const health = await fetch(`${running.origin}/local/health`, { headers }); assert.equal((await health.json() as any).pendingCount, 1);
  } finally { if (running) await kill(running.child); if (resolve(dirname(dir)) !== resolve(tmpdir())) throw new Error("Unexpected cleanup path"); rmSync(dir, { recursive: true, force: true }); }
});
