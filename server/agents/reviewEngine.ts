/**
 * Patch Review & Safety Engine
 * Role 2 — AI Agent Execution Engine
 */

import type { ReviewVerdict } from "../../contracts/agent.ts";

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
    const fileMatches = diffContent.matchAll(/^\+\+\+ b\/(.+)$/gm);
    for (const match of fileMatches) {
      const file = match[1].trim();
      touchedFiles.push(file);

      // Check if patch touches forbidden sensitive files
      if (file.endsWith(".env") || file.includes("credentials") || file.includes(".git/")) {
        reasons.push(`Forbidden file modified: ${file}`);
        score -= 50;
      }

      // Check if patch touches test files directly
      if (file.includes(".test.") || file.includes(".spec.")) {
        reasons.push(`Suspicious modification of test file: ${file}`);
        score -= 30;
      }
    }

    // 2. Scan added lines for dangerous patterns
    const addedLines = diffContent
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.substring(1));

    for (const line of addedLines) {
      for (const check of PatchReviewEngine.DANGEROUS_PATTERNS) {
        if (check.pattern.test(line)) {
          reasons.push(`${check.reason} in line: '${line.trim().slice(0, 60)}'`);
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
