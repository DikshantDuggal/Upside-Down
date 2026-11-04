/**
 * Automated Test Suite: Phase 5 — GitHub-Native Multi-Agent Communication
 * Verifies the UD-IC/2.0 protocol, GitHubCoordination service, GitHubTransport,
 * comment serialization, reducer state transitions, cross-agent handoffs, and PR evidence validation.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  VERSION,
  serialize,
  parse,
  message,
  validateMessage,
  validateWorkspace,
  manifestBody,
  parseManifest,
  type AgentMessage,
  type Workspace,
  type RemoteComment,
} from "../core/github/protocol.ts";
import { reduce } from "../core/github/reducer.ts";
import { CoordinationCache } from "../core/github/cache.ts";
import { GitHubCoordination } from "../core/github/coordination.ts";
import { type GitHubApi, type ApiResponse, GitHubTransport } from "../core/github/transport.ts";

// In-Memory Mock GitHub API for fully deterministic test execution
class MockGitHubApi implements GitHubApi {
  currentUser = { login: "host-lead", id: 1001 };
  issues: any[] = [];
  comments: Map<number, any[]> = new Map();
  pulls: any[] = [];
  commits: Map<number, any[]> = new Map();
  files: Map<number, any[]> = new Map();
  labels: Map<string, any> = new Map();
  nextIssueNumber = 100;
  nextCommentId = 5000;

  async request<T = any>(method: string, endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    // Current user identity
    if (endpoint === "/user" && method === "GET") {
      return { status: 200, headers: {}, data: this.currentUser as unknown as T };
    }

    // Repository check
    if (endpoint.startsWith("/repos/") && !endpoint.includes("/issues") && !endpoint.includes("/pulls") && method === "GET") {
      return {
        status: 200,
        headers: {},
        data: {
          permissions: { push: true },
          archived: false,
          has_issues: true,
          default_branch: "main",
        } as unknown as T,
      };
    }

    // Assignee check
    if (endpoint.includes("/assignees/")) {
      return { status: 200, headers: {}, data: {} as unknown as T };
    }

    // Labels
    if (endpoint.includes("/labels") && method === "POST") {
      const b = body as any;
      this.labels.set(b.name, b);
      return { status: 201, headers: {}, data: b as unknown as T };
    }
    if (endpoint.includes("/labels/") && method === "GET") {
      const name = decodeURIComponent(endpoint.split("/labels/")[1]);
      if (this.labels.has(name)) {
        return { status: 200, headers: {}, data: this.labels.get(name) as unknown as T };
      }
      const err: any = new Error("Not Found");
      err.status = 404;
      throw err;
    }

    // List issues
    if (endpoint.includes("/issues?state=") && method === "GET") {
      return { status: 200, headers: {}, data: this.issues as unknown as T };
    }

    // Get specific issue
    const issueMatch = endpoint.match(/\/issues\/(\d+)$/);
    if (issueMatch && method === "GET") {
      const num = parseInt(issueMatch[1], 10);
      const found = this.issues.find((i) => i.number === num);
      if (found) return { status: 200, headers: {}, data: found as unknown as T };
    }

    // Create issue
    if (endpoint.endsWith("/issues") && method === "POST") {
      const b = body as any;
      const num = this.nextIssueNumber++;
      const issue = {
        number: num,
        title: b.title,
        body: b.body,
        user: this.currentUser,
        labels: b.labels || [],
        assignees: (b.assignees || []).map((login: string) => ({ login })),
        pull_request: undefined,
      };
      this.issues.push(issue);
      this.comments.set(num, []);
      return { status: 201, headers: {}, data: issue as unknown as T };
    }

    // Update issue assignees
    if (endpoint.includes("/issues/") && method === "PATCH") {
      const num = parseInt(endpoint.split("/issues/")[1], 10);
      const b = body as any;
      const found = this.issues.find((i) => i.number === num);
      if (found && b.assignees) {
        found.assignees = b.assignees.map((login: string) => ({ login }));
      }
      return { status: 200, headers: {}, data: found as unknown as T };
    }

    // List issue comments
    const commentsListMatch = endpoint.match(/\/issues\/(\d+)\/comments/);
    if (commentsListMatch && method === "GET") {
      const num = parseInt(commentsListMatch[1], 10);
      const list = this.comments.get(num) || [];
      return { status: 200, headers: {}, data: list as unknown as T };
    }

    // Create issue comment
    if (commentsListMatch && method === "POST") {
      const num = parseInt(commentsListMatch[1], 10);
      const b = body as any;
      const id = this.nextCommentId++;
      const now = new Date().toISOString();
      const comment = {
        id,
        body: b.body,
        user: this.currentUser,
        created_at: now,
        updated_at: now,
        html_url: `https://github.com/mock-org/study-planner/issues/${num}#issuecomment-${id}`,
        issue: num,
      };
      if (!this.comments.has(num)) this.comments.set(num, []);
      this.comments.get(num)!.push(comment);
      return { status: 201, headers: {}, data: comment as unknown as T };
    }

    if (endpoint.includes('/pulls?') && method === 'GET') {
      return {status:200, headers:{}, data:this.pulls as unknown as T};
    }

    // Pull request inspect endpoints
    const prMatch = endpoint.match(/\/pulls\/(\d+)$/);
    if (prMatch && method === "GET") {
      const num = parseInt(prMatch[1], 10);
      const pr = this.pulls.find((p) => p.number === num);
      if (pr) return { status: 200, headers: {}, data: pr as unknown as T };
    }

    const prFilesMatch = endpoint.match(/\/pulls\/(\d+)\/files/);
    if (prFilesMatch && method === "GET") {
      const num = parseInt(prFilesMatch[1], 10);
      const files = this.files.get(num) || [];
      return { status: 200, headers: {}, data: files as unknown as T };
    }

    const prCommitsMatch = endpoint.match(/\/pulls\/(\d+)\/commits/);
    if (prCommitsMatch && method === "GET") {
      const num = parseInt(prCommitsMatch[1], 10);
      const commits = this.commits.get(num) || [];
      return { status: 200, headers: {}, data: commits as unknown as T };
    }

    const prReviewsMatch = endpoint.match(/\/pulls\/(\d+)\/reviews/);
    if (prReviewsMatch && method === "GET") {
      return { status: 200, headers: {}, data: [] as unknown as T };
    }

    // Commit check runs and status
    if (endpoint.includes("/check-runs")) {
      return {
        status: 200,
        headers: {},
        data: {
          check_runs: [{ name: "test", status: "completed", conclusion: "success" }],
        } as unknown as T,
      };
    }
    if (endpoint.endsWith("/status")) {
      return { status: 200, headers: {}, data: { statuses: [] } as unknown as T };
    }

    // User lookup
    if (endpoint.startsWith("/users/")) {
      const l = endpoint.split("/users/")[1];
      return {
        status: 200,
        headers: {},
        data: { login: l, id: l === "dev-alice" ? 1002 : l === "dev-bob" ? 1003 : 1004 } as unknown as T,
      };
    }

    return { status: 200, headers: {}, data: {} as unknown as T };
  }
}

describe("Phase 5: GitHub-Native Multi-Agent Communication Suite (UD-IC/2.0)", () => {
  let mockApi: MockGitHubApi;
  let cache: CoordinationCache;
  let coordination: GitHubCoordination;
  let sampleWorkspace: Workspace;

  before(() => {
    mockApi = new MockGitHubApi();
    cache = new CoordinationCache();
    coordination = new GitHubCoordination(mockApi, cache);

    sampleWorkspace = {
      version: VERSION,
      projectId: "proj-study-planner",
      name: "AI Study Planner MVP",
      description: "Collaborative study planning with spaced repetition",
      architecture: "Frontend React 19 + Backend Express/SQLite",
      repo: "mock-org/study-planner",
      baseBranch: "main",
      requiredChecks: ["test"],
      host: { login: "host-lead", id: 1001 },
      members: [
        { login: "dev-alice", id: 1002, role: "frontend", tool: "antigravity" },
        { login: "dev-bob", id: 1003, role: "backend", tool: "claude-code" },
      ],
      tasks: [
        {
          id: "task-fe",
          title: "Build Study Sessions View",
          assignee: "dev-alice",
          tool: "antigravity",
          branch: "feat/task-fe-sessions",
          description: "Implement interactive session timetable",
          dependencies: [],
          allowedPaths: ["web/src/features/sessions/"],
          protectedPaths: ["server/"],
          acceptanceCriteria: ["Renders session list", "Shows countdown timer"],
          contracts: { route: "/api/study-sessions" },
        },
        {
          id: "task-be",
          title: "Implement Study Sessions API",
          assignee: "dev-bob",
          tool: "claude-code",
          branch: "feat/task-be-api",
          description: "Implement REST endpoints for study sessions",
          dependencies: [],
          allowedPaths: ["server/api/studySessions.ts"],
          protectedPaths: ["web/"],
          acceptanceCriteria: ["GET /api/study-sessions returns sessions array"],
          contracts: { route: "/api/study-sessions", method: "GET" },
        },
      ],
    };
  });

  // ==========================================
  // TEST A: Protocol Serialization & Validation
  // ==========================================
  describe("Test A: UD-IC/2.0 Protocol Serialization & Schema Enforcement", () => {
    it("serializes and parses valid UD-IC/2.0 message with machine-readable block", () => {
      const msg = message({
        projectId: "proj-study-planner",
        taskId: "task-fe",
        sender: "dev-alice",
        recipient: "dev-bob",
        type: "HANDOFF_REQUEST",
        payload: {
          targetTaskId: "task-be",
          text: "Need GET /api/study-sessions payload schema details",
          contract: "interface StudySession { id: string; duration: number }",
        },
      });

      const serialized = serialize(msg);
      assert.ok(serialized.includes("[dev-alice's Codex] [UD-IC/2.0]"));
      assert.ok(serialized.includes("```ud-ic-json"));
      assert.ok(serialized.includes("HANDOFF_REQUEST"));

      const parsed = parse(serialized);
      assert.ok(parsed);
      assert.equal(parsed.id, msg.id);
      assert.equal(parsed.type, "HANDOFF_REQUEST");
      assert.equal(parsed.sender, "dev-alice");
      assert.equal(parsed.recipient, "dev-bob");
      assert.equal(parsed.payload.targetTaskId, "task-be");
    });

    it("rejects unknown message types and malformed schemas", () => {
      assert.throws(() => {
        validateMessage({
          version: VERSION,
          id: randomUUID(),
          projectId: "proj-1",
          taskId: "task-1",
          sender: "dev-alice",
          recipient: "dev-bob",
          type: "INVALID_UNKNOWN_TYPE" as any,
          createdAt: new Date().toISOString(),
          payload: {},
        });
      }, /Unsupported message protocol\/type/);
    });

    it("detects and rejects cyclic task dependencies in workspace validation", () => {
      assert.throws(() => {
        validateWorkspace({
          ...sampleWorkspace,
          tasks: [
            { ...sampleWorkspace.tasks[0], dependencies: ["task-be"] },
            { ...sampleWorkspace.tasks[1], dependencies: ["task-fe"] },
          ],
        });
      }, /Cyclic task dependencies/);
    });
  });

  // ==========================================
  // TEST B: Workspace Initialization & Issues
  // ==========================================
  describe("Test B: Workspace Initialization & Issue Generation", () => {
    it("creates coordinator issue and individual task issues with proper labels and assignees", async () => {
      const snapshot = await coordination.initialize(sampleWorkspace);

      assert.ok(snapshot.coordinatorIssue > 0);
      assert.equal(snapshot.tasks.length, 2);

      // Verify coordinator issue was created
      const coordIssue = mockApi.issues.find((i) => i.title.startsWith("[UD-COORDINATOR]"));
      assert.ok(coordIssue);
      assert.ok(coordIssue.labels.includes("ud-coordination"));

      // Verify task issues were created with assignees
      const feIssue = mockApi.issues.find((i) => i.title.includes("Build Study Sessions View"));
      const beIssue = mockApi.issues.find((i) => i.title.includes("Implement Study Sessions API"));
      assert.ok(feIssue);
      assert.ok(beIssue);
      assert.ok(feIssue.labels.includes("ud-task"));
      assert.ok(feIssue.assignees.some((a: any) => a.login === "dev-alice"));
      assert.ok(beIssue.assignees.some((a: any) => a.login === "dev-bob"));
    });
  });

  // ==========================================
  // TEST C: Task Acknowledgment Workflow
  // ==========================================
  describe("Test C: Task Acknowledgment Workflow", () => {
    it("processes TASK_ACK and rejects duplicate advancements", async () => {
      const snapshot = await coordination.poll(sampleWorkspace.repo, sampleWorkspace.projectId);
      const feTask = snapshot.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(feTask.status, "awaiting_ack");

      // Alice acknowledges assignment
      const comments: RemoteComment[] = [
        {
          id: 101,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_ACK",
              payload: {
                assignmentId: feTask.assignmentId,
                text: "Task assignment received. Reviewing contract boundaries.",
              },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:05:00.000Z",
          updated_at: "2026-11-04T10:05:00.000Z",
          html_url: "https://github.com/mock/101",
          issue: feTask.issue!,
        },
      ];

      const existingComments = [
        ...(mockApi.comments.get(snapshot.coordinatorIssue) || []),
        ...(mockApi.comments.get(feTask.issue!) || []),
      ];

      const reduced = reduce(sampleWorkspace, snapshot.coordinatorIssue, [...existingComments, ...comments]);
      const updatedFeTask = reduced.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(updatedFeTask.status, "acknowledged");

      // Verify duplicate advancement without starting is rejected
      const dupAck: RemoteComment = {
        id: 102,
        body: serialize(
          message({
            projectId: sampleWorkspace.projectId,
            taskId: "task-fe",
            sender: "dev-alice",
            recipient: "host-lead",
            type: "TASK_ACK",
            payload: {
              assignmentId: feTask.assignmentId,
              text: "Attempting duplicate ACK",
            },
          })
        ),
        user: { login: "dev-alice", id: 1002 },
        created_at: "2026-11-04T10:06:00.000Z",
        updated_at: "2026-11-04T10:06:00.000Z",
        html_url: "https://github.com/mock/102",
        issue: feTask.issue!,
      };

      const reducedDup = reduce(sampleWorkspace, snapshot.coordinatorIssue, [...existingComments, ...comments, dupAck]);
      const rejectedAudit = reducedDup.audit.find((a) => a.sourceId === 102);
      assert.equal(rejectedAudit?.decision, "rejected");
      assert.ok(rejectedAudit?.reason.includes("already acknowledged"));
    });
  });

  // ==========================================
  // TEST D: Cross-Agent Handoff Exchange
  // ==========================================
  describe("Test D: Cross-Agent Handoff Request & Response Exchange", () => {
    it("handles full lifecycle: REQUEST -> ACK -> RESPONSE -> COMPLETED", () => {
      const feAssignmentId = randomUUID();
      const beAssignmentId = randomUUID();
      const handoffId = randomUUID();

      const comments: RemoteComment[] = [
        // 1. Initial assignments
        {
          id: 1,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "host-lead",
                recipient: "dev-alice",
                type: "TASK_ASSIGNMENT",
                payload: { assignee: "dev-alice", branch: "feat/task-fe-sessions", issue: 101, reason: "init" },
              },
              feAssignmentId
            )
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/1",
          issue: 100,
        },
        {
          id: 2,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-be",
                sender: "host-lead",
                recipient: "dev-bob",
                type: "TASK_ASSIGNMENT",
                payload: { assignee: "dev-bob", branch: "feat/task-be-api", issue: 102, reason: "init" },
              },
              beAssignmentId
            )
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/2",
          issue: 100,
        },
        // 2. Dev Alice asks Bob for API contract
        {
          id: 3,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "dev-alice",
                recipient: "dev-bob",
                type: "HANDOFF_REQUEST",
                payload: {
                  targetTaskId: "task-be",
                  text: "Please provide GET /api/study-sessions schema and error format",
                  deadline: "2026-11-04T12:00:00Z",
                },
              },
              handoffId
            )
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:10:00Z",
          updated_at: "2026-11-04T10:10:00Z",
          html_url: "https://github.com/mock/3",
          issue: 101,
        },
        // 3. Dev Bob acknowledges request
        {
          id: 4,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-be",
              sender: "dev-bob",
              recipient: "dev-alice",
              type: "HANDOFF_ACK",
              correlationId: handoffId,
              payload: { text: "Acknowledged handoff; drafting contract." },
            })
          ),
          user: { login: "dev-bob", id: 1003 },
          created_at: "2026-11-04T10:12:00Z",
          updated_at: "2026-11-04T10:12:00Z",
          html_url: "https://github.com/mock/4",
          issue: 102,
        },
        // 4. Dev Bob responds with contract
        {
          id: 5,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-be",
              sender: "dev-bob",
              recipient: "dev-alice",
              type: "HANDOFF_RESPONSE",
              correlationId: handoffId,
              payload: {
                contract: JSON.stringify({ sessions: [{ id: "string", durationMinutes: "number" }] }),
                text: "Contract defined in PR #5.",
              },
            })
          ),
          user: { login: "dev-bob", id: 1003 },
          created_at: "2026-11-04T10:20:00Z",
          updated_at: "2026-11-04T10:20:00Z",
          html_url: "https://github.com/mock/5",
          issue: 102,
        },
        // 5. Dev Alice marks handoff completed
        {
          id: 6,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "dev-bob",
              type: "HANDOFF_COMPLETED",
              correlationId: handoffId,
              payload: { text: "Contract received and validated in UI." },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:25:00Z",
          updated_at: "2026-11-04T10:25:00Z",
          html_url: "https://github.com/mock/6",
          issue: 101,
        },
      ];

      const reduced = reduce(sampleWorkspace, 100, comments);
      const handoff = reduced.handoffs.find((h) => h.id === handoffId);
      assert.ok(handoff);
      assert.equal(handoff.status, "completed");
      assert.ok(handoff.response?.includes("durationMinutes"));
    });
  });

  // ==========================================
  // TEST E: Progress & Monotonicity
  // ==========================================
  describe("Test E: Progress Reporting & Monotonicity Guards", () => {
    it("accepts increasing progress and rejects regressions", () => {
      const assignmentId = randomUUID();
      const baseComments: RemoteComment[] = [
        {
          id: 1,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "host-lead",
                recipient: "dev-alice",
                type: "TASK_ASSIGNMENT",
                payload: { assignee: "dev-alice", branch: "feat/task-fe-sessions", issue: 101, reason: "init" },
              },
              assignmentId
            )
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/1",
          issue: 100,
        },
        {
          id: 2,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_ACK",
              payload: { assignmentId, text: "ack" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:01:00Z",
          updated_at: "2026-11-04T10:01:00Z",
          html_url: "https://github.com/mock/2",
          issue: 101,
        },
        {
          id: 3,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_STARTED",
              payload: { assignmentId, text: "started" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:02:00Z",
          updated_at: "2026-11-04T10:02:00Z",
          html_url: "https://github.com/mock/3",
          issue: 101,
        },
        {
          id: 4,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_PROGRESS",
              payload: { assignmentId, progress: 60, text: "Components built" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:15:00Z",
          updated_at: "2026-11-04T10:15:00Z",
          html_url: "https://github.com/mock/4",
          issue: 101,
        },
      ];

      const reduced1 = reduce(sampleWorkspace, 100, baseComments);
      const task1 = reduced1.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(task1.status, "running");
      assert.equal(task1.progress, 60);

      // Attempt regression to 40%
      const regressed: RemoteComment = {
        id: 5,
        body: serialize(
          message({
            projectId: sampleWorkspace.projectId,
            taskId: "task-fe",
            sender: "dev-alice",
            recipient: "host-lead",
            type: "TASK_PROGRESS",
            payload: { assignmentId, progress: 40, text: "regressing progress" },
          })
        ),
        user: { login: "dev-alice", id: 1002 },
        created_at: "2026-11-04T10:20:00Z",
        updated_at: "2026-11-04T10:20:00Z",
        html_url: "https://github.com/mock/5",
        issue: 101,
      };

      const reduced2 = reduce(sampleWorkspace, 100, [...baseComments, regressed]);
      const task2 = reduced2.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(task2.progress, 60, "Progress must not regress");
      assert.equal(reduced2.audit.find((a) => a.sourceId === 5)?.decision, "rejected");
    });
  });

  // ==========================================
  // TEST F & G: PR Submission, Inspection & Host Gate
  // ==========================================
  describe("Test F & G: PR Evidence Submission & Host Approval Gating", () => {
    it("accepts verified PR matching allowed paths and passing CI, gates host approval", () => {
      const assignmentId = randomUUID();
      const submissionId = randomUUID();

      const comments: RemoteComment[] = [
        {
          id: 1,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "host-lead",
                recipient: "dev-alice",
                type: "TASK_ASSIGNMENT",
                payload: { assignee: "dev-alice", branch: "feat/task-fe-sessions", issue: 101, reason: "init" },
              },
              assignmentId
            )
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/1",
          issue: 100,
        },
        {
          id: 2,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_ACK",
              payload: { assignmentId, text: "ack" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:01:00Z",
          updated_at: "2026-11-04T10:01:00Z",
          html_url: "https://github.com/mock/2",
          issue: 101,
        },
        {
          id: 3,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_STARTED",
              payload: { assignmentId, text: "started" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:02:00Z",
          updated_at: "2026-11-04T10:02:00Z",
          html_url: "https://github.com/mock/3",
          issue: 101,
        },
        {
          id: 4,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "dev-alice",
                recipient: "host-lead",
                type: "TASK_COMPLETED",
                payload: {
                  assignmentId,
                  branch: "feat/task-fe-sessions",
                  prNumber: 42,
                  commitHash: "0123456789abcdef0123456789abcdef01234567",
                  text: "Implementation complete and tested.",
                },
              },
              submissionId
            )
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:30:00Z",
          updated_at: "2026-11-04T10:30:00Z",
          html_url: "https://github.com/mock/4",
          issue: 101,
        },
        // Host approves with matching PR and commit head SHA
        {
          id: 5,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "host-lead",
              recipient: "dev-alice",
              type: "HOST_APPROVAL",
              correlationId: submissionId,
              payload: {
                prNumber: 42,
                expectedHeadSha: "0123456789abcdef0123456789abcdef01234567",
                text: "Verified PR #42 diff and passing test suite.",
              },
            })
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:35:00Z",
          updated_at: "2026-11-04T10:35:00Z",
          html_url: "https://github.com/mock/5",
          issue: 101,
        },
      ];

      // PR Evidence verified by inspection
      const mockEvidence = {
        [submissionId]: {
          number: 42,
          url: "https://github.com/mock/pulls/42",
          author: "dev-alice",
          branch: "feat/task-fe-sessions",
          headSha: "0123456789abcdef0123456789abcdef01234567",
          state: "open",
          merged: false,
          files: ["web/src/features/sessions/index.tsx"],
          reviews: [],
          checks: [{ name: "test", status: "completed", conclusion: "success" }],
          ci: "passed" as const,
          valid: true,
          problems: [],
        },
      };

      const reduced = reduce(sampleWorkspace, 100, comments, mockEvidence);
      const feTask = reduced.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(feTask.status, "verified");
      assert.equal(feTask.progress, 100);
    });
  });

  // ==========================================
  // TEST H: Recovery, Quarantine & Idempotency
  // ==========================================
  describe("Test H: Quarantine of Edited Comments & Idempotent Replay", () => {
    it("quarantines edited comments without state corruption", () => {
      const assignmentId = randomUUID();

      const comments: RemoteComment[] = [
        {
          id: 1,
          body: serialize(
            message(
              {
                projectId: sampleWorkspace.projectId,
                taskId: "task-fe",
                sender: "host-lead",
                recipient: "dev-alice",
                type: "TASK_ASSIGNMENT",
                payload: { assignee: "dev-alice", branch: "feat/task-fe-sessions", issue: 101, reason: "init" },
              },
              assignmentId
            )
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/1",
          issue: 100,
        },
        // Tampered/edited comment: created_at != updated_at
        {
          id: 2,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "dev-alice",
              recipient: "host-lead",
              type: "TASK_ACK",
              payload: { assignmentId, text: "tampered" },
            })
          ),
          user: { login: "dev-alice", id: 1002 },
          created_at: "2026-11-04T10:01:00Z",
          updated_at: "2026-11-04T10:05:00Z", // MODIFIED POST-PUBLISH
          html_url: "https://github.com/mock/2",
          issue: 101,
        },
      ];

      const reduced = reduce(sampleWorkspace, 100, comments);
      const feTask = reduced.tasks.find((t) => t.id === "task-fe")!;
      assert.equal(feTask.status, "awaiting_ack", "Status must NOT advance on edited comment");
      const audit = reduced.audit.find((a) => a.sourceId === 2);
      assert.equal(audit?.decision, "rejected");
      assert.ok(audit?.reason.includes("Edited protocol comments are quarantined"));
    });

    it("replay is strictly idempotent across restarts with identical cursor", () => {
      const comments: RemoteComment[] = [
        {
          id: 10,
          body: serialize(
            message({
              projectId: sampleWorkspace.projectId,
              taskId: "task-fe",
              sender: "host-lead",
              recipient: "dev-alice",
              type: "HOST_MESSAGE",
              payload: { action: "info", text: "Welcome to hackathon coordination" },
            })
          ),
          user: { login: "host-lead", id: 1001 },
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:00:00Z",
          html_url: "https://github.com/mock/10",
          issue: 100,
        },
      ];

      const pass1 = reduce(sampleWorkspace, 100, comments);
      const pass2 = reduce(sampleWorkspace, 100, comments);

      assert.equal(pass1.cursor, pass2.cursor);
      assert.equal(pass1.messages.length, pass2.messages.length);
      assert.equal(pass1.audit.length, pass2.audit.length);
      assert.equal(pass1.audit[0].decision, pass2.audit[0].decision);
    });
  });
});
