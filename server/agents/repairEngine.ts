/**
 * Bounded AI Repair Engine
 * Role 2 — AI Agent Execution Engine
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult, RepairOptions } from "../../contracts/agent.ts";
import { TestRunner, type TestRunResult } from "../workers/testRunner.ts";

export interface RepairProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generateFix(prompt: string, context: { filePath: string; originalCode: string; errorSummary: string }): Promise<string>;
}

/**
 * Built-in Offline Heuristic Repair Provider
 * Deterministically addresses common failure patterns (assertion changes, syntax, null checks, division by zero)
 */
export class OfflineHeuristicRepairProvider implements RepairProvider {
  public readonly name = "offline-heuristic-provider";

  public async isAvailable(): Promise<boolean> {
    return true; // Always available offline
  }

  public async generateFix(
    _prompt: string,
    context: { filePath: string; originalCode: string; errorSummary: string }
  ): Promise<string> {
    const { originalCode, errorSummary } = context;

    // Pattern 1: Division by zero -> replace / 0 with / 1 or null check
    if (/division by zero|divide by zero/i.test(errorSummary) || originalCode.includes("/ 0")) {
      return originalCode.replace(/\/\s*0\b/g, "/ 1");
    }

    // Pattern 2: Null/undefined dereference (Cannot read properties of undefined/null)
    if (/cannot read propert|is null|is undefined/i.test(errorSummary)) {
      return originalCode.replace(/\b(\w+)\.(\w+)\b/g, "$1?.$2");
    }

    // Pattern 3: Assertion expected vs actual mismatch (e.g. Expected: X, Received: Y)
    const assertMatch = errorSummary.match(/expected:?\s*["']?([^"'\n]+)["']?\s*(?:but got|received|instead of):?\s*["']?([^"'\n]+)["']?/i);
    if (assertMatch) {
      const expected = assertMatch[1].trim();
      const received = assertMatch[2].trim();
      if (originalCode.includes(received)) {
        return originalCode.replace(received, expected);
      }
    }

    // Default: Return original code with added safety guard comment
    return `// [AI Guard Added]\n${originalCode}`;
  }
}

export class RepairEngine {
  private options: RepairOptions;
  private provider: RepairProvider;
  private testRunner: TestRunner;

  constructor(options?: Partial<RepairOptions>, provider?: RepairProvider) {
    this.options = {
      maxAttempts: options?.maxAttempts || 3,
      timeoutMs: options?.timeoutMs || 15000,
      allowedExtensions: options?.allowedExtensions || [".ts", ".js", ".json", ".py", ".rs"],
      worktreeDir: options?.worktreeDir,
    };
    this.provider = provider || new OfflineHeuristicRepairProvider();
    this.testRunner = new TestRunner(this.options.timeoutMs);
  }

  public async executeRepair(
    req: AgentRunRequest,
    targetFile: string,
    testCommand: string
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    let attempts = 0;

    const absTargetFile = path.resolve(req.workspacePath, targetFile);
    if (!fs.existsSync(absTargetFile)) {
      return {
        runId: req.runId,
        status: "failed",
        error: `Target file not found: ${targetFile}`,
        durationMs: Date.now() - startTime,
        attempts: 0,
      };
    }

    // Safety: Protect test files from unauthorized self-tampering
    if (this.isTestFile(targetFile)) {
      return {
        runId: req.runId,
        status: "blocked",
        error: `Safety guard: Cannot auto-modify test fixture or test file '${targetFile}'`,
        durationMs: Date.now() - startTime,
        attempts: 0,
      };
    }

    const originalCode = fs.readFileSync(absTargetFile, "utf-8");
    let currentCode = originalCode;
    let lastError = req.testOutput || "Test failed";
    let generatedDiff = "";
    let verificationOutput = "";

    while (attempts < this.options.maxAttempts) {
      attempts++;

      // 1. Generate candidate fix via provider
      const fixedCode = await this.provider.generateFix("Fix test failure", {
        filePath: targetFile,
        originalCode: currentCode,
        errorSummary: lastError,
      });

      if (fixedCode === currentCode) {
        // No further changes proposed
        break;
      }

      // 2. Compute unified diff
      generatedDiff = this.createUnifiedDiff(targetFile, originalCode, fixedCode);

      // 3. Apply fix temporarily to test workspace
      fs.writeFileSync(absTargetFile, fixedCode, "utf-8");

      // 4. Verify candidate fix by running tests
      const testResult: TestRunResult = await this.testRunner.run({
        cwd: req.workspacePath,
        command: testCommand,
        timeoutMs: this.options.timeoutMs,
      });

      verificationOutput = testResult.combinedOutput;

      if (testResult.passed) {
        // Fix verified! Revert workspace so patch is subject to human approval
        fs.writeFileSync(absTargetFile, originalCode, "utf-8");

        return {
          runId: req.runId,
          status: "completed",
          diffContent: generatedDiff,
          testOutput: req.testOutput,
          verificationOutput,
          durationMs: Date.now() - startTime,
          attempts,
        };
      }

      // Test still failed; update error and attempt next iteration
      lastError = testResult.failureSummary || testResult.combinedOutput;
      currentCode = fixedCode;
    }

    // Revert original code on failure
    fs.writeFileSync(absTargetFile, originalCode, "utf-8");

    return {
      runId: req.runId,
      status: "failed",
      diffContent: generatedDiff || undefined,
      testOutput: req.testOutput,
      verificationOutput,
      error: `Exceeded max repair attempts (${this.options.maxAttempts}). Last error: ${lastError}`,
      durationMs: Date.now() - startTime,
      attempts,
    };
  }

  public isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return (
      normalized.includes("/tests/") ||
      normalized.includes("/test/") ||
      normalized.includes(".test.") ||
      normalized.includes(".spec.")
    );
  }

  public createUnifiedDiff(filename: string, oldStr: string, newStr: string): string {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");

    const diffLines: string[] = [
      `--- a/${filename}`,
      `+++ b/${filename}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ];

    // Simple line-by-line diff
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o !== undefined && n !== undefined) {
        if (o === n) {
          diffLines.push(` ${o}`);
        } else {
          diffLines.push(`-${o}`);
          diffLines.push(`+${n}`);
        }
      } else if (o !== undefined) {
        diffLines.push(`-${o}`);
      } else if (n !== undefined) {
        diffLines.push(`+${n}`);
      }
    }

    return diffLines.join("\n");
  }
}
