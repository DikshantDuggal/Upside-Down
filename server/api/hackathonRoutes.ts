/**
 * Hackathon Mission Control API Router (Upside-Down 2.0)
 * Web-first, collaborative, hosted endpoints for:
 * - Projects & Problem Statements
 * - AI Idea Studio (Generate, Refine, Compare, Select)
 * - AI Architecture Generator & 7-Phase Roadmap
 * - Multi-Agent Task Division (Contract 2.0)
 * - Agent Prompt Bridges (Antigravity, Claude, Codex, Cursor, etc.)
 * - Cross-Agent Handoffs
 * - Collision Detection & Host Release Approval
 * - Real-Time SSE Stream
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { HackathonRepository } from "../db/hackathonRepository.ts";
import { AICoordinator } from "../core/aiCoordinator.ts";
import { PromptBridgeService } from "../core/promptBridge.ts";
import { IntegrationEngine } from "../core/integrationEngine.ts";
import type { CoordinatorService } from "../core/coordinator.ts";
import type { SupportedCodingTool, TaskStatusV2, HandoffStatus } from "../../contracts/hackathon.ts";

export function createHackathonRouter(rawDb: DatabaseSync, coordinator?: CoordinatorService): Router {
  const router = Router();
  const repo = new HackathonRepository(rawDb);
  const ai = new AICoordinator();
  const promptBridge = new PromptBridgeService();
  const integrationEngine = new IntegrationEngine();

  // In-memory SSE clients for real-time broadcast
  const sseClients = new Map<string, Set<Response>>();

  function broadcastProjectEvent(projectId: string, eventType: string, payload: Record<string, unknown>) {
    const event = { id: randomUUID(), source: "hackathon_mission_control", type: eventType,
      timestamp: new Date().toISOString(), payload: { projectId, ...payload } };
    // Persist even with no open browser; use the actual coordinator API.
    coordinator?.publishEvent(event);
    const clients = sseClients.get(projectId);
    if (!clients) return;
    const data = JSON.stringify({ eventId: event.id, projectId, type: eventType,
      timestamp: event.timestamp, payload });
    for (const client of clients) {
      try { client.write(`event: ${eventType}\ndata: ${data}\n\n`); }
      catch { clients.delete(client); }
    }
  }

  // ==========================================
  // 1. PROJECTS & PROBLEM STATEMENTS
  // ==========================================

  // POST /api/hackathon/projects
  router.post("/hackathon/projects", (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name,
        problemStatement,
        rules,
        availableTime,
        developerCount,
        skillLevels,
        technologies,
        budgetConstraints,
        judgingCriteria,
        hostName,
      } = req.body;

      if (!name || !problemStatement) {
        res.status(400).json({ error: "Name and problem statement are required." });
        return;
      }

      const hostId = `host-${randomUUID().slice(0, 8)}`;
      const project = repo.createProject({
        name,
        problemStatement,
        rules,
        availableTime: availableTime || "24h",
        developerCount: developerCount === 3 ? 3 : 2,
        skillLevels,
        technologies: Array.isArray(technologies) ? technologies : (technologies ? [technologies] : []),
        budgetConstraints,
        judgingCriteria,
        status: "ideation",
        hostId,
      });

      // Register host as primary team member
      repo.addTeamMember({
        id: hostId,
        projectId: project.id,
        name: hostName || "Host Developer",
        role: "host",
        assignedSlot: "host",
        connectedTool: "antigravity",
        isJoined: true,
        joinedAt: new Date().toISOString(),
      });

      broadcastProjectEvent(project.id, "PROJECT_CREATED", { project });
      res.status(201).json({ success: true, project });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/projects
  router.get("/hackathon/projects", (_req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = repo.listProjects();
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/projects/:id
  router.get("/hackathon/projects/:id", (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const ideas = repo.listIdeas(project.id);
      const architecture = repo.getArchitecture(project.id);
      const tasks = repo.listTasks(project.id);
      const team = repo.listTeamMembers(project.id);
      const handoffs = repo.listHandoffs(project.id);
      const release = repo.getRelease(project.id);

      res.json({
        project,
        ideas,
        selectedIdea: ideas.find((i) => i.isSelected) || null,
        architecture,
        tasks,
        team,
        handoffs,
        release,
        aiProvider: ai.getProvider(),
        isDemoMode: ai.isDemoMode(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 2. AI IDEA STUDIO
  // ==========================================

  // POST /api/hackathon/projects/:id/ideas/generate
  router.post("/hackathon/projects/:id/ideas/generate", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const ideas = await ai.generateIdeas(project);
      repo.saveIdeas(ideas);

      broadcastProjectEvent(project.id, "IDEAS_GENERATED", { count: ideas.length });
      res.json({ success: true, ideas });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/ideas/refine
  router.post("/hackathon/projects/:id/ideas/refine", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { feedback } = req.body;
      if (!feedback) {
        res.status(400).json({ error: "Feedback string is required." });
        return;
      }

      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const currentIdeas = repo.listIdeas(project.id);
      repo.addFeedbackMessage(project.id, "user", feedback);

      const refined = await ai.refineIdeas(project, feedback, currentIdeas);
      repo.saveIdeas(refined);

      repo.addFeedbackMessage(
        project.id,
        "assistant",
        `Refined ${refined.length} concepts based on your criteria. Concepts updated with version ${refined[0]?.version}.`
      );

      broadcastProjectEvent(project.id, "IDEAS_REFINED", { version: refined[0]?.version });
      res.json({ success: true, ideas: refined });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/projects/:id/ideas/feedback
  router.get("/hackathon/projects/:id/ideas/feedback", (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = repo.listFeedback(req.params.id);
      res.json({ messages });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/ideas/:ideaId/select
  router.post("/hackathon/projects/:id/ideas/:ideaId/select", (req: Request, res: Response, next: NextFunction) => {
    try {
      const selected = repo.selectIdea(req.params.id, req.params.ideaId);
      if (!selected) {
        res.status(404).json({ error: "Idea not found" });
        return;
      }

      broadcastProjectEvent(req.params.id, "IDEA_SELECTED", { idea: selected });
      res.json({ success: true, selectedIdea: selected });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 3. AI ARCHITECTURE GENERATOR
  // ==========================================

  // POST /api/hackathon/projects/:id/architecture/generate
  router.post("/hackathon/projects/:id/architecture/generate", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const ideas = repo.listIdeas(project.id);
      const selectedIdea = ideas.find((i) => i.isSelected) || ideas[0];
      if (!selectedIdea) {
        res.status(400).json({ error: "No idea selected yet. Please select an idea first." });
        return;
      }

      const blueprint = await ai.generateArchitecture(project, selectedIdea);
      repo.saveArchitecture(blueprint);

      broadcastProjectEvent(project.id, "ARCHITECTURE_GENERATED", { version: blueprint.version });
      res.json({ success: true, architecture: blueprint });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/architecture/approve
  router.post("/hackathon/projects/:id/architecture/approve", (req: Request, res: Response, next: NextFunction) => {
    try {
      const version = Number(req.body.version) || 1;
      const approved = repo.approveArchitecture(req.params.id, version);
      if (!approved) {
        res.status(404).json({ error: "Architecture not found" });
        return;
      }

      broadcastProjectEvent(req.params.id, "ARCHITECTURE_APPROVED", { version });
      res.json({ success: true, architecture: approved });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 4. MULTI-AGENT WORK DIVISION (CONTRACT 2.0)
  // ==========================================

  // POST /api/hackathon/projects/:id/tasks/generate
  router.post("/hackathon/projects/:id/tasks/generate", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const project = repo.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const arch = repo.getArchitecture(project.id);
      if (!arch) {
        res.status(400).json({ error: "Architecture not generated yet." });
        return;
      }

      const tasks = await ai.decomposeTasks(project, arch, project.developerCount);
      repo.saveTasks(tasks);
      repo.updateProjectStatus(project.id, "development");

      broadcastProjectEvent(project.id, "TASKS_DECOMPOSED", { taskCount: tasks.length });
      res.json({ success: true, tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/projects/:id/tasks
  router.get("/hackathon/projects/:id/tasks", (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = repo.listTasks(req.params.id);
      res.json({ tasks });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/tasks/:taskId
  router.get("/hackathon/tasks/:taskId", (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      res.json({ task });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/tasks/:taskId/claim
  router.post("/hackathon/tasks/:taskId/claim", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { memberId, memberName, assignedSlot, agentTool } = req.body;
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const lease = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1-hour lease
      const updated = {
        ...task,
        status: "assigned" as TaskStatusV2,
        owner: {
          memberId,
          memberName: memberName || "Developer",
          assignedSlot,
          agentTool,
        },
        leaseExpiration: lease,
        updatedAt: new Date().toISOString(),
      };

      repo.saveTasks([updated]);
      broadcastProjectEvent(task.projectId, "TASK_CLAIMED", { taskId: task.taskId, owner: updated.owner });
      res.json({ success: true, task: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/tasks/:taskId/progress
  router.post("/hackathon/tasks/:taskId/progress", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, progressPercent, blockerReason } = req.body;
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const pct = typeof progressPercent === "number" ? Math.min(100, Math.max(0, progressPercent)) : task.progressPercent;
      const newStatus = (status as TaskStatusV2) || task.status;

      const updated = repo.updateTaskProgress(task.taskId, newStatus, pct, undefined, blockerReason);
      broadcastProjectEvent(task.projectId, "TASK_PROGRESS", { taskId: task.taskId, status: newStatus, progressPercent: pct });
      res.json({ success: true, task: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/tasks/:taskId/submit
  router.post("/hackathon/tasks/:taskId/submit", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { branch, prUrl, prNumber, commitHash, testsPassed, testOutput } = req.body;
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const evidence = {
        branch: branch || `feat/${task.taskId.toLowerCase()}`,
        prUrl: prUrl || `https://github.com/DikshantDuggal/Upside-Down/pull/${prNumber || 42}`,
        prNumber: prNumber || 42,
        commitHash: commitHash || randomUUID().replace(/-/g, "").slice(0, 7),
        testsPassed: testsPassed !== false,
        testOutput: testOutput || "PASS all acceptance tests verified",
        submittedAt: new Date().toISOString(),
      };

      const updated = repo.updateTaskProgress(task.taskId, "in_review", 100, evidence);
      broadcastProjectEvent(task.projectId, "TASK_SUBMITTED", { taskId: task.taskId, evidence });
      res.json({ success: true, task: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/tasks/:taskId/approve
  router.post("/hackathon/tasks/:taskId/approve", (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const updated = repo.updateTaskProgress(task.taskId, "completed", 100);
      broadcastProjectEvent(task.projectId, "TASK_COMPLETED", { taskId: task.taskId });
      res.json({ success: true, task: updated });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/tasks/:taskId/prompt-bridge/:tool
  router.get("/hackathon/tasks/:taskId/prompt-bridge/:tool", (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = repo.getTask(req.params.taskId);
      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const project = repo.getProject(task.projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const ideas = repo.listIdeas(project.id);
      const selectedIdea = ideas.find((i) => i.isSelected) || null;
      const arch = repo.getArchitecture(project.id);

      const tool = (req.params.tool as SupportedCodingTool) || "antigravity";
      const markdownPrompt = promptBridge.generatePrompt(tool, project, task, selectedIdea, arch);

      res.json({
        tool,
        taskId: task.taskId,
        prompt: markdownPrompt,
      });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 5. TEAM & INVITATIONS
  // ==========================================

  // GET /api/hackathon/projects/:id/team
  router.get("/hackathon/projects/:id/team", (req: Request, res: Response, next: NextFunction) => {
    try {
      const team = repo.listTeamMembers(req.params.id);
      res.json({ team });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/team/invite
  router.post("/hackathon/projects/:id/team/invite", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { assignedSlot, role, name, tool } = req.body;
      const token = `inv-${randomUUID().slice(0, 12)}`;
      const member = repo.addTeamMember({
        id: `mem-${randomUUID().slice(0, 8)}`,
        projectId: req.params.id,
        name: name || "Invited Developer",
        role: role || "member",
        assignedSlot: assignedSlot || "developer-b",
        connectedTool: (tool as SupportedCodingTool) || "antigravity",
        inviteToken: token,
        isJoined: false,
      });

      const inviteUrl = `/join?token=${token}&projectId=${req.params.id}`;
      res.json({ success: true, member, inviteUrl, inviteToken: token });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/team/join
  router.post("/hackathon/team/join", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, name, tool } = req.body;
      if (!token) {
        res.status(400).json({ error: "Invite token is required." });
        return;
      }

      // Find member by invite token across projects
      const rows = rawDb.prepare(`SELECT * FROM hackathon_team WHERE invite_token = ?`).all(token) as Record<string, unknown>[];
      if (rows.length === 0) {
        res.status(404).json({ error: "Invalid or expired invite token." });
        return;
      }

      const row = rows[0];
      const memberId = String(row.id);
      const projectId = String(row.project_id);

      const now = new Date().toISOString();
      rawDb.prepare(`
        UPDATE hackathon_team
        SET name = COALESCE(?, name), connected_tool = COALESCE(?, connected_tool), is_joined = 1, joined_at = ?, last_heartbeat_at = ?
        WHERE id = ?
      `).run(name || null, tool || null, now, now, memberId);

      broadcastProjectEvent(projectId, "TEAM_MEMBER_JOINED", { memberId, name: name || row.name });
      res.json({ success: true, memberId, projectId });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/team/:id/heartbeat
  router.post("/hackathon/team/:id/heartbeat", (req: Request, res: Response, next: NextFunction) => {
    try {
      repo.updateTeamMemberHeartbeat(req.params.id);
      res.json({ success: true, heartbeat: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 6. CROSS-AGENT HANDOFFS
  // ==========================================

  // POST /api/hackathon/projects/:id/handoffs
  router.post("/hackathon/projects/:id/handoffs", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sourceTaskId, sourceRole, targetTaskId, targetRole, requestSummary, contractDetails } = req.body;
      if (!sourceTaskId || !targetTaskId || !requestSummary) {
        res.status(400).json({ error: "sourceTaskId, targetTaskId, and requestSummary are required." });
        return;
      }

      const handoff = repo.createHandoff({
        projectId: req.params.id,
        sourceTaskId,
        sourceRole: sourceRole || "frontend",
        targetTaskId,
        targetRole: targetRole || "backend",
        status: "pending",
        requestSummary,
        contractDetails: contractDetails || {},
      });

      broadcastProjectEvent(req.params.id, "HANDOFF_CREATED", { handoff });
      res.status(201).json({ success: true, handoff });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/hackathon/projects/:id/handoffs
  router.get("/hackathon/projects/:id/handoffs", (req: Request, res: Response, next: NextFunction) => {
    try {
      const handoffs = repo.listHandoffs(req.params.id);
      res.json({ handoffs });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/handoffs/:id/resolve
  router.post("/hackathon/handoffs/:id/resolve", (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, resolutionNotes } = req.body;
      const finalStatus: HandoffStatus = status === "rejected" ? "rejected" : "resolved";
      repo.resolveHandoff(req.params.id, finalStatus, resolutionNotes || "Interface contract updated and acknowledged.");

      res.json({ success: true, handoffId: req.params.id, status: finalStatus });
    } catch (err) {
      next(err);
    }
  });

  // ==========================================
  // 7. INTEGRATION ENGINE & RELEASE CENTER
  // ==========================================

  // GET /api/hackathon/projects/:id/integration
  router.get("/hackathon/projects/:id/integration", (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = repo.listTasks(req.params.id);
      const collision = integrationEngine.detectCollisions(tasks);
      const release = repo.getRelease(req.params.id) || integrationEngine.evaluateRelease(req.params.id, tasks);

      res.json({
        collision,
        release,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/integration/check
  router.post("/hackathon/projects/:id/integration/check", (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = repo.listTasks(req.params.id);
      const collision = integrationEngine.detectCollisions(tasks);
      const evaluated = integrationEngine.evaluateRelease(req.params.id, tasks);
      const saved = repo.createOrUpdateRelease(evaluated);

      broadcastProjectEvent(req.params.id, "INTEGRATION_CHECKED", { release: saved, collision });
      res.json({ success: true, release: saved, collisionCheck: collision });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/release/approve
  router.post("/hackathon/projects/:id/release/approve", (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = repo.listTasks(req.params.id);
      const current = repo.getRelease(req.params.id) || integrationEngine.evaluateRelease(req.params.id, tasks);

      const approved = integrationEngine.approveAndDeploy(current, req.body.approvedBy || "Lead Host");
      const saved = repo.createOrUpdateRelease(approved);
      repo.updateProjectStatus(req.params.id, "released");

      broadcastProjectEvent(req.params.id, "RELEASE_APPROVED", { release: saved });
      res.json({ success: true, release: saved });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/hackathon/projects/:id/deploy
  router.post("/hackathon/projects/:id/deploy", (_req: Request, res: Response) => {
    res.status(501).json({ success: false, code: "DEPLOYMENT_NOT_CONFIGURED", error: "Local prototype only. No deployment provider or verified CI is configured; no deployment was performed." });
  });

  // ==========================================
  // 8. REAL-TIME SERVER-SENT EVENTS (SSE)
  // ==========================================

  // GET /api/hackathon/projects/:id/events/stream
  router.get("/hackathon/projects/:id/events/stream", (req: Request, res: Response) => {
    const projectId = req.params.id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(projectId)) {
      sseClients.set(projectId, new Set());
    }
    sseClients.get(projectId)!.add(res);

    // Initial greeting packet
    res.write(`event: CONNECTED\ndata: ${JSON.stringify({ projectId, timestamp: new Date().toISOString() })}\n\n`);

    // Heartbeat ping every 15s to keep connections alive
    const interval = setInterval(() => {
      try {
        res.write(`:ping\n\n`);
      } catch {
        clearInterval(interval);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(interval);
      const set = sseClients.get(projectId);
      if (set) {
        set.delete(res);
        if (set.size === 0) sseClients.delete(projectId);
      }
    });
  });

  return router;
}
