import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ProtocolError } from "../core/protocolError.ts";
import { validateSourcePath, resolveSourceFile } from "./pathPolicy.ts";

export interface TrustedWorkspace {
  id: string; repositoryPath: string; baseRef?: string; repairTargetFile?: string;
  allowedPaths: string[]; testProfileIds: string[]; integrationBranch?: string;
}
export interface TrustedTestProfile { id: string; executable: string; args: string[]; timeoutMs: number }
export interface ExecutionConfiguration { runtimeDirectory: string; workspaces: TrustedWorkspace[]; testProfiles: TrustedTestProfile[] }
const safeId = /^[A-Za-z0-9_.-]{1,100}$/;
export const diffHash = (diff: string) => createHash("sha256").update(diff, "utf8").digest("hex");

export class GitWorkspaceManager {
  private configuration: ExecutionConfiguration;
  constructor(configuration: ExecutionConfiguration) {
    if (!path.isAbsolute(configuration.runtimeDirectory)) throw new Error("Execution runtimeDirectory must be absolute");
    const ids = new Set<string>();
    for (const workspace of configuration.workspaces) {
      if (!safeId.test(workspace.id) || ids.has(workspace.id) || !path.isAbsolute(workspace.repositoryPath)
          || !workspace.allowedPaths.length || !workspace.testProfileIds.length) throw new Error("Invalid workspace registration");
      ids.add(workspace.id);
      for (const source of workspace.allowedPaths) validateSourcePath(source.endsWith("/") ? source + "placeholder.ts" : source);
      if (workspace.repairTargetFile) validateSourcePath(workspace.repairTargetFile);
    }
    ids.clear();
    for (const profile of configuration.testProfiles) {
      if (!safeId.test(profile.id) || ids.has(profile.id) || !path.isAbsolute(profile.executable)
          || !Array.isArray(profile.args) || profile.args.some((arg) => typeof arg !== "string")
          || !Number.isSafeInteger(profile.timeoutMs) || profile.timeoutMs < 1 || profile.timeoutMs > 120000) throw new Error("Invalid test profile registration");
      ids.add(profile.id);
    }
    this.configuration = structuredClone(configuration);
    fs.mkdirSync(configuration.runtimeDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(configuration.runtimeDirectory, "empty-hooks"), { recursive: true });
  }
  workspace(id: string): TrustedWorkspace {
    const workspace = this.configuration.workspaces.find((entry) => entry.id === id);
    if (!workspace) throw new ProtocolError(422, "UNKNOWN_WORKSPACE", "Workspace ID is not registered");
    return structuredClone(workspace);
  }
  profile(workspace: TrustedWorkspace, id: string): TrustedTestProfile {
    const profile = this.configuration.testProfiles.find((entry) => entry.id === id);
    if (!profile || !workspace.testProfileIds.includes(id)) throw new ProtocolError(422, "UNKNOWN_TEST_PROFILE", "Test profile is not registered for this workspace");
    return structuredClone(profile);
  }
  git(root: string, args: string[], input?: string): string {
    const output = execFileSync("git", ["-c", `core.hooksPath=${path.join(this.configuration.runtimeDirectory, "empty-hooks")}`,
      "-c", "commit.gpgsign=false", "-C", root, ...args], {
      input, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    });
    return args[0] === "diff" ? output : output.trim();
  }
  head(workspace: TrustedWorkspace): string {
    return this.git(workspace.repositoryPath, ["rev-parse", "--verify", "--end-of-options", `${workspace.baseRef ?? "HEAD"}^{commit}`]);
  }
  clean(root: string): void {
    if (this.git(root, ["status", "--porcelain"])) throw new ProtocolError(409, "DIRTY_WORKSPACE", "Registered workspace contains local changes");
  }
  create(workspace: TrustedWorkspace, id: string, base: string, application = false): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid owned worktree ID");
    const root = path.join(this.configuration.runtimeDirectory, `${application ? "application" : "run"}-${id}`);
    if (fs.existsSync(root)) throw new ProtocolError(409, "WORKTREE_EXISTS", "Owned worktree needs recovery before reuse");
    this.git(workspace.repositoryPath, ["worktree", "add", ...(application ? ["-b", `ud-application/${id}`] : ["--detach"]), root, base]);
    return root;
  }
  dispose(workspace: TrustedWorkspace, root: string): void {
    const parent = fs.realpathSync(this.configuration.runtimeDirectory);
    if (path.dirname(fs.realpathSync(root)) !== parent || !/^(run|application)-[0-9a-f-]{36}$/.test(path.basename(root))) {
      throw new Error("Cleanup target is not an owned disposable worktree");
    }
    this.git(workspace.repositoryPath, ["worktree", "remove", "--force", root]);
  }
  checkPaths(root: string, workspace: TrustedWorkspace, files: string[]): void {
    for (const file of files) {
      validateSourcePath(file);
      try { if (fs.lstatSync(path.join(root, file)).isSymbolicLink()) throw new ProtocolError(403, "UNSAFE_PATH", "Patch path is a link or junction"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!workspace.allowedPaths.some((allowed) => file === allowed || (allowed.endsWith("/") && file.startsWith(allowed)))) {
        throw new ProtocolError(403, "OWNERSHIP_VIOLATION", "Patch touches a path outside the registered ownership scope");
      }
      // For new/deleted files, validate every existing parent without following links.
      let candidate = file;
      if (fs.existsSync(path.join(root, candidate))) { resolveSourceFile(root, candidate); continue; }
      let parent = path.dirname(candidate);
      while (parent !== ".") {
        const directory = path.join(root, parent);
        if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new ProtocolError(403, "UNSAFE_PATH", "Patch parent contains a link or junction");
        parent = path.dirname(parent);
      }
    }
  }
  apply(root: string, diff: string): void {
    this.git(root, ["apply", "--check", "--whitespace=nowarn", "-"], diff);
    this.git(root, ["apply", "--whitespace=nowarn", "-"], diff);
  }
  tree(root: string, files: string[] = []): string {
    if (files.length) this.git(root, ["add", "--", ...files]);
    return this.git(root, ["write-tree"]);
  }
  commit(root: string, id: string, hash: string): string {
    this.git(root, ["-c", "user.name=Upside-Down Application Worker", "-c", "user.email=upside-down@localhost",
      "commit", "-m", `Verified application ${id}\n\nUD-Application: ${id}\nUD-Diff-Hash: ${hash}`]);
    return this.git(root, ["rev-parse", "HEAD"]);
  }
  integrationTarget(workspace: TrustedWorkspace, expected: string, commit?: string): void {
    if (!workspace.integrationBranch || !fs.statSync(path.join(workspace.repositoryPath, ".git")).isFile()) {
      throw new ProtocolError(422, "INTEGRATION_TARGET_REQUIRED", "Application requires a registered dedicated integration worktree");
    }
    this.clean(workspace.repositoryPath);
    const branch = this.git(workspace.repositoryPath, ["branch", "--show-current"]);
    if (branch !== workspace.integrationBranch) throw new ProtocolError(409, "INTEGRATION_BRANCH_CHANGED", "Integration branch does not match its registration");
    const current = this.git(workspace.repositoryPath, ["rev-parse", "HEAD"]);
    if (current !== expected && current !== commit) throw new ProtocolError(409, "BASE_COMMIT_CHANGED", "Integration target no longer matches the expected base");
  }
}
