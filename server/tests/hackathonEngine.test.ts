/**
 * Automated Test Suite: Upside-Down 2.0 — AI Hackathon Mission Control
 * Verifies End-to-End Workflow:
 * Problem -> AI Ideas -> Refinement -> Selection -> Architecture -> 2/3-Dev Tasks -> Prompt Bridge -> Handoffs -> Collision -> Release
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HackathonRepository } from "../db/hackathonRepository.ts";
import { AICoordinator } from "../core/aiCoordinator.ts";
import { PromptBridgeService } from "../core/promptBridge.ts";
import { IntegrationEngine } from "../core/integrationEngine.ts";
import type { HackathonProject, TaskContractV2 } from "../../contracts/hackathon.ts";

describe("Upside-Down 2.0: AI Hackathon Mission Control Engine", () => {
  const db = new DatabaseSync(":memory:");
  const repo = new HackathonRepository(db);
  const ai = new AICoordinator({ provider: "demo" });
  const promptBridge = new PromptBridgeService();
  const integrationEngine = new IntegrationEngine();

  let createdProject: HackathonProject;

  it("1. Creates a hackathon project with problem statement and developer constraints", () => {
    createdProject = repo.createProject({
      name: "Autonomous Health Navigator",
      problemStatement: "Patients struggle to triage acute symptoms and coordinate lab work across clinic networks during emergencies.",
      rules: "Build an MVP in 24 hours. Must use AI-driven decision support and open APIs.",
      availableTime: "24h",
      developerCount: 3,
      skillLevels: "Intermediate to Advanced",
      technologies: ["React", "Express", "SQLite", "TailwindCSS"],
      budgetConstraints: "Zero budget / free tier only",
      judgingCriteria: "Clinical impact, technical completeness, multi-agent collaboration",
      status: "ideation",
      hostId: "host-dikshant",
    });

    assert.ok(createdProject.id.startsWith("proj-"));
    assert.equal(createdProject.name, "Autonomous Health Navigator");
    assert.equal(createdProject.developerCount, 3);
    assert.equal(createdProject.status, "ideation");

    // Host should be in team
    repo.addTeamMember({
      id: "host-dikshant",
      projectId: createdProject.id,
      name: "Dikshant Duggal",
      role: "host",
      assignedSlot: "host",
      connectedTool: "antigravity",
      isJoined: true,
      joinedAt: new Date().toISOString(),
    });

    const members = repo.listTeamMembers(createdProject.id);
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "host");
  });

  it("2. AI Idea Studio: Generates 3-5 distinct concepts tailored to the problem statement", async () => {
    const ideas = await ai.generateIdeas(createdProject);
    assert.ok(ideas.length >= 3);
    assert.ok(ideas.length <= 5);

    for (const idea of ideas) {
      assert.ok(idea.name.length > 0);
      assert.ok(idea.pitch.length > 0);
      assert.ok(idea.usp.length > 0);
      assert.ok(idea.coreFeatures.length > 0);
      assert.ok(idea.technicalRisks.length > 0);
      assert.equal(idea.version, 1);
      assert.equal(idea.isSelected, false);
    }

    repo.saveIdeas(ideas);
    const stored = repo.listIdeas(createdProject.id);
    assert.equal(stored.length, ideas.length);
  });

  it("3. AI Idea Studio: Performs conversational feedback refinement preserving context", async () => {
    const current = repo.listIdeas(createdProject.id);
    const refined = await ai.refineIdeas(
      createdProject,
      "Make this more innovative and focus on zero-cost open-source tools",
      current
    );

    assert.equal(refined.length, current.length);
    assert.equal(refined[0].version, 2);
    assert.ok(refined[0].pitch.includes("innovative") || refined[0].pitch.includes("open-source") || refined[0].pitch.includes("DEMO MODE"));

    repo.saveIdeas(refined);
    repo.addFeedbackMessage(createdProject.id, "user", "Make this more innovative");
    repo.addFeedbackMessage(createdProject.id, "assistant", "Refined 3 concepts.");

    const history = repo.listFeedback(createdProject.id);
    assert.equal(history.length, 2);
  });

  it("4. Human Approval: Host selects an idea and locks an immutable versioned decision", () => {
    const ideas = repo.listIdeas(createdProject.id);
    const toSelect = ideas[0];
    assert.ok(toSelect);

    const selected = repo.selectIdea(createdProject.id, toSelect.id);
    assert.ok(selected);
    assert.equal(selected.isSelected, true);
    assert.equal(selected.id, toSelect.id);

    const projectAfter = repo.getProject(createdProject.id);
    assert.ok(projectAfter);
    assert.equal(projectAfter.status, "architecture");
    assert.equal(projectAfter.selectedIdeaId, toSelect.id);
  });

  it("5. AI Architecture Generator: Generates specification, API contracts, and 7-phase roadmap", async () => {
    const ideas = repo.listIdeas(createdProject.id);
    const selectedIdea = ideas.find((i) => i.isSelected)!;
    assert.ok(selectedIdea);

    const blueprint = await ai.generateArchitecture(createdProject, selectedIdea);
    assert.ok(blueprint.id.startsWith("arch-"));
    assert.ok(blueprint.spec.objective.length > 0);
    assert.ok(blueprint.contracts.length >= 5);
    assert.equal(blueprint.roadmap.length, 7);
    assert.equal(blueprint.isApproved, false);

    repo.saveArchitecture(blueprint);
    const stored = repo.getArchitecture(createdProject.id);
    assert.ok(stored);
    assert.equal(stored.contracts.length, blueprint.contracts.length);

    // Host approves architecture
    const approved = repo.approveArchitecture(createdProject.id, blueprint.version);
    assert.ok(approved);
    assert.equal(approved.isApproved, true);
    assert.ok(approved.approvedAt);

    const projectAfter = repo.getProject(createdProject.id);
    assert.equal(projectAfter?.status, "planning");
  });

  it("6. Multi-Agent Work Division: Decomposes into Task Contracts 2.0 with strict boundaries", async () => {
    const arch = repo.getArchitecture(createdProject.id)!;
    assert.ok(arch);

    // Test 3-developer decomposition
    const tasks = await ai.decomposeTasks(createdProject, arch, 3);
    assert.equal(tasks.length, 4);

    const feTask = tasks.find((t) => t.assignedRole === "frontend");
    const beTask = tasks.find((t) => t.assignedRole === "backend");
    const aiTask = tasks.find((t) => t.assignedRole === "ai_integration");

    assert.ok(feTask);
    assert.ok(beTask);
    assert.ok(aiTask);

    assert.equal(feTask.contractVersion, "2.0");
    assert.ok(feTask.allowedPaths.includes("web/src/features/"));
    assert.ok(feTask.protectedPaths.includes("server/"));

    assert.ok(beTask.allowedPaths.includes("server/api/"));
    assert.ok(beTask.protectedPaths.includes("web/src/"));

    repo.saveTasks(tasks);
    const saved = repo.listTasks(createdProject.id);
    assert.equal(saved.length, 4);
  });

  it("7. Agent Prompt Bridge: Generates tool-tailored prompt for Antigravity, Claude Code, and Codex", () => {
    const tasks = repo.listTasks(createdProject.id);
    const feTask = tasks[0];
    const arch = repo.getArchitecture(createdProject.id);
    const idea = repo.listIdeas(createdProject.id).find((i) => i.isSelected);

    const antigravityPrompt = promptBridge.generatePrompt("antigravity", createdProject, feTask, idea, arch);
    assert.ok(antigravityPrompt.includes("GOOGLE ANTIGRAVITY"));
    assert.ok(antigravityPrompt.includes("STRICT PATH BOUNDARIES"));
    assert.ok(antigravityPrompt.includes(feTask.taskId));

    const claudePrompt = promptBridge.generatePrompt("claude-code", createdProject, feTask, idea, arch);
    assert.ok(claudePrompt.includes("CLAUDE CODE"));

    const codexPrompt = promptBridge.generatePrompt("codex", createdProject, feTask, idea, arch);
    assert.ok(codexPrompt.includes("OPENAI CODEX"));
  });

  it("8. Task Execution: Claiming, progress reporting, and evidence submission", () => {
    const tasks = repo.listTasks(createdProject.id);
    const taskId = tasks[0].taskId;

    // Claim
    const lease = new Date(Date.now() + 3600000).toISOString();
    tasks[0].status = "assigned";
    tasks[0].owner = { memberName: "Developer Alpha", agentTool: "antigravity" };
    tasks[0].leaseExpiration = lease;
    repo.saveTasks([tasks[0]]);

    let current = repo.getTask(taskId)!;
    assert.equal(current.status, "assigned");
    assert.equal(current.owner?.agentTool, "antigravity");

    // Progress
    current = repo.updateTaskProgress(taskId, "in_progress", 50)!;
    assert.equal(current.status, "in_progress");
    assert.equal(current.progressPercent, 50);

    // Blocker simulation & recovery
    current = repo.updateTaskProgress(taskId, "blocked", 50, undefined, "Waiting for auth endpoint")!;
    assert.equal(current.status, "blocked");
    assert.equal(current.blockerReason, "Waiting for auth endpoint");

    // Submit with evidence
    const evidence = {
      branch: "feat/task-fe-01",
      prUrl: "https://github.com/DikshantDuggal/Upside-Down/pull/42",
      prNumber: 42,
      commitHash: "a1b2c3d",
      testsPassed: true,
      testOutput: "PASS 40 tests passed",
    };
    current = repo.updateTaskProgress(taskId, "in_review", 100, evidence)!;
    assert.equal(current.status, "in_review");
    assert.equal(current.progressPercent, 100);
    assert.equal(current.evidence?.prNumber, 42);

    // Approve
    current = repo.updateTaskProgress(taskId, "completed", 100)!;
    assert.equal(current.status, "completed");
  });

  it("9. Cross-Agent Handoffs: Structured dependency exchange between frontend and backend", () => {
    const handoff = repo.createHandoff({
      projectId: createdProject.id,
      sourceTaskId: "task-fe-01",
      sourceRole: "frontend",
      targetTaskId: "task-be-01",
      targetRole: "backend",
      status: "pending",
      requestSummary: "Need POST /api/hackathon/projects/:id/ideas/refine endpoint with feedback parameter.",
      contractDetails: { requiredBody: { feedback: "string" } },
    });

    assert.ok(handoff.id.startsWith("handoff-"));
    assert.equal(handoff.status, "pending");

    const list = repo.listHandoffs(createdProject.id);
    assert.equal(list.length, 1);

    repo.resolveHandoff(handoff.id, "resolved", "Endpoint implemented and verified with unit test.");
    const resolvedList = repo.listHandoffs(createdProject.id);
    assert.equal(resolvedList[0].status, "resolved");
    assert.ok(resolvedList[0].resolvedAt);
  });

  it("10. Integration & Collision Detection: Flags overlapping files and passes clean ones", () => {
    const tasks = repo.listTasks(createdProject.id);
    
    // Normal isolated tasks: no collision
    const check1 = integrationEngine.detectCollisions(tasks);
    assert.equal(check1.hasCollision, false);

    // Create a collision artificially
    const collidingTask: TaskContractV2 = {
      ...tasks[0],
      taskId: "task-collision-test",
      allowedPaths: ["web/src/features/", "server/api/"], // overlaps with both FE and BE
      status: "in_progress",
    };

    const check2 = integrationEngine.detectCollisions([...tasks, collidingTask]);
    assert.equal(check2.hasCollision, true);
    assert.ok(check2.collidingFiles.length > 0);
  });

  it("11. Release Gatekeeper & Host Approval: Host records local review without inventing deployment", () => {
    const tasks = repo.listTasks(createdProject.id);
    // Mark all tasks completed for clean release
    for (const t of tasks) {
      repo.updateTaskProgress(t.taskId, "completed", 100);
    }
    const completedTasks = repo.listTasks(createdProject.id);

    const evaluated = integrationEngine.evaluateRelease(createdProject.id, completedTasks);
    assert.equal(evaluated.contractCheck, "pending");
    assert.equal(evaluated.buildStatus, "pending");
    assert.equal(evaluated.testStatus, "pending");
    assert.equal(evaluated.prUrl, undefined);
    assert.equal(evaluated.releaseApproved, false);

    const approved = integrationEngine.approveAndDeploy(evaluated, "Dikshant Duggal");
    assert.equal(approved.releaseApproved, true);
    assert.equal(approved.releaseApprovedBy, "Dikshant Duggal");
    assert.equal(approved.deploymentStatus, "not_started");
    assert.equal(approved.deploymentUrl, undefined);

    repo.createOrUpdateRelease(approved);
    const stored = repo.getRelease(createdProject.id);
    assert.ok(stored);
    assert.equal(stored.deploymentStatus, "not_started");
  });
});
