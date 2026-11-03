import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { CoordinatorDatabase } from "../../db/database.ts";
import { CoordinatorService } from "../../core/coordinator.ts";
import { AuthenticationService } from "../../core/auth.ts";
import { ExecutionJobService } from "../jobService.ts";

const fixtures: { root: string; db: CoordinatorDatabase; jobs: ExecutionJobService }[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-jobs with spaces-"));
  const source = path.join(root, "source"), integration = path.join(root, "integration"); fs.mkdirSync(source);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(source, "init", "--quiet", "--initial-branch=source"); git(source, "config", "core.autocrlf", "false");
  git(source, "config", "user.name", "Backend A Fixture"); git(source, "config", "user.email", "fixture@localhost");
  fs.writeFileSync(path.join(source, "source.cjs"), "module.exports = () => 1 / 0;\n");
  fs.writeFileSync(path.join(source, "check.cjs"), "process.exit(require('./source.cjs')()===1 ? 0 : 1);\n");
  git(source, "add", "source.cjs", "check.cjs"); git(source, "commit", "--quiet", "-m", "fixture base");
  const base = git(source, "rev-parse", "HEAD");
  git(source, "worktree", "add", "-b", "integration", integration, base);
  const file = path.join(root, "coordinator.db"), db = new CoordinatorDatabase(file);
  const c = new CoordinatorService(db, { patchCompletionMode: "verified_application" }), auth = new AuthenticationService(db);
  const principal = auth.enroll(randomUUID()).principal, reviewer = auth.enroll(randomUUID(), "reviewer").principal;
  const configuration = { runtimeDirectory: path.join(root, "runtime"), workspaces: [
    { id: "source", repositoryPath: source, repairTargetFile: "source.cjs", allowedPaths: ["source.cjs"], testProfileIds: ["check", "slow"] },
    { id: "integration", repositoryPath: integration, integrationBranch: "integration", allowedPaths: ["source.cjs"], testProfileIds: ["check", "fail"] },
  ], testProfiles: [
    { id: "check", executable: process.execPath, args: ["check.cjs"], timeoutMs: 5000 },
    { id: "fail", executable: process.execPath, args: ["-e", "process.exit(1)"], timeoutMs: 5000 },
    { id: "slow", executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], timeoutMs: 5000 },
  ] };
  const jobs = new ExecutionJobService(db, c, auth, configuration);
  fixtures.push({ root, db, jobs });
  const task = c.createTask({ title: "Fix registered source" });
  const input = { baseRevision: 1, workspaceId: "source", testProfileId: "check", trigger: "manual" as const };
  return { root, source, integration, file, base, db, c, auth, principal, reviewer, jobs, task, input, git, configuration };
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.jobs.shutdown(); try { f.db.close(); } catch {}
    assert.equal(path.dirname(f.root), path.resolve(tmpdir()));
    assert.ok(path.basename(f.root).startsWith("ud-jobs with spaces-"));
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
async function reviewed(f: ReturnType<typeof fixture>) {
  const run = f.jobs.enqueueRun(f.task.id, f.input, f.principal, "run-1");
  await f.jobs.executeRun(run.id);
  const finished = f.jobs.getRun(run.id);
  assert.equal(finished.status, "review", JSON.stringify(finished.error));
  const patch = f.c.getPatch(finished.patchId!);
  return { run, finished, patch };
}
function applyInput(f: ReturnType<typeof fixture>, patch: ReturnType<CoordinatorService["getPatch"]>, testProfileId = "check") {
  return { expectedTaskRevision: patch.taskRevision!, expectedBaseCommit: f.base, expectedDiffHash: patch.diffHash!, targetWorkspaceId: "integration", testProfileId };
}

test("durable run uses an isolated worktree, actual tests and metadata-only checkpoints", async () => {
  const f = fixture(); const { finished, patch } = await reviewed(f);
  assert.equal(finished.evidence.length, 2);
  assert.equal(finished.evidence[0].passed, false); assert.equal(finished.evidence[1].passed, true);
  assert.ok(finished.evidence.every((e) => /^[0-9a-f]{40,64}$/.test(e.treeHash)));
  assert.equal(f.c.getTask(f.task.id).status, "review");
  assert.equal(patch.review?.safe, true); assert.equal(patch.baseCommit, f.base);
  assert.ok(fs.readFileSync(path.join(f.source, "source.cjs"), "utf8").includes("/ 0"));
  assert.equal(f.git(f.source, "status", "--porcelain"), "");
  assert.equal(f.git(f.source, "rev-parse", "HEAD"), f.base);
  assert.ok(f.db.listRecords<any>("checkpoints").every((row) => row.value.recoveryCapability === "metadata_only"));
});

test("run idempotency returns the original queued record and rejects changed bodies", async () => {
  const f = fixture(); const first = f.jobs.enqueueRun(f.task.id, f.input, f.principal, "same");
  assert.deepEqual(f.jobs.enqueueRun(f.task.id, f.input, f.principal, "same"), first);
  await f.jobs.executeRun(first.id);
  fs.writeFileSync(path.join(f.source, "independent.txt"), "preserve");
  assert.deepEqual(f.jobs.enqueueRun(f.task.id, f.input, f.principal, "same"), first);
  assert.throws(() => f.jobs.enqueueRun(f.task.id, { ...f.input, testProfileId: "slow" }, f.principal, "same"), { code: "IDEMPOTENCY_KEY_REUSE" });
});

test("approval changes no source; explicit apply produces verified commit and guarded done", async () => {
  const f = fixture(); const { patch } = await reviewed(f);
  f.c.approvePatch(patch.id, f.reviewer.id);
  assert.equal(f.c.getTask(f.task.id).status, "review");
  assert.equal(f.git(f.integration, "rev-parse", "HEAD"), f.base);
  assert.throws(() => f.c.transitionTask(f.task.id, { baseRevision: f.c.getTask(f.task.id).revision, targetStatus: "done" }));
  const job = f.jobs.enqueueApplication(patch.id, applyInput(f, patch), f.reviewer, "apply-1");
  await f.jobs.executeApplication(job.id);
  const applied = f.jobs.getApplication(job.id);
  assert.equal(applied.status, "verified", JSON.stringify(applied.error));
  assert.ok(applied.evidence.at(-1)?.passed); assert.ok(applied.commit);
  assert.equal(f.git(f.integration, "rev-parse", "HEAD"), applied.commit);
  assert.equal(f.c.getTask(f.task.id).status, "done");
  assert.equal(f.c.getPatch(patch.id).applicationStatus, "verified");
  assert.equal(f.c.getPatch(patch.id).status, "approved");
  assert.ok(fs.readFileSync(path.join(f.source, "source.cjs"), "utf8").includes("/ 0"));
  assert.ok(fs.readFileSync(path.join(f.integration, "source.cjs"), "utf8").includes("/ 1"));
});

test("failed application tests leave target and review task unchanged", async () => {
  const f = fixture(); const { patch } = await reviewed(f); f.c.approvePatch(patch.id, f.reviewer.id);
  const job = f.jobs.enqueueApplication(patch.id, applyInput(f, patch, "fail"), f.reviewer, "failing-apply");
  await f.jobs.executeApplication(job.id);
  assert.equal(f.jobs.getApplication(job.id).status, "blocked");
  assert.equal(f.jobs.getApplication(job.id).evidence.at(-1)?.passed, false);
  assert.equal(f.git(f.integration, "rev-parse", "HEAD"), f.base);
  assert.equal(f.c.getTask(f.task.id).status, "review");
});

test("dirty target, changed base/hash, arbitrary profile and device application are blocked", async () => {
  const f = fixture(); const { patch } = await reviewed(f); f.c.approvePatch(patch.id, f.reviewer.id);
  const input = applyInput(f, patch);
  assert.throws(() => f.jobs.enqueueApplication(patch.id, input, f.principal, "device"), { code: "REVIEWER_REQUIRED" });
  assert.throws(() => f.jobs.enqueueApplication(patch.id, { ...input, expectedDiffHash: "0".repeat(64) }, f.reviewer, "hash"), { code: "PATCH_IDENTITY_CHANGED" });
  assert.throws(() => f.jobs.enqueueRun(f.task.id, { ...f.input, workspaceId: "arbitrary-disk-path" }, f.principal, "path"), { code: "UNKNOWN_WORKSPACE" });
  fs.writeFileSync(path.join(f.integration, "human-work.txt"), "preserve");
  assert.throws(() => f.jobs.enqueueApplication(patch.id, input, f.reviewer, "dirty"), { code: "DIRTY_WORKSPACE" });
  assert.equal(fs.readFileSync(path.join(f.integration, "human-work.txt"), "utf8"), "preserve");
});

test("running cancellation waits for process shutdown before recording cancelled", async () => {
  const f = fixture();
  const run = f.jobs.enqueueRun(f.task.id, { ...f.input, testProfileId: "slow" }, f.principal, "slow");
  const executing = f.jobs.executeRun(run.id);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const requested = f.jobs.cancelRun(run.id, "human requested cancellation", f.principal, "cancel");
  assert.equal(requested.cancellationRequested, true);
  await executing;
  assert.equal(f.jobs.getRun(run.id).status, "cancelled");
  assert.equal(f.db.readRecord("workspace_locks", "source"), undefined);
});

test("restart marks interrupted runs blocked rather than claiming recovery of model state", async () => {
  const f = fixture(); const run = f.jobs.enqueueRun(f.task.id, f.input, f.principal, "interrupted");
  f.db.putRecord("runs", run.id, { ...run, status: "running", stage: "repair" });
  f.db.putRecord("workspace_locks", "source", run.id);
  await f.jobs.recover();
  assert.equal(f.jobs.getRun(run.id).status, "blocked");
  assert.equal(f.jobs.getRun(run.id).error?.code, "RECOVERY_REQUIRED");
  assert.equal(f.db.readRecord("workspace_locks", "source"), undefined);
});

test("Git-advanced/DB-failed application reconciles once by immutable commit marker", async () => {
  const f = fixture(); const { patch } = await reviewed(f); f.c.approvePatch(patch.id, f.reviewer.id);
  const job = f.jobs.enqueueApplication(patch.id, applyInput(f, patch), f.reviewer, "recover-apply");
  const sql = new DatabaseSync(f.file);
  try {
    sql.exec(`CREATE TRIGGER fail_verified BEFORE INSERT ON coordinator_records
      WHEN NEW.kind='applications' AND NEW.value LIKE '%"status":"verified"%'
      BEGIN SELECT RAISE(ABORT,'simulated final storage failure'); END;`);
    await f.jobs.executeApplication(job.id);
    const commit = f.git(f.integration, "rev-parse", "HEAD");
    assert.notEqual(commit, f.base);
    assert.equal(f.jobs.getApplication(job.id).status, "applying");
    assert.equal(f.c.getTask(f.task.id).status, "review");
    sql.exec("DROP TRIGGER fail_verified");
    await f.jobs.recover();
    assert.equal(f.jobs.getApplication(job.id).status, "verified");
    assert.equal(f.jobs.getApplication(job.id).commit, commit);
    assert.equal(f.c.getTask(f.task.id).status, "done");
    await f.jobs.recover();
    assert.equal(f.git(f.integration, "rev-parse", "HEAD"), commit);
    assert.equal(f.git(f.integration, "rev-list", "--count", `${f.base}..HEAD`), "1");
  } finally { sql.close(); }
});


test("test-side Git HEAD changes invalidate evidence and never propose a patch", async () => {
  const f = fixture();
  f.configuration.testProfiles.push({ id: "mutate-head", executable: process.execPath, timeoutMs: 5000,
    args: ["-e", "require('node:child_process').execFileSync('git',['-c','user.name=fixture','-c','user.email=fixture@localhost','commit','--allow-empty','-m','unexpected test commit'],{stdio:'pipe',windowsHide:true});"] });
  f.configuration.workspaces[0].testProfileIds.push("mutate-head");
  const service = new ExecutionJobService(f.db, f.c, f.auth, f.configuration);
  const run = service.enqueueRun(f.task.id, { ...f.input, testProfileId: "mutate-head" }, f.principal, "head-change");
  await service.executeRun(run.id);
  assert.equal(service.getRun(run.id).status, "blocked");
  assert.equal(service.getRun(run.id).error?.code, "WORKSPACE_MUTATED_DURING_TEST");
  assert.equal(f.c.getTask(f.task.id).status, "blocked");
  assert.equal(f.c.getPatchByTaskId(f.task.id), null);
  assert.equal(f.git(f.source, "rev-parse", "HEAD"), f.base);
  await service.shutdown();
});
