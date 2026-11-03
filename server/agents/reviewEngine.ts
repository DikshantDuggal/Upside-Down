/**
 * Patch Review & Safety Engine
 * Role 2 — AI Agent Execution Engine
 */

import type { ReviewVerdict } from "../../contracts/agent.ts";
import { validateSourcePath, isTestPath } from "../workers/pathPolicy.ts";

export class PatchReviewEngine {
  private static readonly DANGEROUS_PATTERNS = [
    { pattern: /rm\s+-rf/i, reason: "Dangerous command: recursive deletion" },
    { pattern: /process\.exit\(/i, reason: "Process termination attempt" },
    { pattern: /eval\(/i, reason: "Insecure dynamic evaluation (eval)" },
    { pattern: /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{30,}/i, reason: "Exposed GitHub token in patch" },
    { pattern: /(?:BEGIN (?:RSA )?PRIVATE KEY)/i, reason: "Private key leaked in patch" },
  ];

  public reviewPatch(diffContent: string): ReviewVerdict {
    const reasons: string[] = [];
    const touchedFiles: string[] = [];
    let score = 100;

    // 1. Extract touched files
    const fileMatches = diffContent.matchAll(/^(?:---|\+\+\+) (.+)$/gm);
    for (const match of fileMatches) {
      const header = match[1].replace(/\r$/, "").split("\t")[0];
      if (header === "/dev/null") continue;
      if (!/^[ab]\//.test(header)) {
        reasons.push("Unsupported or unsafe diff path header"); score -= 50; continue;
      }
      const file = header.slice(2);
      if (!touchedFiles.includes(file)) touchedFiles.push(file);

      // Check if patch touches forbidden sensitive files
      if (isTestPath(file)) {
        reasons.push(`Suspicious modification of test file: ${file}`);
        score -= 30;
      } else {
        try { validateSourcePath(file); }
        catch { reasons.push("Forbidden file modified or unsafe path in patch"); score -= 50; }
      }
    }
    if (!touchedFiles.length) { reasons.push("Patch has no supported source paths"); score -= 50; }
    if (/^(?:(?:new|old|deleted) file mode|(?:old|new) mode|index [0-9a-f]+\.\.[0-9a-f]+) (?:120000|160000)\s*$/m.test(diffContent)) {
      reasons.push("Symbolic links and submodules are not permitted"); score -= 50;
    }
    const aliases = new Map<string, string>();
    for (const file of touchedFiles) {
      const previous = aliases.get(file.toLowerCase());
      if (previous && previous !== file) { reasons.push("Case-insensitive source path collision"); score -= 50; }
      aliases.set(file.toLowerCase(), file);
    }

    // 2. Scan added lines for dangerous patterns
    const addedLines = diffContent
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.substring(1));

    for (const line of addedLines) {
      for (const check of PatchReviewEngine.DANGEROUS_PATTERNS) {
        if (check.pattern.test(line)) {
          // A detected secret must never be echoed into logs, events or responses.
          reasons.push(check.reason);
          score -= 40;
        }
      }
    }

    score = Math.max(0, score);
    const safe = score >= 70 && reasons.length === 0;

    return {
      safe,
      score,
      reasons,
      touchedFiles,
    };
  }
}
