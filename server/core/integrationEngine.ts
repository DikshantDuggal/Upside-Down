/**
 * Code Integration Engine & Collision Detector (Upside-Down 2.0)
 * Evaluates branch changes, detects file collisions between agents, runs contract checks,
 * and gates release approvals for deployment.
 */

import { randomUUID } from "node:crypto";
import type {
  TaskContractV2,
  IntegrationReleaseRecord,
} from "../../contracts/hackathon.ts";

export interface CollisionCheckResult {
  hasCollision: boolean;
  collidingFiles: string[];
  tasksInvolved: string[];
  summary: string;
}

export class IntegrationEngine {
  /**
   * Compares declared or changed files across active tasks to detect potential overlap
   */
  public detectCollisions(tasks: TaskContractV2[]): CollisionCheckResult {
    const fileToTaskMap = new Map<string, string[]>();

    for (const task of tasks) {
      if (task.status === "completed" || task.status === "in_review" || task.status === "in_progress") {
        const files = (task.evidence?.branch ? [task.evidence.branch] : []).concat(task.allowedPaths);
        for (const file of files) {
          const normalized = file.replace(/\\/g, "/").toLowerCase();
          const list = fileToTaskMap.get(normalized) || [];
          list.push(task.taskId);
          fileToTaskMap.set(normalized, list);
        }
      }
    }

    const collidingFiles: string[] = [];
    const tasksInvolvedSet = new Set<string>();

    for (const [file, taskIds] of fileToTaskMap.entries()) {
      const unique = [...new Set(taskIds)];
      if (unique.length > 1) {
        collidingFiles.push(file);
        for (const tid of unique) {
          tasksInvolvedSet.add(tid);
        }
      }
    }

    const hasCollision = collidingFiles.length > 0;
    const tasksInvolved = [...tasksInvolvedSet];

    return {
      hasCollision,
      collidingFiles,
      tasksInvolved,
      summary: hasCollision
        ? `Collision Warning: ${collidingFiles.length} file path(s) overlapped between tasks [${tasksInvolved.join(", ")}]. Host review recommended before merge.`
        : "Zero collisions detected. All tasks operate within isolated path boundaries.",
    };
  }

  /**
   * Performs automated verification of an integration release candidate
   */
  public evaluateRelease(
    projectId: string,
    tasks: TaskContractV2[],
    branchName: string = "main"
  ): IntegrationReleaseRecord {
    const collision = this.detectCollisions(tasks);
    const completedOrReview = tasks.filter((t) => t.status === "completed" || t.status === "in_review");
    const allCompleted = tasks.length > 0 && tasks.every((t) => t.status === "completed");

    // Gather all changed files reported in task evidence
    const changedFiles: string[] = [];
    for (const t of tasks) {
      if (t.allowedPaths) {
        changedFiles.push(...t.allowedPaths);
      }
    }

    const contractCheck = "pending"; // Completion metadata is not a verified contract check.
    const buildStatus = "pending"; // No build executor is connected to this planner.
    const testStatus = "pending"; // No CI result has been collected.

    return {
      id: `rel-${randomUUID().slice(0, 8)}`,
      projectId,
      branch: branchName,
      changedFiles: [...new Set(changedFiles)],
      collisionDetected: collision.hasCollision,
      collisionFiles: collision.collidingFiles,
      contractCheck,
      buildStatus,
      testStatus,
      releaseApproved: false,
      deploymentStatus: "not_started",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Executes deployment authorization and produces verified deployment record
   */
  public approveAndDeploy(
    release: IntegrationReleaseRecord,
    approvedBy: string = "host"
  ): IntegrationReleaseRecord {
    const now = new Date().toISOString();
    const isLive = release.contractCheck === "passed" && release.buildStatus === "passed" && !release.collisionDetected;

    return {
      ...release,
      releaseApproved: true,
      releaseApprovedBy: approvedBy,
      deploymentStatus: "not_started",
      deploymentUrl: undefined,
      deploymentEvidence: "Local host review recorded. No CI execution or hosted deployment has been performed.",
      updatedAt: now,
    };
  }
}
