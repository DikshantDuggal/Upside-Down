import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RepairEngine, type RepairProvider } from "../repairEngine.ts";
import { PatchReviewEngine } from "../reviewEngine.ts";
import { ExecutionPipeline } from "../executionPipeline.ts";
import { TestRunner } from "../../workers/testRunner.ts";
import { validateSourcePath, resolveSourceFile } from "../../workers/pathPolicy.ts";
import { CoordinatorDatabase } from "../../db/database.ts";
import { CoordinatorService } from "../../core/coordinator.ts";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), "ud-a-safety with spaces-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "source.cjs"), "module.exports = () => 1 / 0;\n");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("ud-a-safety with spaces-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const request = (root: string) => ({ runId: "fixture-run", taskId: "fixture-task", workspacePath: root, trigger: "manual" as const });
const provider = (generateFix: RepairProvider["generateFix"]): RepairProvider => ({ name: "fixture-provider", isAvailable: async () => true, generateFix });

test("path policy rejects traversal, drive/UNC paths, aliases, secrets and tests", () => {
  for (const file of ["../escape.js", "/absolute.js", "C:/drive.js", "//server/share.js", "a\\..\\x.js",
    "source.js:stream", "./source.js", "foo./source.js", "NUL.js", ".git/config", "a/.env.local", "credentials.json",
    "tests/source.js", "TESTS/source.js", "__tests__/source.js", "src/a.test.ts", "test_source.js", "fixtures/source.js"]) {
    assert.throws(() => validateSourcePath(file), /./, file);
  }
  assert.equal(validateSourcePath("src/contest.ts"), "src/contest.ts");
});

test("junctions/symbolic links and hard links cannot redirect candidate writes", () => {
  const root = fixture(), outside = fixture();
  fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => resolveSourceFile(root, "linked/source.cjs"));
  fs.linkSync(path.join(outside, "source.cjs"), path.join(root, "hard.cjs"));
  assert.throws(() => resolveSourceFile(root, "hard.cjs"));
  assert.ok(fs.readFileSync(path.join(outside, "source.cjs"), "utf8").includes("/ 0"));
});

test("review inspects deleted paths, case aliases, link modes and redactable findings", () => {
  const review = new PatchReviewEngine();
  assert.equal(review.reviewPatch("--- a/.env\n+++ /dev/null\n@@ -1 +0,0 @@\n-secret\n").safe, false);
  assert.equal(review.reviewPatch("--- a/Source.js\n+++ b/source.js\n@@ -1 +1 @@\n-a\n+b\n").safe, false);
  assert.equal(review.reviewPatch("new file mode 120000\n--- /dev/null\n+++ b/link.js\n@@ -0,0 +1 @@\n+outside\n").safe, false);
  assert.equal(review.reviewPatch("index abc..def 160000\n--- a/submodule\n+++ b/submodule\n").safe, false);
  const fakeToken = "gho_" + "not_a_real_credential_".repeat(3);
  const result = review.reviewPatch(`--- a/source.js\n+++ b/source.js\n@@ -1 +1 @@\n-a\n+const token='${fakeToken}';\n`);
  assert.equal(result.safe, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Exposed GitHub token")));
  assert.ok(!JSON.stringify(result).includes(fakeToken));
});

test("provider exception after a failed attempt restores the exact original source", async () => {
  const root = fixture();
  const original = fs.readFileSync(path.join(root, "source.cjs"), "utf8");
  fs.writeFileSync(path.join(root, "always-fail.cjs"), "process.exit(1);\n");
  let attempts = 0;
  const engine = new RepairEngine({ maxAttempts: 2 }, provider(async () => {
    if (++attempts === 2) throw new Error("provider exception");
    return "module.exports = () => 1 / 1;\n";
  }));
  const result = await engine.executeRepair(request(root), "source.cjs", `node "${path.join(root, "always-fail.cjs")}"`);
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, 2);
  assert.equal(fs.readFileSync(path.join(root, "source.cjs"), "utf8"), original);
});

test("unavailable provider and unsafe candidate never run tests or edit the source", async () => {
  const root = fixture();
  const original = fs.readFileSync(path.join(root, "source.cjs"), "utf8");
  const marker = path.join(root, "should-not-exist");
  const testFile = path.join(root, "mark-test.cjs");
  fs.writeFileSync(testFile, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`);
  const engine = new RepairEngine({}, provider(async () => "module.exports = () => eval('1');\n"));
  assert.equal((await engine.executeRepair(request(root), "source.cjs", `node "${testFile}"`)).status, "blocked");
  assert.equal(fs.existsSync(marker), false);
  const unavailable = new RepairEngine({}, { ...provider(async () => "never"), isAvailable: async () => false });
  assert.equal((await unavailable.executeRepair(request(root), "source.cjs", `node "${testFile}"`)).status, "blocked");
  assert.equal(fs.readFileSync(path.join(root, "source.cjs"), "utf8"), original);
});

test("independent source changes are preserved instead of overwritten by a candidate", async () => {
  const root = fixture();
  const independent = "module.exports = () => 42;\n";
  const engine = new RepairEngine({}, provider(async () => {
    fs.writeFileSync(path.join(root, "source.cjs"), independent);
    return "module.exports = () => 1 / 1;\n";
  }));
  const result = await engine.executeRepair(request(root), "source.cjs", "node --version");
  assert.equal(result.status, "failed");
  assert.equal(fs.readFileSync(path.join(root, "source.cjs"), "utf8"), independent);
});

test("generated diffs pass real git apply --check for LF, CRLF and absent final newline", () => {
  const root = fixture();
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("config", "core.autocrlf", "false").status, 0);
  const engine = new RepairEngine();
  for (const [oldSource, newSource] of [["old\n", "new\n"], ["old\r\n", "new\r\n"], ["old", "new"], ["", "new\n"], ["old\n", ""]]) {
    fs.writeFileSync(path.join(root, "source.cjs"), oldSource);
    const patch = path.join(root, "candidate.patch");
    fs.writeFileSync(patch, engine.createUnifiedDiff("source.cjs", oldSource, newSource));
    const checked = git("apply", "--check", patch);
    assert.equal(checked.status, 0, checked.stderr);
    const applied = git("apply", patch);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(fs.readFileSync(path.join(root, "source.cjs"), "utf8"), newSource);
  }
});

test("test runner preserves spaced executable paths and bounds both output streams", async () => {
  const root = fixture();
  const result = await new TestRunner().run({ cwd: root, command: process.execPath,
    args: ["-e", "process.stdout.write('💡'.repeat(10000));process.stderr.write('x'.repeat(10000));"], maxOutputBytes: 127 });
  assert.equal(result.passed, true);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 127);
  assert.ok(Buffer.byteLength(result.stderr) <= 127);
});

test("pre-cancellation and untrusted Windows batch profiles do not execute", async () => {
  const root = fixture();
  const signal = AbortSignal.abort();
  const result = await new TestRunner().run({ cwd: root, command: process.execPath, args: ["-e", "process.exit(0)"], signal });
  assert.equal(result.passed, false);
  assert.equal(result.cancelled, true);
  if (process.platform === "win32") {
    const marker = path.join(root, "batch-ran");
    const batch = path.join(root, "untrusted.cmd");
    fs.writeFileSync(batch, `@echo off\r\necho executed > "${marker}"\r\n`);
    assert.equal((await new TestRunner().run({ cwd: root, command: batch })).passed, false);
    assert.equal(fs.existsSync(marker), false);
  }
});

for (const mode of ["timeout", "cancel"] as const) test(`${mode} stops the spawned process tree before resolving`, async () => {
  const root = fixture();
  const controller = new AbortController();
  const code = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log('CHILD:'+c.pid); setInterval(()=>{},1000);`;
  const timer = mode === "cancel" ? setTimeout(() => controller.abort(), 700) : undefined;
  try {
    const result = await new TestRunner().run({ cwd: root, command: process.execPath, args: ["-e", code], timeoutMs: 1200, signal: controller.signal });
    assert.equal(result.passed, false);
    assert.equal(mode === "timeout" ? result.timedOut : result.cancelled, true);
    const childId = Number(result.stdout.match(/CHILD:(\d+)/)?.[1]);
    assert.ok(childId > 0, "The fixture must actually spawn a descendant");
    assert.throws(() => process.kill(childId, 0), /./, "Descendant should no longer be running");
  } finally { if (timer) clearTimeout(timer); }
});

test("a stale repair run cannot propose a patch or fail a newer task revision", async () => {
  const root = fixture();
  const db = new CoordinatorDatabase();
  const c = new CoordinatorService(db);
  fs.writeFileSync(path.join(root, "check.cjs"), "process.exit(require('./source.cjs')()===1 ? 0 : 1);\n");
  const pipeline = new ExecutionPipeline({ workspacePath: root, autoWatch: false,
    testCommand: `node "${path.join(root, "check.cjs")}"`, repairProvider: provider(async () => {
      const task = c.listTasks()[0];
      c.transitionTask(task.id, { baseRevision: task.revision, targetStatus: "blocked", reason: "human changed task" });
      return "module.exports = () => 1 / 1;\n";
    }) }, c);
  try {
    const result = await pipeline.handleFileChange(["source.cjs"]);
    assert.equal(result?.status, "blocked");
    const task = c.listTasks()[0];
    assert.equal(task.status, "blocked");
    assert.equal(task.revision, 3);
    assert.equal(c.getPatchByTaskId(task.id), null);
    assert.ok(fs.readFileSync(path.join(root, "source.cjs"), "utf8").includes("/ 0"));
  } finally { pipeline.stop(); db.close(); }
});


test("restricted test execution does not inherit coordinator credential environment", async () => {
  const root = fixture();
  process.env.UD_TEST_PRIVATE_CREDENTIAL = "private-fixture-value";
  try {
    const result = await new TestRunner().run({ cwd: root, command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.UD_TEST_PRIVATE_CREDENTIAL || 'absent')"], inheritEnvironment: false, env: {} });
    assert.equal(result.passed, true); assert.equal(result.stdout, "absent");
  } finally { delete process.env.UD_TEST_PRIVATE_CREDENTIAL; }
});
