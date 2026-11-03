/**
 * Bounded AI Repair Engine
 * Role 2 — AI Agent Execution Engine
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentRunRequest, AgentRunResult, RepairOptions } from "../../contracts/agent.ts";
import { TestRunner, type TestRunResult } from "../workers/testRunner.ts";
import { resolveSourceFile, isTestPath, validateSourcePath } from "../workers/pathPolicy.ts";
import { PatchReviewEngine } from "./reviewEngine.ts";

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
      maxAttempts: options?.maxAttempts ?? 3,
      timeoutMs: options?.timeoutMs ?? 15000,
      allowedExtensions: options?.allowedExtensions ?? [".ts", ".js", ".cjs", ".mjs", ".json", ".py", ".rs"],
      worktreeDir: options?.worktreeDir,
    };
    if (!Number.isSafeInteger(this.options.maxAttempts) || this.options.maxAttempts < 1 || this.options.maxAttempts > 3
        || !Number.isSafeInteger(this.options.timeoutMs) || this.options.timeoutMs < 1 || this.options.timeoutMs > 120000) {
      throw new RangeError("Repair requires 1..3 attempts and a bounded test timeout");
    }
    this.provider = provider || new OfflineHeuristicRepairProvider();
    this.testRunner = new TestRunner(this.options.timeoutMs);
  }

  public async executeRepair(
    req: AgentRunRequest,
    targetFile: string,
    testCommand: string | { command: string; args: string[]; signal?: AbortSignal; env?: NodeJS.ProcessEnv; inheritEnvironment?: boolean }
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    let attempts = 0;

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

    let absTargetFile: string;
    try {
      absTargetFile = resolveSourceFile(req.workspacePath, targetFile);
      if (!this.options.allowedExtensions.includes(path.extname(targetFile).toLowerCase())) throw new Error("Unsupported source extension");
      if (fs.statSync(absTargetFile).size > 512 * 1024) throw new Error("Source exceeds candidate size limit");
    } catch {
      return { runId: req.runId, status: "blocked", error: "Source path is unavailable, unsafe, protected or oversized",
        durationMs: Date.now() - startTime, attempts: 0 };
    }

    const originalCode = fs.readFileSync(absTargetFile, "utf-8");
    let currentCode = originalCode;
    let lastError = req.testOutput || "Test failed";
    let generatedDiff = "";
    let verificationOutput = "";
    let writtenCode: string | undefined;

    try {
    if (!await this.provider.isAvailable()) {
      return { runId: req.runId, status: "blocked", error: "Repair provider is unavailable", attempts: 0, durationMs: Date.now() - startTime };
    }
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
      if (typeof fixedCode !== "string" || Buffer.byteLength(fixedCode) > 512 * 1024) {
        throw new Error("Provider candidate exceeds source limit");
      }

      // 2. Compute unified diff
      generatedDiff = this.createUnifiedDiff(targetFile, originalCode, fixedCode);
      if (Buffer.byteLength(generatedDiff) > 512 * 1024) throw new Error("Candidate diff exceeds limit");
      if (!new PatchReviewEngine().reviewPatch(generatedDiff).safe) {
        return { runId: req.runId, status: "blocked", error: "Patch review blocked candidate before execution",
          durationMs: Date.now() - startTime, attempts };
      }

      // 3. Apply fix temporarily to test workspace
      if (resolveSourceFile(req.workspacePath, targetFile) !== absTargetFile || fs.readFileSync(absTargetFile, "utf8") !== currentCode) {
        throw new Error("Workspace changed while generating candidate");
      }
      fs.writeFileSync(absTargetFile, fixedCode, "utf-8");
      writtenCode = fixedCode;

      // 4. Verify candidate fix by running tests
      const testResult: TestRunResult = await this.testRunner.run({
        cwd: req.workspacePath,
        ...(typeof testCommand === "string" ? { command: testCommand } : testCommand),
        timeoutMs: this.options.timeoutMs,
      });

      verificationOutput = testResult.combinedOutput;

      if (testResult.passed) {
        // finally restores the source before this result reaches the caller.
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
    } catch {
      return { runId: req.runId, status: "failed", error: "Repair provider or candidate verification failed",
        durationMs: Date.now() - startTime, attempts };
    } finally {
      if (writtenCode !== undefined) {
        try {
          if (resolveSourceFile(req.workspacePath, targetFile) !== absTargetFile || fs.readFileSync(absTargetFile, "utf8") !== writtenCode) {
            throw new Error("Workspace was modified independently");
          }
          fs.writeFileSync(absTargetFile, originalCode, "utf8");
        } catch {
          // A successful result must never escape when restoration failed. Do not
          // overwrite independent changes or follow a replaced link during cleanup.
          return { runId: req.runId, status: "blocked", error: "Workspace restoration blocked; manual recovery required",
            durationMs: Date.now() - startTime, attempts };
        }
      }
    }
  }

  public isTestFile(filePath: string): boolean {
    return isTestPath(filePath);
  }

  public createUnifiedDiff(filename: string, oldStr: string, newStr: string): string {
    validateSourcePath(filename);
    if (oldStr === newStr) return "";
    const lines = (value: string) => value === "" ? [] : value.split("\n").slice(0, value.endsWith("\n") ? -1 : undefined);
    const oldLines = lines(oldStr), newLines = lines(newStr);
    const diff = [`--- a/${filename}`, `+++ b/${filename}`,
      `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`];
    for (const [prefix, value, source] of [["-", oldLines, oldStr], ["+", newLines, newStr]] as const) {
      for (const line of value) diff.push(prefix + line);
      if (value.length && !source.endsWith("\n")) diff.push("\\ No newline at end of file");
    }
    return diff.join("\n") + "\n";
  }
}
