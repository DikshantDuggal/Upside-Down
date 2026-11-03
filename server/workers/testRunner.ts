/**
 * Safe Subprocess Test Runner
 * Role 2 — AI Agent Execution Engine
 */

import { spawn } from "node:child_process";

export interface TestRunResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
  timedOut: boolean;
  failureSummary?: string;
}

export interface RunTestOptions {
  cwd: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class TestRunner {
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 30000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  public async run(options: RunTestOptions): Promise<TestRunResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    return new Promise<TestRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const isWindows = process.platform === "win32";
      const isCmdOrNpm = isWindows && (/\.(cmd|bat)$/i.test(options.command) || options.command.startsWith("npm"));

      let cmd = options.command.trim();
      let args = options.args ? [...options.args] : [];

      if (cmd.includes(" ") && !isCmdOrNpm && args.length === 0) {
        const matches = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
        if (matches && matches.length > 0) {
          const first = matches[0];
          cmd = first.replace(/^["']|["']$/g, "");
          args = matches.slice(1).map((m) => m.replace(/^["']|["']$/g, ""));
        }
      }

      const child = spawn(cmd, args, {
        cwd: options.cwd,
        shell: isCmdOrNpm,
        env: { ...process.env, ...options.env },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) {
            if (isWindows) {
              spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
            } else {
              child.kill("SIGKILL");
            }
          }
        } catch {
          child.kill();
        }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          passed: false,
          exitCode: 1,
          stdout,
          stderr: stderr + "\n" + err.message,
          combinedOutput: stdout + "\n" + stderr + "\n" + err.message,
          durationMs,
          timedOut,
          failureSummary: `Process spawn error: ${err.message}`,
        });
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const passed = code === 0 && !timedOut;
        const combinedOutput = `${stdout}\n${stderr}`.trim();

        let failureSummary: string | undefined;
        if (!passed) {
          if (timedOut) {
            failureSummary = `Test execution timed out after ${timeoutMs}ms`;
          } else {
            const failLines = combinedOutput
              .split("\n")
              .filter((l) => /fail|error|assert|exception/i.test(l))
              .slice(0, 3);
            failureSummary = failLines.length > 0 ? failLines.join("; ") : `Tests exited with code ${code}`;
          }
        }

        resolve({
          passed,
          exitCode: code,
          stdout,
          stderr,
          combinedOutput,
          durationMs,
          timedOut,
          failureSummary,
        });
      });
    });
  }
}
