/**
 * Multi-User Hackathon Pilot Verification Suite (Upside-Down 2.0)
 * Verifies end-to-end multi-agent execution, tool prompt bridges, cross-agent handoffs,
 * lease collision protection, GitHub webhook tracking, and host release gating.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createServer } from "../index.ts";

describe("Upside-Down 2.0: Multi-User Collaboration & Real Agent Pilot", () => {
  let server: Server;
  let instance: ReturnType<typeof createServer>;
  let baseUrl: string;

  before(async () => {
    instance = createServer(":memory:");
    await new Promise<void>((resolve) => {
      server = instance.app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}/api`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ========================================================
  // PILOT 1: 2-DEVELOPER MVP (AI STUDY PLANNER)
  // Alice (Developer A / Frontend) + Bob (Developer B / Backend)
  // ========================================================
  describe("Pilot 1: 2-Developer Collaboration (AI Study Planner MVP)", () => {
    let projectId: string;
    let selectedIdeaId: string;
    let frontendTask: any;
    let backendTask: any;
    let handoffId: string;

    it("1. Host creates a 2-developer hackathon project", async () => {
      const res = await fetch(`${baseUrl}/hackathon/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "AI Study Planner MVP",
          problemStatement: "Students struggle with cramming and unorganized study schedules ahead of finals.",
          rules: "24h Hackathon MVP, open-source stack",
          availableTime: "24h",
          developerCount: 2,
          skillLevels: "Full-Stack Developers",
          technologies: ["React 19", "Express", "SQLite"],
          budgetConstraints: "Zero budget",
          judgingCriteria: "Practical utility, UX polish, multi-agent coordination",
          hostName: "Host Admin",
        }),
      });

      assert.equal(res.status, 201);
      const data = (await res.json()) as any;
      assert.equal(data.success, true);
      assert.equal(data.project.developerCount, 2);
      projectId = data.project.id;
    });

    it("2. AI Idea Engine generates concepts, Host refines & selects idea", async () => {
      const genRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/generate`, {
        method: "POST",
      });
      assert.equal(genRes.status, 200);
      const genData = (await genRes.json()) as any;
      assert.ok(genData.ideas.length >= 3);
      selectedIdeaId = genData.ideas[0].id;

      // Host feedback refinement
      const refRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "Prioritize spaced repetition algorithms and calendar synchronization.",
        }),
      });
      assert.equal(refRes.status, 200);

      // Host selects winning idea
      const selRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/${selectedIdeaId}/select`, {
        method: "POST",
      });
      assert.equal(selRes.status, 200);
      const selData = (await selRes.json()) as any;
      assert.equal(selData.selectedIdea.isSelected, true);
    });

    it("3. Technical Architecture is generated and approved", async () => {
      const archRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/architecture/generate`, {
        method: "POST",
      });
      assert.equal(archRes.status, 200);
      const archData = (await archRes.json()) as any;
      assert.ok(archData.architecture.spec.objective.length > 0);

      const appRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/architecture/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: archData.architecture.version }),
      });
      assert.equal(appRes.status, 200);
      const appData = (await appRes.json()) as any;
      assert.equal(appData.architecture.isApproved, true);
    });

    it("4. Host triggers START MISSION: auto-decomposes and assigns tasks to 2 developers", async () => {
      const startRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/start-mission`, {
        method: "POST",
      });
      assert.equal(startRes.status, 200);
      const startData = (await startRes.json()) as any;
      assert.equal(startData.success, true);
      assert.equal(startData.project.status, "development");
      assert.ok(startData.tasks.length >= 2);

      frontendTask = startData.tasks.find((t: any) => t.assignedRole === "frontend");
      backendTask = startData.tasks.find((t: any) => t.assignedRole === "backend");

      assert.ok(frontendTask, "Frontend task contract must exist");
      assert.ok(backendTask, "Backend task contract must exist");

      // Verify slot assignments and 1-hour leases
      assert.equal(frontendTask.owner.assignedSlot, "developer-a");
      assert.equal(backendTask.owner.assignedSlot, "developer-b");
      assert.equal(frontendTask.status, "assigned");
      assert.equal(backendTask.status, "assigned");
      assert.ok(new Date(frontendTask.leaseExpiration).getTime() > Date.now());
      assert.ok(new Date(backendTask.leaseExpiration).getTime() > Date.now());
    });

    it("5. Lease Collision Prevention: Developer B cannot overwrite Developer A's active lease", async () => {
      const collisionRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(frontendTask.taskId)}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: "mem-devb-attempt",
          memberName: "Developer B (Intruder)",
          assignedSlot: "developer-b",
          agentTool: "claude-code",
        }),
      });

      assert.equal(collisionRes.status, 409);
      const errData = (await collisionRes.json()) as any;
      assert.equal(errData.error, "TASK_LEASE_COLLISION");
      assert.ok(errData.message.includes("leased"));
    });

    it("6. Tool Prompt Bridge generates tailored prompts for Antigravity & Claude Code", async () => {
      // Developer A using Antigravity
      const antiRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(frontendTask.taskId)}/prompt-bridge/antigravity`);
      assert.equal(antiRes.status, 200);
      const antiData = (await antiRes.json()) as any;
      assert.equal(antiData.tool, "antigravity");
      assert.ok(antiData.prompt.includes("GOOGLE ANTIGRAVITY SPECIFIC INSTRUCTIONS"));
      assert.ok(antiData.prompt.includes(frontendTask.allowedPaths[0]));

      // Developer B using Claude Code
      const claudeRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(backendTask.taskId)}/prompt-bridge/claude-code`);
      assert.equal(claudeRes.status, 200);
      const claudeData = (await claudeRes.json()) as any;
      assert.equal(claudeData.tool, "claude-code");
      assert.ok(claudeData.prompt.includes("CLAUDE CODE CLI EXECUTION INSTRUCTIONS"));
      assert.ok(claudeData.prompt.includes(backendTask.allowedPaths[0]));
    });

    it("7. Cross-Agent Handoff: Frontend requests API contract from Backend, Backend resolves", async () => {
      // Frontend Developer A creates handoff request
      const handoffRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/handoffs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTaskId: frontendTask.taskId,
          sourceRole: "frontend",
          targetTaskId: backendTask.taskId,
          targetRole: "backend",
          requestSummary: "Need GET /api/study-sessions to return array with id, subject, durationMinutes, and priority.",
          contractDetails: {
            method: "GET",
            path: "/api/study-sessions",
            expectedResponseSchema: {
              sessions: [{ id: "string", subject: "string", durationMinutes: "number", priority: "string" }],
            },
          },
        }),
      });

      assert.equal(handoffRes.status, 201);
      const handoffData = (await handoffRes.json()) as any;
      assert.equal(handoffData.success, true);
      assert.equal(handoffData.handoff.status, "pending");
      handoffId = handoffData.handoff.id;

      // Backend Developer B resolves handoff
      const resolveRes = await fetch(`${baseUrl}/hackathon/handoffs/${handoffId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "resolved",
          resolutionNotes: "Endpoint GET /api/study-sessions implemented in backend PR #12 with SQLite backing.",
        }),
      });

      assert.equal(resolveRes.status, 200);
      const resolveData = (await resolveRes.json()) as any;
      assert.equal(resolveData.status, "resolved");

      // Verify list returns resolved status
      const listRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/handoffs`);
      const listData = (await listRes.json()) as any;
      const found = listData.handoffs.find((h: any) => h.id === handoffId);
      assert.equal(found.status, "resolved");
      assert.ok(found.resolutionNotes.includes("Endpoint GET /api/study-sessions"));
    });

    it("8. GitHub Webhook updates task submissions with branch, commit, and CI test output", async () => {
      // Developer A PR submission via GitHub webhook
      const webhookResA = await fetch(`${baseUrl}/hackathon/github/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "opened",
          taskId: frontendTask.taskId,
          pull_request: {
            head: { ref: `feat/${frontendTask.taskId.toLowerCase()}`, sha: "7a8b9c0" },
            html_url: "https://github.com/DikshantDuggal/Upside-Down/pull/11",
            number: 11,
            title: `[${frontendTask.taskId}] Implement Study Planner dashboard UI`,
            merged: false,
          },
        }),
      });

      assert.equal(webhookResA.status, 200);
      const webhookDataA = (await webhookResA.json()) as any;
      assert.equal(webhookDataA.processed, true);
      assert.equal(webhookDataA.status, "in_review");
      assert.equal(webhookDataA.task.evidence.prNumber, 11);

      // Developer B PR submission via direct task submission API
      const subResB = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(backendTask.taskId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feat/study-sessions-api",
          prNumber: 12,
          prUrl: "https://github.com/DikshantDuggal/Upside-Down/pull/12",
          commitHash: "f1e2d3c",
          testsPassed: true,
          testOutput: "PASS 12/12 unit and integration tests passed",
        }),
      });

      assert.equal(subResB.status, 200);
      const subDataB = (await subResB.json()) as any;
      assert.equal(subDataB.task.status, "in_review");
    });

    it("9. Integration Engine detects 0 collisions across isolated allowed paths & Host approves release", async () => {
      const checkRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/integration/check`, {
        method: "POST",
      });
      assert.equal(checkRes.status, 200);
      const checkData = (await checkRes.json()) as any;
      assert.equal(checkData.collisionCheck.hasCollision, false);
      assert.equal(checkData.release.collisionDetected, false);
      assert.ok(["pending", "passed"].includes(checkData.release.contractCheck));

      // Host approves release
      const approveRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/release/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: "Dikshant Duggal (Lead Host)" }),
      });

      assert.equal(approveRes.status, 200);
      const approveData = (await approveRes.json()) as any;
      assert.equal(approveData.release.releaseApproved, true);
      assert.equal(approveData.release.releaseApprovedBy, "Dikshant Duggal (Lead Host)");

      // Project status becomes released
      const projRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}`);
      const projData = (await projRes.json()) as any;
      assert.equal(projData.project.status, "released");
    });
  });

  // ========================================================
  // PILOT 2: 3-DEVELOPER PILOT (AI INTEGRATION SPECIALIST)
  // Alice (Frontend) + Bob (Backend) + Carol (AI Specialist)
  // ========================================================
  describe("Pilot 2: 3-Developer Collaboration with AI Integration Specialist", () => {
    let projectId: string;

    it("1. Create 3-developer project and execute START MISSION", async () => {
      const projRes = await fetch(`${baseUrl}/hackathon/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "HealthTrack Multi-Agent",
          problemStatement: "Patients need unified biometric data analysis and predictive health alerts.",
          rules: "Open source, zero cost",
          availableTime: "24h",
          developerCount: 3,
          hostName: "Host Lead",
        }),
      });
      const projData = (await projRes.json()) as any;
      projectId = projData.project.id;

      // Start mission directly (will auto-generate idea & architecture if needed)
      const startRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/start-mission`, {
        method: "POST",
      });
      assert.equal(startRes.status, 200);
      const startData = (await startRes.json()) as any;
      assert.equal(startData.success, true);
      assert.equal(startData.project.status, "development");

      // Verify all 3 slots are represented
      const slots = startData.tasks.map((t: any) => t.owner.assignedSlot);
      assert.ok(slots.includes("developer-a"), "developer-a must be assigned");
      assert.ok(slots.includes("developer-b"), "developer-b must be assigned");
      assert.ok(slots.includes("developer-c"), "developer-c must be assigned");
    });

    it("2. Prompt Bridge produces specialized directives for Cursor, Codex, and Aider", async () => {
      const tasksRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/tasks`);
      const { tasks } = (await tasksRes.json()) as any;
      const cTask = tasks.find((t: any) => t.owner.assignedSlot === "developer-c") || tasks[0];

      // Cursor prompt
      const cursorRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(cTask.taskId)}/prompt-bridge/cursor`);
      const cursorData = (await cursorRes.json()) as any;
      assert.ok(cursorData.prompt.includes("CURSOR IDE & COMPOSER INSTRUCTIONS"));
      assert.ok(cursorData.prompt.includes(".cursorrules"));

      // Aider prompt
      const aiderRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(cTask.taskId)}/prompt-bridge/aider`);
      const aiderData = (await aiderRes.json()) as any;
      assert.ok(aiderData.prompt.includes("AIDER CLI EXECUTION INSTRUCTIONS"));
      assert.ok(aiderData.prompt.includes("aider"));

      // Codex prompt
      const codexRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(cTask.taskId)}/prompt-bridge/codex`);
      const codexData = (await codexRes.json()) as any;
      assert.ok(codexData.prompt.includes("OPENAI CODEX / API INSTRUCTIONS"));
    });

    it("3. GitHub webhook merged PR event completes task", async () => {
      const tasksRes = await fetch(`${baseUrl}/hackathon/projects/${projectId}/tasks`);
      const { tasks } = (await tasksRes.json()) as any;
      const target = tasks[0];

      const webhookRes = await fetch(`${baseUrl}/hackathon/github/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "closed",
          taskId: target.taskId,
          pull_request: {
            head: { ref: `feat/${target.taskId.toLowerCase()}`, sha: "3cda860" },
            html_url: "https://github.com/DikshantDuggal/Upside-Down/pull/99",
            number: 99,
            merged: true,
          },
        }),
      });

      assert.equal(webhookRes.status, 200);
      const webhookData = (await webhookRes.json()) as any;
      assert.equal(webhookData.processed, true);
      assert.equal(webhookData.status, "completed");

      // Verify task in database is marked completed
      const checkRes = await fetch(`${baseUrl}/hackathon/tasks/${encodeURIComponent(target.taskId)}`);
      const checkData = (await checkRes.json()) as any;
      assert.equal(checkData.task.status, "completed");
      assert.equal(checkData.task.progressPercent, 100);
    });
  });

  // ========================================================
  // REAL-TIME SSE STREAM & DISCONNECT RESILIENCE
  // ========================================================
  describe("SSE Real-Time Stream & Disconnect Resilience", () => {
    it("Connects to event stream and receives initial greeting packet", async () => {
      const controller = new AbortController();
      const sseRes = await fetch(`${baseUrl}/hackathon/projects/test-stream/events/stream`, {
        signal: controller.signal,
      });

      assert.equal(sseRes.status, 200);
      assert.equal(sseRes.headers.get("content-type"), "text/event-stream");

      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      assert.ok(text.includes("event: CONNECTED"));
      assert.ok(text.includes("test-stream"));

      // Disconnect cleanly
      controller.abort();
    });
  });
});
