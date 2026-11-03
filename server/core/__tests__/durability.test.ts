import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { CoordinatorDatabase, CursorExpiredError, EventIdentityError } from "../../db/database.ts";
import { CoordinatorService, ConflictError, ValidationError } from "../coordinator.ts";

const resources: { dir: string; handles: { close(): void }[] }[] = [];
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "ud-backend-a-"));
  const file = path.join(dir, "coordinator.db");
  const db = new CoordinatorDatabase(file);
  const fault = new DatabaseSync(file);
  const resource = { dir, handles: [db, fault] };
  resources.push(resource);
  return { dir, file, db, fault, resource, service: new CoordinatorService(db) };
}
afterEach(() => {
  for (const resource of resources.splice(0)) {
    for (const handle of resource.handles.reverse()) { try { handle.close(); } catch {} }
    assert.equal(path.dirname(resource.dir), path.resolve(tmpdir()));
    assert.ok(path.basename(resource.dir).startsWith("ud-backend-a-"));
    rmSync(resource.dir, { recursive: true, force: true });
  }
});
function failEvent(sql: DatabaseSync, type: string) {
  assert.match(type, /^[a-z_]+$/);
  sql.exec(`CREATE TRIGGER fail_event BEFORE INSERT ON activity_events
    WHEN NEW.type='${type}' BEGIN SELECT RAISE(ABORT,'injected persistence failure'); END;`);
}
function reviewing(service: CoordinatorService) {
  const task = service.createTask({ title: "Review fixture" });
  service.transitionTask(task.id, { baseRevision: 1, targetStatus: "running" });
  return service.proposePatch(task.id, randomUUID(), "fixture diff");
}

test("task, event and journal roll back together on actual SQLite journal failure", () => {
  const { db, fault, service } = fixture();
  let broadcasts = 0;
  service.subscribe(() => broadcasts++);
  fault.exec("CREATE TRIGGER fail_log BEFORE INSERT ON canonical_log BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END;");
  assert.throws(() => service.createTask({ title: "must not survive" }), /disk failure/);
  assert.deepEqual(service.listTasks(), []);
  assert.deepEqual(service.listEvents(), []);
  assert.deepEqual(db.listCanonicalEvents().events, []);
  assert.equal(broadcasts, 0);
  fault.exec("DROP TRIGGER fail_log");
  service.createTask({ title: "committed" });
  assert.equal(broadcasts, 1);
});

test("failed transition leaves revision and owner unchanged", () => {
  const { service, fault } = fixture();
  const task = service.createTask({ title: "original", ownerId: "original-owner" });
  failEvent(fault, "task_transitioned");
  assert.throws(() => service.transitionTask(task.id, { baseRevision: 1, targetStatus: "assigned", ownerId: "other" }));
  assert.deepEqual(service.getTask(task.id), task);
  assert.equal(service.listEvents().length, 1);
});

test("patch proposal failure rolls back patch plus nested review transition", () => {
  const { service, fault } = fixture();
  const task = service.createTask({ title: "atomic proposal" });
  service.transitionTask(task.id, { baseRevision: 1, targetStatus: "running" });
  failEvent(fault, "patch_proposed");
  let broadcasts = 0;
  service.subscribe(() => broadcasts++);
  assert.throws(() => service.proposePatch(task.id, randomUUID(), "fixture diff"));
  assert.equal(service.getTask(task.id).revision, 2);
  assert.equal(service.getTask(task.id).status, "running");
  assert.equal(service.getPatchByTaskId(task.id), null);
  assert.equal(service.listEvents().length, 2);
  assert.equal(broadcasts, 0);
});

test("approval failure cannot leave an approved patch or done task", () => {
  const { service, fault } = fixture();
  const patch = reviewing(service);
  const original = service.getTask(patch.taskId);
  const eventCount = service.listEvents().length;
  failEvent(fault, "patch_approved");
  assert.throws(() => service.approvePatch(patch.id, "reviewer"));
  assert.equal(service.getPatch(patch.id).status, "pending");
  assert.deepEqual(service.getTask(patch.taskId), original);
  assert.equal(service.listEvents().length, eventCount);
});

test("registry write rolls back when its heartbeat cannot persist", () => {
  const { service, fault } = fixture();
  failEvent(fault, "agent_heartbeat");
  assert.throws(() => service.registerAgent({ id: "agent", name: "Agent", status: "idle", runtimeAvailable: true, lastSeenAt: new Date().toISOString() }));
  assert.deepEqual(service.listAgents(), []);
});

test("duplicate event is not broadcast twice; content reuse is rejected", () => {
  const { service, db } = fixture();
  const event = { id: randomUUID(), source: "fixture", type: "note", timestamp: new Date().toISOString(), payload: { a: 1, b: 2 } };
  let broadcasts = 0;
  service.subscribe(() => broadcasts++);
  service.recordExternalEvent(event);
  service.recordExternalEvent({ ...event, payload: { b: 2, a: 1 } });
  assert.equal(broadcasts, 1);
  assert.equal(db.listCanonicalEvents().events.length, 1);
  assert.throws(() => service.recordExternalEvent({ ...event, payload: { a: 3, b: 2 } }), EventIdentityError);
  assert.equal(broadcasts, 1);
});

test("nested rollback discards inner callbacks; no observer sees uncommitted state", () => {
  const { service, db } = fixture();
  const seen: string[] = [];
  service.subscribe((event) => seen.push(String(event.payload.title)));
  db.transaction(() => {
    service.createTask({ title: "first" });
    assert.throws(() => db.transaction(() => { service.createTask({ title: "rolled back" }); throw new Error("abort inner"); }));
    service.createTask({ title: "last" });
    assert.deepEqual(seen, []);
  });
  assert.deepEqual(seen, ["first", "last"]);
  assert.equal(service.listTasks().length, 2);
  assert.throws(() => db.transaction(() => { service.createTask({ title: "outer rollback" }); throw new Error("abort outer"); }));
  assert.equal(service.listTasks().length, 2);
  assert.deepEqual(seen, ["first", "last"]);
});

test("journal survives restart and paginates all tied-timestamp rows", () => {
  const { db, file, resource } = fixture();
  const timestamp = "2026-11-04T00:00:00.000Z";
  db.transaction(() => {
    for (let i = 0; i < 205; i++) db.saveEvent({ id: randomUUID(), source: "fixture", type: "note", timestamp, payload: { i } });
  });
  const first = db.listCanonicalEvents(undefined, 100);
  const second = db.listCanonicalEvents(first.nextCursor, 100);
  const third = db.listCanonicalEvents(second.nextCursor, 100);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, true);
  assert.equal(third.hasMore, false);
  assert.deepEqual([...first.events, ...second.events, ...third.events].map((e) => e.payload.i), Array.from({ length: 205 }, (_, i) => i));
  assert.equal(db.eventCursor(first.events[0].id), first.events[0].cursor);
  db.close();
  const reopened = new CoordinatorDatabase(file);
  resource.handles.push(reopened);
  assert.deepEqual(reopened.listCanonicalEvents(third.nextCursor).events, []);
  assert.equal(reopened.latestEventCursor(), third.nextCursor);
  assert.equal(reopened.listCanonicalEvents().events[0].coordinatorEpoch, first.events[0].coordinatorEpoch);
  assert.throws(() => reopened.listCanonicalEvents("not-a-valid-cursor"), CursorExpiredError);
  assert.throws(() => reopened.eventCursor(randomUUID()), CursorExpiredError);
  const foreign = new CoordinatorDatabase();
  resource.handles.push(foreign);
  assert.throws(() => reopened.listCanonicalEvents(foreign.latestEventCursor()), CursorExpiredError);
});

test("legacy event migration is deterministic and idempotent", () => {
  const { fault, db, file, resource } = fixture();
  db.close();
  fault.exec("DROP TABLE canonical_log; DROP TABLE coordinator_metadata;");
  const insert = fault.prepare("INSERT INTO activity_events(id,source,type,timestamp,payload) VALUES (?, 'old', 'note', '2026-01-01T00:00:00Z', '{}')");
  insert.run("legacy-z"); insert.run("legacy-a");
  const migrated = new CoordinatorDatabase(file);
  resource.handles.push(migrated);
  assert.deepEqual(migrated.listCanonicalEvents().events.map((e) => e.id), ["legacy-a", "legacy-z"]);
  migrated.close();
  const again = new CoordinatorDatabase(file);
  resource.handles.push(again);
  assert.equal(again.listCanonicalEvents().events.length, 2);
});

test("subscriber errors/mutations cannot change committed data or other subscribers", () => {
  const { service } = fixture();
  service.subscribe(() => { throw new Error("untrusted subscriber"); });
  service.subscribe((event) => { (event.payload.task as any).title = "corrupted"; });
  const seen: string[] = [];
  service.subscribe((event) => seen.push((event.payload.task as any).title));
  const task = service.createTask({ title: "intact" });
  assert.equal(service.getTask(task.id).title, "intact");
  assert.deepEqual(seen, ["intact"]);
});

test("reentrant subscribers observe the compound transaction in journal order", () => {
  const { service } = fixture();
  const task = service.createTask({ title: "compound" });
  service.transitionTask(task.id, { baseRevision: 1, targetStatus: "running" });
  let injected = false;
  service.subscribe((event) => {
    if (!injected && event.type === "task_transitioned") { injected = true; service.createTask({ title: "reentrant" }); }
  });
  const seen: string[] = [];
  service.subscribe((event) => seen.push(event.type));
  service.proposePatch(task.id, randomUUID(), "fixture diff");
  assert.deepEqual(seen, ["task_transitioned", "patch_proposed", "task_created"]);
});

test("abrupt process exit before COMMIT leaves no mutation or journal event", () => {
  const { db, service, file } = fixture();
  service.createTask({ title: "before crash" });
  const code = `import {CoordinatorDatabase} from ${JSON.stringify(new URL("../../db/database.ts", import.meta.url).href)};
    import {CoordinatorService} from ${JSON.stringify(new URL("../coordinator.ts", import.meta.url).href)};
    const db = new CoordinatorDatabase(process.argv[1]); const c = new CoordinatorService(db);
    db.transaction(() => { c.createTask({title:'must roll back'}); process.exit(17); });`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file], { encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 17, child.stderr);
  assert.equal(db.listTasks().length, 1);
  assert.equal(db.listCanonicalEvents().events.length, 1);
});

test("independent processes racing revision 1 yield one mutation and one conflict", async () => {
  const { service, file, db } = fixture();
  const task = service.createTask({ title: "race" });
  const code = `import {CoordinatorDatabase} from ${JSON.stringify(new URL("../../db/database.ts", import.meta.url).href)};
    import {CoordinatorService,ConflictError} from ${JSON.stringify(new URL("../coordinator.ts", import.meta.url).href)};
    const db=new CoordinatorDatabase(process.argv[1]); const c=new CoordinatorService(db);
    try { c.transitionTask(process.argv[2],{baseRevision:1,targetStatus:'assigned',ownerId:process.argv[3]}); console.log('applied'); }
    catch(e) { if(e instanceof ConflictError) console.log('conflict'); else { console.error(e); process.exitCode=1; } }
    finally { db.close(); }`;
  const contender = (owner: string) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, file, task.id, owner], { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  assert.deepEqual((await Promise.all([contender("a"), contender("b")])).sort(), ["applied", "conflict"]);
  assert.equal(service.getTask(task.id).revision, 2);
  assert.equal(db.listCanonicalEvents().events.length, 2);
});

test("invalid runtime request types and unsafe revisions are rejected before writes", () => {
  const { service } = fixture();
  for (const request of [null, { title: 42 }, { title: "x", description: {} }]) {
    assert.throws(() => service.createTask(request as any), ValidationError);
  }
  const task = service.createTask({ title: "valid" });
  for (const revision of [NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => service.transitionTask(task.id, { targetStatus: "assigned", baseRevision: revision }), ValidationError);
  }
  assert.equal(service.getTask(task.id).revision, 1);
});
