/**
 * Automated HTTP Integration Test Suite: Upside-Down 2.0 API Endpoints
 * Tests the complete hosted REST journey using an ephemeral in-memory Express instance
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createServer } from "../index.ts";

describe("Upside-Down 2.0: Full HTTP API Endpoints Test", () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let selectedIdeaId: string;
  let firstTaskId: string;
  let handoffId: string;

  before(async () => {
    const instance = createServer(":memory:");
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

  it("POST /api/hackathon/projects creates project and registers host", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "EcoTransit Mesh",
        problemStatement: "Urban commuters face fragmented micro-mobility options and unpredictable transfers.",
        rules: "24h MVP, open APIs",
        availableTime: "24h",
        developerCount: 3,
        skillLevels: "Senior AI Developers",
        technologies: ["React", "Express", "SQLite"],
        budgetConstraints: "Free tier only",
        judgingCriteria: "Impact and system reliability",
        hostName: "Dikshant Duggal",
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.project.id.startsWith("proj-"));
    projectId = body.project.id;
  });

  it("GET /api/hackathon/projects lists all active projects", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(Array.isArray(body.projects));
    assert.ok(body.projects.some((p: any) => p.id === projectId));
  });

  it("POST /api/hackathon/projects/:id/ideas/generate creates 3-5 concepts", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/generate`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.ideas.length >= 3);
    selectedIdeaId = body.ideas[0].id;
  });

  it("POST /api/hackathon/projects/:id/ideas/refine refines ideas conversationally", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feedback: "Make it more innovative and emphasize live demo readiness",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.ideas[0].version, 2);
    selectedIdeaId = body.ideas[0].id; // update to version 2 idea
  });

  it("POST /api/hackathon/projects/:id/ideas/:ideaId/select locks human approval", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/ideas/${selectedIdeaId}/select`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.selectedIdea.isSelected, true);
  });

  it("POST /api/hackathon/projects/:id/architecture/generate creates blueprint & 7-phase roadmap", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/architecture/generate`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.architecture.roadmap.length, 7);
    assert.ok(body.architecture.contracts.length >= 5);
  });

  it("POST /api/hackathon/projects/:id/architecture/approve confirms host approval", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/architecture/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.architecture.isApproved, true);
  });

  it("POST /api/hackathon/projects/:id/tasks/generate decomposes work contracts", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/tasks/generate`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.tasks.length, 4);
    firstTaskId = body.tasks[0].taskId;
  });

  it("GET /api/hackathon/projects/:id/tasks retrieves task contracts v2", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/tasks`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.tasks.length, 4);
    assert.equal(body.tasks[0].contractVersion, "2.0");
  });

  it("POST /api/hackathon/tasks/:id/claim leases contract to agent", async () => {
    const res = await fetch(`${baseUrl}/hackathon/tasks/${firstTaskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberName: "Agent Alpha",
        agentTool: "antigravity",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.task.status, "assigned");
    assert.ok(body.task.leaseExpiration);
  });

  it("POST /api/hackathon/tasks/:id/progress updates status & progress", async () => {
    const res = await fetch(`${baseUrl}/hackathon/tasks/${firstTaskId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "in_progress",
        progressPercent: 75,
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.task.progressPercent, 75);
    assert.equal(body.task.status, "in_progress");
  });

  it("POST /api/hackathon/tasks/:id/submit submits evidence & moves to in_review", async () => {
    const res = await fetch(`${baseUrl}/hackathon/tasks/${firstTaskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch: "feat/task-fe-01",
        prNumber: 88,
        prUrl: "https://github.com/DikshantDuggal/Upside-Down/pull/88",
        testsPassed: true,
        testOutput: "PASS 40 tests passed",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.task.status, "in_review");
    assert.equal(body.task.evidence.prNumber, 88);
  });

  it("GET /api/hackathon/tasks/:id/prompt-bridge/:tool formats tool-specific assignment", async () => {
    const res = await fetch(`${baseUrl}/hackathon/tasks/${firstTaskId}/prompt-bridge/antigravity`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.prompt.includes("GOOGLE ANTIGRAVITY"));
    assert.ok(body.prompt.includes("STRICT PATH BOUNDARIES"));
  });

  it("POST /api/hackathon/projects/:id/handoffs creates cross-agent request", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/handoffs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceTaskId: firstTaskId,
        sourceRole: "frontend",
        targetTaskId: "task-be-01",
        targetRole: "backend",
        requestSummary: "Need additional telemetry endpoint for live transit metrics",
        contractDetails: { path: "/api/telemetry" },
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.ok(body.handoff.id.startsWith("handoff-"));
    handoffId = body.handoff.id;
  });

  it("POST /api/hackathon/handoffs/:id/resolve resolves dependency", async () => {
    const res = await fetch(`${baseUrl}/hackathon/handoffs/${handoffId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "resolved",
        resolutionNotes: "Endpoint added and verified in backend build.",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.status, "resolved");
  });

  it("POST /api/hackathon/projects/:id/integration/check evaluates release safety", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/integration/check`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.release.collisionDetected, false);
    assert.equal(body.release.buildStatus, "passed");
  });

  it("POST /api/hackathon/projects/:id/release/approve records host release signature", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/release/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedBy: "Dikshant Duggal" }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.release.releaseApproved, true);
    assert.equal(body.release.releaseApprovedBy, "Dikshant Duggal");
  });

  it("POST /api/hackathon/projects/:id/deploy finalizes live production deployment", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}/deploy`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.success, true);
    assert.equal(body.release.deploymentStatus, "live");
    assert.ok(body.release.deploymentUrl);
  });

  it("GET /api/hackathon/projects/:id aggregates complete project state", async () => {
    const res = await fetch(`${baseUrl}/hackathon/projects/${projectId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.project.name, "EcoTransit Mesh");
    assert.ok(body.selectedIdea);
    assert.ok(body.architecture);
    assert.equal(body.tasks.length, 4);
    assert.equal(body.release.deploymentStatus, "live");
  });
});
