import { randomUUID } from "node:crypto";
import type { ApplicationRecord, ApplyRequest, Checkpoint, RunRecord, TestEvidence } from "../../contracts/agent.ts";
import type { CoordinatorDatabase, PatchRecord } from "../db/database.ts";
import type { CoordinatorService } from "../core/coordinator.ts";
import { AuthenticationService, type AuthenticatedPrincipal } from "../core/auth.ts";
import { IdempotencyStore } from "../core/idempotency.ts";
import { ProtocolError } from "../core/protocolError.ts";
import { GitWorkspaceManager, diffHash, type ExecutionConfiguration, type TrustedWorkspace, type TrustedTestProfile } from "../workers/gitWorkspace.ts";
import { TestRunner } from "../workers/testRunner.ts";
import { RepairEngine } from "./repairEngine.ts";
import { PatchReviewEngine } from "./reviewEngine.ts";

interface RunInput { baseRevision: number; workspaceId: string; testProfileId: string; trigger: "manual" }
interface JobMeta { principal: AuthenticatedPrincipal; ownedRevision: number; profileId: string; worktree?: string; testedTree?: string; commit?: string }
const now = () => new Date().toISOString();
const redact = (value: string) => value.replace(/(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]+/gi, "[REDACTED]");
const terminalRun = new Set(["review", "completed", "failed", "blocked", "cancelled", "timeout"]);

export class ExecutionJobService {
  private db: CoordinatorDatabase;
  private coordinator: CoordinatorService;
  private auth: AuthenticationService;
  private idempotency: IdempotencyStore;
  readonly workspaces: GitWorkspaceManager;
  private processing?: Promise<void>;
  private stopping = false;
  private active?: { id: string; controller: AbortController };

  constructor(db: CoordinatorDatabase, coordinator: CoordinatorService, auth: AuthenticationService, configuration: ExecutionConfiguration) {
    this.db = db; this.coordinator = coordinator; this.auth = auth;
    this.idempotency = new IdempotencyStore(db); this.workspaces = new GitWorkspaceManager(configuration);
  }
  private emit(type: string, taskId: string, payload: Record<string, unknown>) {
    this.coordinator.recordExternalEvent({ id: randomUUID(), taskId, source: "execution_worker", type, timestamp: now(), payload });
  }
  private saveRun(run: RunRecord) {
    this.db.transaction(() => { this.db.putRecord("runs", run.id, run); this.emit("run_changed", run.taskId, { run }); });
  }
  private saveApplication(application: ApplicationRecord) {
    this.db.transaction(() => {
      this.db.putRecord("applications", application.id, application);
      const metadata = this.db.readRecord<Partial<PatchRecord>>("patch_metadata", application.patchId) ?? {};
      this.db.putRecord("patch_metadata", application.patchId, { ...metadata, applicationId: application.id, applicationStatus: application.status });
      this.emit("patch_application_changed", application.taskId, { application });
    });
  }
  private blockOwnedTask(run: RunRecord, meta: JobMeta) {
    const task = this.coordinator.getTask(run.taskId);
    if (task.status === "running" && task.revision === meta.ownedRevision) {
      this.coordinator.transitionTask(task.id, { baseRevision: task.revision, targetStatus: "blocked", reason: `Run ${run.id}: ${run.status}` }, "execution_worker");
    }
  }
  private checkpoint(run: RunRecord, meta: JobMeta, summary: string) {
    const checkpoint: Checkpoint = { id: randomUUID(), taskId: run.taskId, runId: run.id, deviceId: meta.principal.deviceId,
      baseCommit: run.baseCommit, taskRevision: meta.ownedRevision, stage: run.stage, createdAt: now(), summary, recoveryCapability: "metadata_only" };
    this.db.transaction(() => { this.db.insertRecord("checkpoints", checkpoint.id, checkpoint); this.emit("checkpoint_recorded", run.taskId, { checkpoint }); });
  }
  getRun(id: string): RunRecord {
    const run = this.db.readRecord<RunRecord>("runs", id);
    if (!run) throw new ProtocolError(404, "RUN_NOT_FOUND", "Run not found"); return run;
  }
  getApplication(id: string): ApplicationRecord {
    const job = this.db.readRecord<ApplicationRecord>("applications", id);
    if (!job) throw new ProtocolError(404, "APPLICATION_NOT_FOUND", "Application not found"); return job;
  }
  enqueueRun(taskId: string, input: RunInput, principal: AuthenticatedPrincipal, key: string): RunRecord {
    if (!key) throw new ProtocolError(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key is required");
    if (!input || Object.keys(input).some((field) => !["baseRevision", "workspaceId", "testProfileId", "trigger"].includes(field))
        || input.trigger !== "manual" || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1) throw new ProtocolError(400, "INVALID_RUN", "Invalid run request");
    const scope = `${principal.id}:POST:tasks/${taskId}/runs`;
    const previous = this.idempotency.lookup<RunRecord>(scope, key, input);
    if (previous) return previous.result;
    const workspace = this.workspaces.workspace(input.workspaceId), profile = this.workspaces.profile(workspace, input.testProfileId);
    this.workspaces.clean(workspace.repositoryPath);
    const baseCommit = this.workspaces.head(workspace);
    const run = this.idempotency.execute(scope, key, input, () => {
      const task = this.coordinator.getTask(taskId);
      if (task.revision !== input.baseRevision) throw new ProtocolError(409, "STALE_REVISION", "Task revision changed", { currentRevision: task.revision, baseRevision: input.baseRevision });
      const current = task.status === "running" ? task : this.coordinator.transitionTask(taskId, { baseRevision: task.revision, targetStatus: "running" }, "execution_worker");
      const created: RunRecord = { id: randomUUID(), taskId, baseRevision: input.baseRevision, workspaceId: workspace.id, baseCommit,
        provider: "offline-heuristic-provider", status: "queued", stage: "queued", attempts: 0, maxAttempts: 3,
        cancellationRequested: false, createdAt: now(), evidence: [] };
      this.db.insertRecord("run_meta", created.id, { principal, ownedRevision: current.revision, profileId: profile.id } satisfies JobMeta);
      this.saveRun(created); this.checkpoint(created, this.db.readRecord<JobMeta>("run_meta", created.id)!, "Run durably queued");
      return created;
    });
    return run;
  }
  cancelRun(id: string, reason: string, principal: AuthenticatedPrincipal, key: string): RunRecord {
    if (!key || typeof reason !== "string" || !reason.trim() || reason.length > 2048) throw new ProtocolError(400, "INVALID_CANCELLATION", "Reason and Idempotency-Key are required");
    const run = this.idempotency.execute(`${principal.id}:POST:runs/${id}/cancel`, key, { reason }, () => {
      const run = this.getRun(id), meta = this.db.readRecord<JobMeta>("run_meta", id)!;
      if (meta.principal.id !== principal.id) this.auth.requireReviewer(principal);
      if (!terminalRun.has(run.status)) {
        run.cancellationRequested = true;
        if (run.status === "queued") { run.status = "cancelled"; run.stage = "finished"; run.endedAt = now(); this.blockOwnedTask(run, meta); }
        this.saveRun(run);
      }
      return run;
    });
    if (this.active?.id === id) this.active.controller.abort();
    return run;
  }
  enqueueApplication(patchId: string, input: ApplyRequest, principal: AuthenticatedPrincipal, key: string): ApplicationRecord {
    this.auth.requireReviewer(principal);
    if (this.coordinator.patchCompletionMode !== "verified_application") throw new ProtocolError(409, "VERIFIED_MODE_REQUIRED", "Verified application mode is not enabled");
    if (!key || !input || Object.keys(input).some((field) => !["expectedTaskRevision", "expectedBaseCommit", "expectedDiffHash", "targetWorkspaceId", "testProfileId"].includes(field))
        || !Number.isSafeInteger(input.expectedTaskRevision) || input.expectedTaskRevision < 1) throw new ProtocolError(400, "INVALID_APPLICATION", "Invalid application request");
    const scope = `${principal.id}:POST:patches/${patchId}/apply`;
    const previous = this.idempotency.lookup<ApplicationRecord>(scope, key, input);
    if (previous) return previous.result;
    const target = this.workspaces.workspace(input.targetWorkspaceId), profile = this.workspaces.profile(target, input.testProfileId);
    this.workspaces.integrationTarget(target, input.expectedBaseCommit);
    return this.idempotency.execute(scope, key, input, () => {
      const patch = this.coordinator.getPatch(patchId), task = this.coordinator.getTask(patch.taskId);
      if (patch.status !== "approved" || !patch.review?.safe || !patch.baseCommit || !patch.diffHash) throw new ProtocolError(422, "PATCH_NOT_APPLICABLE", "Patch needs approved immutable safe metadata");
      if (task.status !== "review" || task.revision !== input.expectedTaskRevision || patch.taskRevision !== task.revision) throw new ProtocolError(409, "STALE_REVISION", "Patch task revision changed");
      if (input.expectedBaseCommit !== patch.baseCommit || input.expectedDiffHash !== patch.diffHash || diffHash(patch.diffContent) !== patch.diffHash) throw new ProtocolError(409, "PATCH_IDENTITY_CHANGED", "Patch base or diff hash changed");
      if (patch.applicationId) throw new ProtocolError(409, "APPLICATION_EXISTS", "Patch already has an application job");
      const job: ApplicationRecord = { id: randomUUID(), patchId, taskId: patch.taskId, status: "queued", expectedBaseCommit: input.expectedBaseCommit,
        targetWorkspaceId: target.id, diffHash: patch.diffHash, requestedBy: principal.id, requestedAt: now(), evidence: [] };
      this.db.insertRecord("application_meta", job.id, { principal, ownedRevision: task.revision, profileId: profile.id } satisfies JobMeta);
      this.saveApplication(job); return job;
    });
  }
  private executionEnvironment(): NodeJS.ProcessEnv {
    const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LANG|LC_ALL)$/i;
    return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key))),
      CI: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
  }
  private async evidence(root: string, profile: TrustedTestProfile, runId: string, signal: AbortSignal, files: string[] = []): Promise<TestEvidence> {
    const treeHash = this.workspaces.tree(root, files), before = this.workspaces.git(root, ["diff", "--binary", "HEAD"]);
    const testedCommit = this.workspaces.git(root, ["rev-parse", "HEAD"]);
    const startedAt = now();
    const result = await new TestRunner().run({ cwd: root, command: profile.executable, args: profile.args, timeoutMs: profile.timeoutMs, signal, inheritEnvironment: false, env: this.executionEnvironment() });
    const after = this.workspaces.git(root, ["diff", "--binary", "HEAD"]);
    if (before !== after || this.workspaces.git(root, ["rev-parse", "HEAD"]) !== testedCommit
        || this.workspaces.tree(root) !== treeHash) throw new ProtocolError(409, "WORKSPACE_MUTATED_DURING_TEST", "Tests changed tracked source; evidence cannot be accepted");
    return { id: randomUUID(), runId, commandProfileId: profile.id, startedAt, endedAt: now(), exitCode: result.exitCode,
      timedOut: result.timedOut, passed: result.passed, stdout: redact(result.stdout), stderr: redact(result.stderr), truncated: !!result.truncated,
      testedCommit, treeHash };
  }
  private fail(error: unknown, fallback: string): ProtocolError {
    return error instanceof ProtocolError ? error : new ProtocolError(500, fallback, "Controlled execution failed; inspect the job evidence");
  }
  private lock(workspaceId: string, jobId: string) {
    this.db.transaction(() => {
      if (this.db.readRecord("workspace_locks", workspaceId)) throw new ProtocolError(409, "WORKSPACE_BUSY", "Workspace is locked by another job");
      this.db.insertRecord("workspace_locks", workspaceId, jobId);
    });
  }
  private unlock(workspaceId: string, jobId: string) {
    if (this.db.readRecord("workspace_locks", workspaceId) === jobId) this.db.deleteRecord("workspace_locks", workspaceId);
  }
  async executeRun(id: string): Promise<void> {
    let run = this.getRun(id);
    if (run.status !== "queued") return;
    const meta = this.db.readRecord<JobMeta>("run_meta", id)!;
    const workspace = this.workspaces.workspace(run.workspaceId), profile = this.workspaces.profile(workspace, meta.profileId);
    const controller = new AbortController(); this.active = { id, controller };
    let root: string | undefined;
    try {
      this.lock(workspace.id, id);
      this.workspaces.clean(workspace.repositoryPath);
      if (this.workspaces.head(workspace) !== run.baseCommit) throw new ProtocolError(409, "BASE_COMMIT_CHANGED", "Registered source base changed before execution");
      root = this.workspaces.create(workspace, id, run.baseCommit);
      meta.worktree = root; this.db.putRecord("run_meta", id, meta);
      run = { ...run, status: "running", stage: "baseline", startedAt: now() }; this.saveRun(run); this.checkpoint(run, meta, "Isolated baseline started");
      const baseline = await this.evidence(root, profile, id, controller.signal); run.evidence.push(baseline);
      this.emit("tests_completed", run.taskId, { evidence: baseline });
      if (controller.signal.aborted) throw new ProtocolError(409, "CANCELLED", "Run was cancelled");
      if (baseline.timedOut) throw new ProtocolError(422, "TEST_TIMEOUT", "Baseline tests timed out");
      if (baseline.passed) { run.status = "completed"; run.stage = "finished"; }
      else {
        if (!workspace.repairTargetFile) throw new ProtocolError(422, "NO_REPAIR_TARGET", "No trusted repair target was configured");
        this.workspaces.checkPaths(root, workspace, [workspace.repairTargetFile]);
        run.stage = "repair"; this.saveRun(run);
        const repaired = await new RepairEngine({ maxAttempts: 3, timeoutMs: profile.timeoutMs }).executeRepair({ runId: id, taskId: run.taskId,
          workspacePath: root, trigger: "manual", testOutput: baseline.stderr + "\n" + baseline.stdout }, workspace.repairTargetFile,
        { command: profile.executable, args: profile.args, signal: controller.signal, inheritEnvironment: false, env: this.executionEnvironment() });
        run.attempts = repaired.attempts;
        if (controller.signal.aborted) throw new ProtocolError(409, "CANCELLED", "Run was cancelled");
        if (repaired.status !== "completed" || !repaired.diffContent) throw new ProtocolError(422, "REPAIR_BLOCKED", "Heuristic repair did not produce a verified candidate");
        const review = new PatchReviewEngine().reviewPatch(repaired.diffContent);
        if (!review.safe) throw new ProtocolError(422, "UNSAFE_PATCH", "Patch review blocked candidate");
        this.workspaces.checkPaths(root, workspace, review.touchedFiles);
        this.workspaces.apply(root, repaired.diffContent);
        run.stage = "verification"; this.saveRun(run);
        const verified = await this.evidence(root, profile, id, controller.signal, review.touchedFiles); run.evidence.push(verified);
        this.emit("tests_completed", run.taskId, { evidence: verified });
        if (controller.signal.aborted) throw new ProtocolError(409, "CANCELLED", "Run was cancelled");
        if (!verified.passed) throw new ProtocolError(422, "VERIFICATION_FAILED", "Candidate verification failed");
        const patch = this.coordinator.proposePatch(run.taskId, id, repaired.diffContent, undefined, undefined, meta.ownedRevision,
          { baseCommit: run.baseCommit, diffHash: diffHash(repaired.diffContent), review, evidence: run.evidence });
        run.patchId = patch.id; run.status = "review"; run.stage = "review";
      }
    } catch (error) {
      const failure = this.fail(error, "RUN_FAILED");
      run.status = failure.code === "CANCELLED" ? "cancelled" : failure.code === "TEST_TIMEOUT" ? "timeout" : "blocked";
      run.stage = "finished"; run.error = failure.body();
      this.blockOwnedTask(run, meta);
    } finally {
      run.cancellationRequested = this.getRun(id).cancellationRequested || controller.signal.aborted;
      run.endedAt = now(); this.saveRun(run); this.checkpoint(run, meta, "Bounded run ended; recovery remains metadata only");
      if (root) { try { this.workspaces.dispose(workspace, root); } catch { /* retain owned artifacts for operator recovery */ } }
      this.unlock(workspace.id, id); this.active = undefined;
    }
  }
  async executeApplication(id: string): Promise<void> {
    let job = this.getApplication(id); if (job.status !== "queued") return;
    const meta = this.db.readRecord<JobMeta>("application_meta", id)!;
    const target = this.workspaces.workspace(job.targetWorkspaceId), profile = this.workspaces.profile(target, meta.profileId);
    let root: string | undefined, integrated = false;
    const controller = new AbortController(); this.active = { id, controller };
    try {
      this.lock(target.id, id);
      this.db.transaction(() => {
        if (this.db.readRecord("application_task_locks", job.taskId)) throw new ProtocolError(409, "TASK_BUSY", "Task already has an application job");
        this.db.insertRecord("application_task_locks", job.taskId, id);
      });
      const patch = this.coordinator.getPatch(job.patchId);
      if (patch.status !== "approved" || !patch.review?.safe || patch.diffHash !== job.diffHash || diffHash(patch.diffContent) !== job.diffHash
          || patch.baseCommit !== job.expectedBaseCommit || this.coordinator.getTask(job.taskId).revision !== meta.ownedRevision) throw new ProtocolError(409, "PATCH_IDENTITY_CHANGED", "Approved patch or task changed before application");
      this.workspaces.integrationTarget(target, job.expectedBaseCommit);
      root = this.workspaces.create(target, id, job.expectedBaseCommit, true);
      meta.worktree = root; this.db.putRecord("application_meta", id, meta);
      job = { ...job, status: "applying", startedAt: now() }; this.saveApplication(job);
      const review = new PatchReviewEngine().reviewPatch(patch.diffContent);
      if (!review.safe) throw new ProtocolError(422, "UNSAFE_PATCH", "Application patch review failed");
      this.workspaces.checkPaths(root, target, review.touchedFiles); this.workspaces.apply(root, patch.diffContent);
      const tested = await this.evidence(root, profile, id, controller.signal, review.touchedFiles); job.evidence.push(tested);
      this.emit("tests_completed", job.taskId, { evidence: tested });
      if (!tested.passed || controller.signal.aborted) throw new ProtocolError(422, "APPLICATION_TESTS_FAILED", "Application tests did not pass");
      meta.testedTree = tested.treeHash;
      this.db.transaction(() => { this.db.putRecord("application_meta", id, meta); this.saveApplication(job); });
      const commit = this.workspaces.commit(root, id, job.diffHash);
      meta.commit = commit; this.db.putRecord("application_meta", id, meta);
      this.workspaces.integrationTarget(target, job.expectedBaseCommit);
      if (this.coordinator.getTask(job.taskId).revision !== meta.ownedRevision) throw new ProtocolError(409, "STALE_REVISION", "Task changed before integration");
      this.workspaces.git(target.repositoryPath, ["merge", "--ff-only", commit]); integrated = true;
      this.completeApplication({ ...job, status: "verified", commit, endedAt: now() }, meta);
    } catch (error) {
      if (integrated) {
        // Git already advanced: preserve the applying job and lock for reconciliation.
        // Never retry the patch blindly or report an unpersisted verification.
        return;
      }
      const failure = this.fail(error, "APPLICATION_FAILED");
      job = { ...job, status: "blocked", endedAt: now(), error: failure.body() }; this.saveApplication(job);
    } finally {
      if (!integrated || this.getApplication(id).status === "verified") {
        if (root) { try { this.workspaces.dispose(target, root); } catch {} }
        this.unlock(target.id, id);
        if (this.db.readRecord("application_task_locks", job.taskId) === id) this.db.deleteRecord("application_task_locks", job.taskId);
      }
      this.active = undefined;
    }
  }
  private completeApplication(job: ApplicationRecord, meta: JobMeta) {
    this.db.transaction(() => {
      this.saveApplication(job);
      this.coordinator.finishVerifiedApplication(job.id, meta.ownedRevision);
    });
  }
  async recover(): Promise<void> {
    for (const { value: run } of this.db.listRecords<RunRecord>("runs", "", 10000)) if (run.status === "running") {
      run.status = "blocked"; run.stage = "finished"; run.endedAt = now();
      run.error = new ProtocolError(409, "RECOVERY_REQUIRED", "Interrupted run requires artifact inspection before retry").body();
      this.saveRun(run); this.blockOwnedTask(run, this.db.readRecord<JobMeta>("run_meta", run.id)!); this.unlock(run.workspaceId, run.id);
    }
    for (const { value: job } of this.db.listRecords<ApplicationRecord>("applications", "", 10000)) if (job.status === "applying") {
      const meta = this.db.readRecord<JobMeta>("application_meta", job.id)!;
      const target = this.workspaces.workspace(job.targetWorkspaceId);
      try {
        const commit = meta.commit ?? this.workspaces.git(target.repositoryPath, ["rev-parse", `ud-application/${job.id}`]);
        const marker = this.workspaces.git(target.repositoryPath, ["show", "-s", "--format=%B", commit]);
        const tree = this.workspaces.git(target.repositoryPath, ["rev-parse", `${commit}^{tree}`]);
        const parent = this.workspaces.git(target.repositoryPath, ["rev-parse", `${commit}^`]);
        if (!meta.testedTree || tree !== meta.testedTree || parent !== job.expectedBaseCommit
            || !marker.includes(`UD-Application: ${job.id}`) || !marker.includes(`UD-Diff-Hash: ${job.diffHash}`) || !job.evidence.at(-1)?.passed) throw new Error("No verified immutable commit marker");
        const patch = this.coordinator.getPatch(job.patchId), task = this.coordinator.getTask(job.taskId);
        if (task.status !== "review" || task.revision !== meta.ownedRevision || patch.status !== "approved"
            || !patch.review?.safe || patch.baseCommit !== job.expectedBaseCommit || patch.diffHash !== job.diffHash
            || diffHash(patch.diffContent) !== job.diffHash) throw new Error("Recovery identity changed");
        this.workspaces.integrationTarget(target, job.expectedBaseCommit, commit);
        if (this.workspaces.git(target.repositoryPath, ["rev-parse", "HEAD"]) === job.expectedBaseCommit) this.workspaces.git(target.repositoryPath, ["merge", "--ff-only", commit]);
        this.completeApplication({ ...job, status: "verified", commit, endedAt: now() }, meta);
        this.unlock(target.id, job.id); this.db.deleteRecord("application_task_locks", job.taskId);
      } catch {
        job.error = new ProtocolError(409, "RECOVERY_REQUIRED", "Application needs manual Git/database reconciliation; target remains locked").body();
        this.saveApplication(job);
      }
    }
  }
  /** Finite queue drain; no polling loop, shell agent or recursive Codex invocation. */
  kick(): void {
    if (this.processing || this.stopping) return;
    this.processing = this.drain().finally(() => { this.processing = undefined; });
    this.processing.catch(() => { /* a persistence failure leaves durable state for recovery */ });
  }
  private async drain(): Promise<void> {
    for (;;) {
      if (this.stopping) return;
      const run = this.db.listRecords<RunRecord>("runs", "", 10000).find((row) => row.value.status === "queued");
      if (run) { await this.executeRun(run.id); continue; }
      const application = this.db.listRecords<ApplicationRecord>("applications", "", 10000).find((row) => row.value.status === "queued");
      if (application) { await this.executeApplication(application.id); continue; }
      return;
    }
  }
  async idle(): Promise<void> { await this.processing; }
  async shutdown(): Promise<void> { this.stopping = true; this.active?.controller.abort(); await this.processing; }
}
