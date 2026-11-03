/**
 * Safe Subprocess Test Runner
 * Role 2 — AI Agent Execution Engine
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface TestRunResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  durationMs: number;
  timedOut: boolean;
  failureSummary?: string;
  truncated?: boolean;
  cancelled?: boolean;
}

export interface RunTestOptions {
  cwd: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  inheritEnvironment?: boolean;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  /** Server-configured legacy batch profiles only; never set from peer input. */
  allowWindowsShell?: boolean;
}

export class TestRunner {
  private defaultTimeoutMs: number;

  constructor(defaultTimeoutMs: number = 30000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  public async run(options: RunTestOptions): Promise<TestRunResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxOutput = options.maxOutputBytes ?? 65536;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 65536) {
      throw new RangeError("Invalid test timeout or output bound");
    }

    return new Promise<TestRunResult>((resolve) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let timedOut = false;
      let cancelled = false;
      let truncated = false;
      let settled = false;
      let termination: Promise<void> | undefined;

      const isWindows = process.platform === "win32";

      let cmd = options.command.trim();
      let args = options.args ? [...options.args] : [];

      if (/\s/.test(cmd) && !fs.existsSync(cmd) && args.length === 0) {
        const matches = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
        if (matches && matches.length > 0) {
          const first = matches[0];
          cmd = first.replace(/^["']|["']$/g, "");
          args = matches.slice(1).map((m) => m.replace(/^["']|["']$/g, ""));
        }
      }

      // npm's JS entry point avoids cmd.exe and its argument interpolation.
      if (isWindows && /^(npm|npm\.cmd)$/i.test(cmd)) {
        const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
        if (fs.existsSync(cli)) { cmd = process.execPath; args.unshift(cli); }
      }
      const shell = isWindows && /\.(cmd|bat)$/i.test(cmd);
      if (shell && (!options.allowWindowsShell || /[&|<>^%!"\r\n]/.test([cmd, ...args].join(" ")))) {
        resolve({ passed: false, exitCode: null, stdout: "", stderr: "Batch profile is not explicitly trusted or has unsafe arguments",
          combinedOutput: "", durationMs: Date.now() - startTime, timedOut: false, failureSummary: "Untrusted Windows shell profile" });
        return;
      }
      if (options.signal?.aborted) {
        resolve({ passed: false, exitCode: null, stdout: "", stderr: "", combinedOutput: "", durationMs: 0, timedOut: false, cancelled: true, failureSummary: "Test execution cancelled" });
        return;
      }

      const child = spawn(cmd, args, {
        cwd: options.cwd,
        shell,
        windowsHide: true,
        detached: !isWindows,
        env: { ...(options.inheritEnvironment === false ? {} : process.env), ...options.env },
      });

      const terminate = () => {
        if (termination) return;
        termination = new Promise<void>((done) => {
          if (!child.pid) { done(); return; }
          if (isWindows) {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true, stdio: "ignore" });
            killer.once("error", () => { child.kill(); done(); });
            killer.once("close", () => done());
          } else {
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
            done();
          }
        });
      };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
      const abort = () => { cancelled = true; terminate(); };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length + chunk.length > maxOutput) truncated = true;
        stdout = Buffer.concat([stdout, chunk.subarray(0, Math.max(0, maxOutput - stdout.length))]);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length + chunk.length > maxOutput) truncated = true;
        stderr = Buffer.concat([stderr, chunk.subarray(0, Math.max(0, maxOutput - stderr.length))]);
      });

      child.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        const durationMs = Date.now() - startTime;
        resolve({
          passed: false,
          exitCode: 1,
          stdout: stdout.toString(),
          stderr: stderr.toString() + "\n" + err.message,
          combinedOutput: stdout.toString() + "\n" + stderr.toString() + "\n" + err.message,
          durationMs,
          timedOut,
          failureSummary: `Process spawn error: ${err.message}`,
        });
      });

      child.on("close", async (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        await termination;
        const durationMs = Date.now() - startTime;
        const passed = code === 0 && !timedOut && !cancelled;
        const decode = (buffer: Buffer) => {
          let value = buffer.toString("utf8");
          if (Buffer.byteLength(value) > maxOutput) value = value.slice(0, -1);
          return value;
        };
        const stdoutText = decode(stdout), stderrText = decode(stderr);
        const combinedOutput = `${stdoutText}\n${stderrText}`.trim();

        let failureSummary: string | undefined;
        if (!passed) {
          if (cancelled) {
            failureSummary = "Test execution cancelled";
          } else if (timedOut) {
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
          stdout: stdoutText,
          stderr: stderrText,
          combinedOutput,
          durationMs,
          timedOut,
          cancelled,
          truncated,
          failureSummary,
        });
      });
    });
  }
}
