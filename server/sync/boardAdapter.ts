/**
 * GitHub Message Board Sync Adapter
 * Integrates local system with shared GitHub issue board
 * Protocol: UPSIDE-DOWN/HANDOFF-TEST v2.0 / v3.0
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

export interface BoardComment {
  id: string;
  user: string;
  createdAt: string;
  body: string;
  isMention?: boolean;
}

export interface BoardAdapterConfig {
  repoRoot?: string;
  repo?: string;
  issue?: string;
  mockMode?: boolean;
}

export class BoardAdapter {
  private repoRoot: string;
  private repo: string;
  private issue: string;
  private mockMode: boolean;
  private simulatedOffline: boolean = false;
  private mockComments: BoardComment[] = [];

  constructor(config: BoardAdapterConfig = {}) {
    this.repoRoot = config.repoRoot || process.cwd();
    this.repo = config.repo || "DikshantDuggal/Upside-Down";
    this.issue = config.issue || "1";
    this.mockMode = config.mockMode || false;
  }

  public setSimulatedOffline(offline: boolean): void {
    this.simulatedOffline = offline;
  }

  public addMockComment(comment: BoardComment): void {
    this.mockComments.push(comment);
  }

  public async getWhoami(): Promise<string> {
    if (this.simulatedOffline) {
      throw new Error("Network unreachable: simulated offline mode");
    }
    if (this.mockMode) {
      return "DikshantDuggal";
    }

    try {
      const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"]);
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get GitHub user: ${msg}`);
    }
  }

  public async postComment(messageText: string): Promise<string> {
    if (this.simulatedOffline) {
      throw new Error("Network unreachable: simulated offline mode");
    }

    if (this.mockMode) {
      const mockId = String(Date.now());
      const mockUrl = `https://github.com/${this.repo}/issues/${this.issue}#issuecomment-${mockId}`;
      this.mockComments.push({
        id: mockId,
        user: "DikshantDuggal",
        createdAt: new Date().toISOString(),
        body: messageText,
      });
      return mockUrl;
    }

    // Use launcher board.sh via bash or board.ps1
    const boardSh = path.join(this.repoRoot, ".board", "board.sh");
    const bashCandidates = [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "bash",
    ];

    let bashExe = "bash";
    for (const cand of bashCandidates) {
      if (fs.existsSync(cand)) {
        bashExe = cand;
        break;
      }
    }

    try {
      const { stdout } = await execFileAsync(bashExe, [boardSh, "post", messageText], {
        cwd: this.repoRoot,
      });
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to post comment to board: ${msg}`);
    }
  }

  public async readRecentComments(count: number = 10, currentUsername: string = "DikshantDuggal"): Promise<BoardComment[]> {
    if (this.simulatedOffline) {
      throw new Error("Network unreachable: simulated offline mode");
    }

    if (this.mockMode) {
      return this.mockComments.slice(-count).map((c) => ({
        ...c,
        isMention: c.body.toLowerCase().includes(`@${currentUsername.toLowerCase()}`) || c.body.includes("@all"),
      }));
    }

    try {
      const { stdout } = await execFileAsync("gh", [
        "api",
        `repos/${this.repo}/issues/${this.issue}/comments?per_page=100`,
        "--jq",
        ".[] | {id: .id, user: .user.login, createdAt: .created_at, body: .body}",
      ]);

      const comments: BoardComment[] = [];
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const c = JSON.parse(line);
          const body = String(c.body || "");
          const isMention = body.toLowerCase().includes(`@${currentUsername.toLowerCase()}`) || body.includes("@all");
          comments.push({
            id: String(c.id),
            user: String(c.user),
            createdAt: String(c.createdAt),
            body,
            isMention,
          });
        } catch {
          // ignore parse errors
        }
      }

      return comments.slice(-count);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read comments from board: ${msg}`);
    }
  }

  public parseHandoffAck(body: string, expectedTestId: string): { isValid: boolean; status?: string } {
    if (!body.includes("HANDOFF-ACK")) {
      return { isValid: false };
    }
    if (!body.includes(expectedTestId)) {
      return { isValid: false };
    }
    const statusMatch = body.match(/Status:\s*([A-Za-z0-9_-]+)/i);
    return {
      isValid: true,
      status: statusMatch ? statusMatch[1].toUpperCase() : undefined,
    };
  }
}
