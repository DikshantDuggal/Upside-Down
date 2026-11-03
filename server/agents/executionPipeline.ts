/**
 * Integrated Agent Execution Pipeline
 * Role 2 — AI Agent Execution Engine
 */

import { randomUUID } from "node:crypto";
import { ProjectFileWatcher } from "../workers/fileWatcher.ts";
import { TestRunner, type TestRunResult } from "../workers/testRunner.ts";
import { RepairEngine } from "./repairEngine.ts";
import { PatchReviewEngine } from "./reviewEngine.ts";
import type { CoordinatorService } from "../core/coordinator.ts";
import type { AgentRunResult, ReviewVerdict } from "../../contracts/agent.ts";

export interface PipelineConfig {
  workspacePath: string;
  testCommand: string;
  autoWatch?: boolean;
}

export class ExecutionPipeline {
  private config: PipelineConfig;
  private watcher: ProjectFileWatcher;
  private testRunner: TestRunner;
  private repairEngine: RepairEngine;
  private reviewEngine: PatchReviewEngine;
  private coordinator?: CoordinatorService;
  private isProcessing: boolean = false;

  constructor(config: PipelineConfig, coordinator?: CoordinatorService) {
    this.config = config;
    this.coordinator = coordinator;

    this.testRunner = new TestRunner(30000);
    this.repairEngine = new RepairEngine({ maxAttempts: 3, timeoutMs: 15000 });
    this.reviewEngine = new PatchReviewEngine();

    this.watcher = new ProjectFileWatcher({
      watchDir: config.workspacePath,
      debounceMs: 500,
      testCommand: config.testCommand,
    });

    this.setupWatcher();
  }

  private setupWatcher(): void {
    this.watcher.on("triggered", async ({ changedFiles }: { changedFiles: string[] }) => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        await this.handleFileChange(changedFiles);
      } finally {
        this.isProcessing = false;
      }
    });
  }

  public start(): void {
    if (this.config.autoWatch !== false) {
      this.watcher.start();
    }
    this.coordinator?.registerAgent({
      id: "agent-role2-execution-engine",
      name: "Role 2 AI Execution Engine",
      status: "idle",
      runtimeAvailable: true,
      lastSeenAt: new Date().toISOString(),
    });
  }

  public stop(): void {
    this.watcher.stop();
  }

  public async shutdown(): Promise<void> {
    this.stop();
  }

  public async recover(): Promise<void> {}

  public kick(): void {}

  public pause(): void {
    this.watcher.pause();
  }

  public resume(): void {
    this.watcher.resume();
  }

  public async handleFileChange(changedFiles: string[]): Promise<AgentRunResult | null> {
    const runId = randomUUID();
    const primaryFile = changedFiles[0];

    // 1. Run tests to check if change broke anything
    const testResult: TestRunResult = await this.testRunner.run({
      cwd: this.config.workspacePath,
      command: this.config.testCommand,
    });

    if (testResult.passed) {
      this.coordinator?.recordExternalEvent({
        id: randomUUID(),
        source: "agent_engine",
        type: "tests_passed",
        timestamp: new Date().toISOString(),
        payload: { changedFiles, durationMs: testResult.durationMs },
      });
      return null;
    }

    // 2. Tests failed -> Record test_failed event
    const failureSummary = testResult.failureSummary || "Test suite failed";
    let taskId: string = randomUUID();

    if (this.coordinator) {
      const task = this.coordinator.createTask(
        {
          title: `Fix test failure in ${primaryFile}`,
          description: `Auto-generated repair task: ${failureSummary}`,
          ownerId: "agent-role2-execution-engine",
        },
        "agent_engine"
      );
      taskId = task.id;

      this.coordinator.transitionTask(
        taskId,
        { targetStatus: "running", baseRevision: task.revision, reason: "Repair pipeline triggered" },
        "agent_engine"
      );

      this.coordinator.recordExternalEvent({
        id: randomUUID(),
        taskId,
        source: "agent_engine",
        type: "test_failed",
        timestamp: new Date().toISOString(),
        payload: { failureSummary, changedFiles, testOutput: testResult.combinedOutput.slice(0, 1000) },
      });
    }

    // 3. Launch bounded repair engine
    const repairResult: AgentRunResult = await this.repairEngine.executeRepair(
      {
        runId,
        taskId,
        workspacePath: this.config.workspacePath,
        trigger: "test_failed",
        testOutput: testResult.combinedOutput,
      },
      primaryFile,
      this.config.testCommand
    );

    if (repairResult.status !== "completed" || !repairResult.diffContent) {
      if (this.coordinator) {
        const task = this.coordinator.getTask(taskId);
        this.coordinator.transitionTask(
          taskId,
          { targetStatus: "failed", baseRevision: task.revision, reason: repairResult.error || "Repair failed" },
          "agent_engine"
        );
      }
      return repairResult;
    }

    // 4. Review Engine inspects proposed patch
    const verdict: ReviewVerdict = this.reviewEngine.reviewPatch(repairResult.diffContent);

    // 5. Propose patch to Coordinator for human approval
    if (this.coordinator) {
      this.coordinator.proposePatch(
        taskId,
        runId,
        repairResult.diffContent,
        repairResult.verificationOutput
      );

      this.coordinator.recordExternalEvent({
        id: randomUUID(),
        taskId,
        source: "agent_engine",
        type: "patch_reviewed",
        timestamp: new Date().toISOString(),
        payload: {
          safe: verdict.safe,
          score: verdict.score,
          reasons: verdict.reasons,
          touchedFiles: verdict.touchedFiles,
        },
      });
    }

    return repairResult;
  }
}
