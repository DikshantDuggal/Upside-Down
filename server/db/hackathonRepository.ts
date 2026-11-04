/**
 * Hackathon Repository (Upside-Down 2.0)
 * Centralized, persistent storage for Hackathon Mission Control
 * Backed by native node:sqlite DatabaseSync
 */

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  HackathonProject,
  ProjectIdea,
  IdeaFeedbackMessage,
  ArchitectureBlueprint,
  TeamMember,
  TaskContractV2,
  CrossAgentHandoff,
  IntegrationReleaseRecord,
  ProjectStatus,
  TaskStatusV2,
  HandoffStatus,
} from "../../contracts/hackathon.ts";

export class HackathonRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hackathon_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        problem_statement TEXT NOT NULL,
        rules TEXT,
        available_time TEXT NOT NULL,
        developer_count INTEGER NOT NULL,
        skill_levels TEXT,
        technologies_json TEXT,
        budget_constraints TEXT,
        judging_criteria TEXT,
        status TEXT NOT NULL,
        selected_idea_id TEXT,
        architecture_version INTEGER,
        host_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hackathon_ideas (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        pitch TEXT NOT NULL,
        problem TEXT NOT NULL,
        target_users TEXT NOT NULL,
        usp TEXT NOT NULL,
        core_features_json TEXT NOT NULL,
        suggested_tech_json TEXT NOT NULL,
        mvp_difficulty TEXT NOT NULL,
        time_feasibility TEXT NOT NULL,
        technical_risks_json TEXT NOT NULL,
        demo_scenario TEXT NOT NULL,
        judging_alignment TEXT NOT NULL,
        version INTEGER NOT NULL,
        is_selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_feedback (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_architecture (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        is_approved INTEGER NOT NULL DEFAULT 0,
        approved_at TEXT,
        spec_json TEXT NOT NULL,
        technical_json TEXT NOT NULL,
        contracts_json TEXT NOT NULL,
        roadmap_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_team (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL,
        assigned_slot TEXT NOT NULL,
        connected_tool TEXT NOT NULL,
        invite_token TEXT,
        is_joined INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT,
        joined_at TEXT,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        assigned_role TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        objective TEXT NOT NULL,
        allowed_paths_json TEXT NOT NULL,
        protected_paths_json TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        deliverables_json TEXT NOT NULL,
        acceptance_criteria_json TEXT NOT NULL,
        owner_json TEXT,
        lease_expiration TEXT,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        evidence_json TEXT,
        blocker_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_handoffs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        source_role TEXT NOT NULL,
        target_task_id TEXT NOT NULL,
        target_role TEXT NOT NULL,
        status TEXT NOT NULL,
        request_summary TEXT NOT NULL,
        contract_details_json TEXT NOT NULL,
        resolution_notes TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS hackathon_releases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        pr_number INTEGER,
        pr_url TEXT,
        changed_files_json TEXT NOT NULL,
        collision_detected INTEGER NOT NULL DEFAULT 0,
        collision_files_json TEXT NOT NULL,
        contract_check TEXT NOT NULL,
        build_status TEXT NOT NULL,
        test_status TEXT NOT NULL,
        release_approved INTEGER NOT NULL DEFAULT 0,
        release_approved_by TEXT,
        deployment_status TEXT NOT NULL,
        deployment_url TEXT,
        deployment_evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES hackathon_projects(id) ON DELETE CASCADE
      );
    `);
  }

  // --- PROJECTS ---
  public createProject(project: Omit<HackathonProject, "id" | "createdAt" | "updatedAt"> & { id?: string }): HackathonProject {
    const id = project.id || `proj-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const fullProject: HackathonProject = {
      ...project,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO hackathon_projects (
        id, name, problem_statement, rules, available_time, developer_count,
        skill_levels, technologies_json, budget_constraints, judging_criteria,
        status, selected_idea_id, architecture_version, host_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullProject.id,
      fullProject.name,
      fullProject.problemStatement,
      fullProject.rules || null,
      fullProject.availableTime,
      fullProject.developerCount,
      fullProject.skillLevels || null,
      JSON.stringify(fullProject.technologies || []),
      fullProject.budgetConstraints || null,
      fullProject.judgingCriteria || null,
      fullProject.status,
      fullProject.selectedIdeaId || null,
      fullProject.architectureVersion || null,
      fullProject.hostId,
      fullProject.createdAt,
      fullProject.updatedAt
    );

    return fullProject;
  }

  public getProject(id: string): HackathonProject | null {
    const stmt = this.db.prepare(`SELECT * FROM hackathon_projects WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: String(row.id),
      name: String(row.name),
      problemStatement: String(row.problem_statement),
      rules: row.rules ? String(row.rules) : undefined,
      availableTime: String(row.available_time),
      developerCount: Number(row.developer_count) as 2 | 3,
      skillLevels: row.skill_levels ? String(row.skill_levels) : undefined,
      technologies: JSON.parse(String(row.technologies_json || "[]")),
      budgetConstraints: row.budget_constraints ? String(row.budget_constraints) : undefined,
      judgingCriteria: row.judging_criteria ? String(row.judging_criteria) : undefined,
      status: String(row.status) as ProjectStatus,
      selectedIdeaId: row.selected_idea_id ? String(row.selected_idea_id) : undefined,
      architectureVersion: row.architecture_version ? Number(row.architecture_version) : undefined,
      hostId: String(row.host_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public listProjects(): HackathonProject[] {
    const stmt = this.db.prepare(`SELECT * FROM hackathon_projects ORDER BY updated_at DESC`);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      problemStatement: String(row.problem_statement),
      rules: row.rules ? String(row.rules) : undefined,
      availableTime: String(row.available_time),
      developerCount: Number(row.developer_count) as 2 | 3,
      skillLevels: row.skill_levels ? String(row.skill_levels) : undefined,
      technologies: JSON.parse(String(row.technologies_json || "[]")),
      budgetConstraints: row.budget_constraints ? String(row.budget_constraints) : undefined,
      judgingCriteria: row.judging_criteria ? String(row.judging_criteria) : undefined,
      status: String(row.status) as ProjectStatus,
      selectedIdeaId: row.selected_idea_id ? String(row.selected_idea_id) : undefined,
      architectureVersion: row.architecture_version ? Number(row.architecture_version) : undefined,
      hostId: String(row.host_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  public updateProjectStatus(id: string, status: ProjectStatus, selectedIdeaId?: string, archVersion?: number): void {
    const now = new Date().toISOString();
    let sql = `UPDATE hackathon_projects SET status = ?, updated_at = ?`;
    const params: (string | number | null)[] = [status, now];

    if (selectedIdeaId !== undefined) {
      sql += `, selected_idea_id = ?`;
      params.push(selectedIdeaId);
    }
    if (archVersion !== undefined) {
      sql += `, architecture_version = ?`;
      params.push(archVersion);
    }

    sql += ` WHERE id = ?`;
    params.push(id);

    this.db.prepare(sql).run(...params);
  }

  // --- IDEAS ---
  public saveIdeas(ideas: ProjectIdea[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO hackathon_ideas (
        id, project_id, name, pitch, problem, target_users, usp,
        core_features_json, suggested_tech_json, mvp_difficulty,
        time_feasibility, technical_risks_json, demo_scenario,
        judging_alignment, version, is_selected, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const idea of ideas) {
      stmt.run(
        idea.id,
        idea.projectId,
        idea.name,
        idea.pitch,
        idea.problem,
        idea.targetUsers,
        idea.usp,
        JSON.stringify(idea.coreFeatures),
        JSON.stringify(idea.suggestedTech),
        idea.mvpDifficulty,
        idea.timeFeasibility,
        JSON.stringify(idea.technicalRisks),
        idea.demoScenario,
        idea.judgingAlignment,
        idea.version,
        idea.isSelected ? 1 : 0,
        idea.createdAt
      );
    }
  }

  public listIdeas(projectId: string): ProjectIdea[] {
    const stmt = this.db.prepare(`SELECT * FROM hackathon_ideas WHERE project_id = ? ORDER BY version DESC, id ASC`);
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      pitch: String(row.pitch),
      problem: String(row.problem),
      targetUsers: String(row.target_users),
      usp: String(row.usp),
      coreFeatures: JSON.parse(String(row.core_features_json || "[]")),
      suggestedTech: JSON.parse(String(row.suggested_tech_json || "[]")),
      mvpDifficulty: String(row.mvp_difficulty) as ProjectIdea["mvpDifficulty"],
      timeFeasibility: String(row.time_feasibility),
      technicalRisks: JSON.parse(String(row.technical_risks_json || "[]")),
      demoScenario: String(row.demo_scenario),
      judgingAlignment: String(row.judging_alignment),
      version: Number(row.version),
      isSelected: Number(row.is_selected) === 1,
      createdAt: String(row.created_at),
    }));
  }

  public selectIdea(projectId: string, ideaId: string): ProjectIdea | null {
    this.db.prepare(`UPDATE hackathon_ideas SET is_selected = 0 WHERE project_id = ?`).run(projectId);
    this.db.prepare(`UPDATE hackathon_ideas SET is_selected = 1 WHERE id = ? AND project_id = ?`).run(ideaId, projectId);
    this.updateProjectStatus(projectId, "architecture", ideaId);

    const stmt = this.db.prepare(`SELECT * FROM hackathon_ideas WHERE id = ?`);
    const row = stmt.get(ideaId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      pitch: String(row.pitch),
      problem: String(row.problem),
      targetUsers: String(row.target_users),
      usp: String(row.usp),
      coreFeatures: JSON.parse(String(row.core_features_json || "[]")),
      suggestedTech: JSON.parse(String(row.suggested_tech_json || "[]")),
      mvpDifficulty: String(row.mvp_difficulty) as ProjectIdea["mvpDifficulty"],
      timeFeasibility: String(row.time_feasibility),
      technicalRisks: JSON.parse(String(row.technical_risks_json || "[]")),
      demoScenario: String(row.demo_scenario),
      judgingAlignment: String(row.judging_alignment),
      version: Number(row.version),
      isSelected: true,
      createdAt: String(row.created_at),
    };
  }

  // --- FEEDBACK CHAT ---
  public addFeedbackMessage(projectId: string, role: "user" | "assistant", message: string): IdeaFeedbackMessage {
    const feedback: IdeaFeedbackMessage = {
      id: `fb-${randomUUID().slice(0, 8)}`,
      projectId,
      role,
      message,
      timestamp: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO hackathon_feedback (id, project_id, role, message, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(feedback.id, feedback.projectId, feedback.role, feedback.message, feedback.timestamp);

    return feedback;
  }

  public listFeedback(projectId: string): IdeaFeedbackMessage[] {
    const stmt = this.db.prepare(`SELECT * FROM hackathon_feedback WHERE project_id = ? ORDER BY timestamp ASC`);
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      role: String(r.role) as "user" | "assistant",
      message: String(r.message),
      timestamp: String(r.timestamp),
    }));
  }

  // --- ARCHITECTURE ---
  public saveArchitecture(blueprint: ArchitectureBlueprint): void {
    this.db.prepare(`
      INSERT INTO hackathon_architecture (
        id, project_id, version, is_approved, approved_at,
        spec_json, technical_json, contracts_json, roadmap_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      blueprint.id,
      blueprint.projectId,
      blueprint.version,
      blueprint.isApproved ? 1 : 0,
      blueprint.approvedAt || null,
      JSON.stringify(blueprint.spec),
      JSON.stringify(blueprint.technical),
      JSON.stringify(blueprint.contracts),
      JSON.stringify(blueprint.roadmap),
      blueprint.createdAt
    );
  }

  public getArchitecture(projectId: string, version?: number): ArchitectureBlueprint | null {
    let sql = `SELECT * FROM hackathon_architecture WHERE project_id = ?`;
    const params: (string | number)[] = [projectId];
    if (version !== undefined) {
      sql += ` AND version = ?`;
      params.push(version);
    } else {
      sql += ` ORDER BY version DESC LIMIT 1`;
    }

    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      version: Number(row.version),
      isApproved: Number(row.is_approved) === 1,
      approvedAt: row.approved_at ? String(row.approved_at) : undefined,
      spec: JSON.parse(String(row.spec_json || "{}")),
      technical: JSON.parse(String(row.technical_json || "{}")),
      contracts: JSON.parse(String(row.contracts_json || "[]")),
      roadmap: JSON.parse(String(row.roadmap_json || "[]")),
      createdAt: String(row.created_at),
    };
  }

  public approveArchitecture(projectId: string, version: number): ArchitectureBlueprint | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE hackathon_architecture
      SET is_approved = 1, approved_at = ?
      WHERE project_id = ? AND version = ?
    `).run(now, projectId, version);

    this.updateProjectStatus(projectId, "planning", undefined, version);
    return this.getArchitecture(projectId, version);
  }

  // --- TEAM MEMBERS ---
  public addTeamMember(member: TeamMember): TeamMember {
    this.db.prepare(`
      INSERT INTO hackathon_team (
        id, project_id, name, email, role, assigned_slot, connected_tool,
        invite_token, is_joined, last_heartbeat_at, joined_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      member.id,
      member.projectId,
      member.name,
      member.email || null,
      member.role,
      member.assignedSlot,
      member.connectedTool,
      member.inviteToken || null,
      member.isJoined ? 1 : 0,
      member.lastHeartbeatAt || null,
      member.joinedAt || null
    );
    return member;
  }

  public listTeamMembers(projectId: string): TeamMember[] {
    const rows = this.db.prepare(`SELECT * FROM hackathon_team WHERE project_id = ? ORDER BY id ASC`).all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      email: r.email ? String(r.email) : undefined,
      role: String(r.role) as TeamMember["role"],
      assignedSlot: String(r.assigned_slot) as TeamMember["assignedSlot"],
      connectedTool: String(r.connected_tool) as TeamMember["connectedTool"],
      inviteToken: r.invite_token ? String(r.invite_token) : undefined,
      isJoined: Number(r.is_joined) === 1,
      lastHeartbeatAt: r.last_heartbeat_at ? String(r.last_heartbeat_at) : undefined,
      joinedAt: r.joined_at ? String(r.joined_at) : undefined,
    }));
  }

  public updateTeamMemberHeartbeat(memberId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE hackathon_team SET last_heartbeat_at = ? WHERE id = ?`).run(now, memberId);
  }

  // --- TASKS (CONTRACT 2.0) ---
  public saveTasks(tasks: TaskContractV2[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO hackathon_tasks (
        id, project_id, title, assigned_role, status, priority, dependencies_json,
        objective, allowed_paths_json, protected_paths_json, inputs_json,
        deliverables_json, acceptance_criteria_json, owner_json, lease_expiration,
        progress_percent, evidence_json, blocker_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        assigned_role = excluded.assigned_role,
        status = excluded.status,
        priority = excluded.priority,
        dependencies_json = excluded.dependencies_json,
        objective = excluded.objective,
        allowed_paths_json = excluded.allowed_paths_json,
        protected_paths_json = excluded.protected_paths_json,
        inputs_json = excluded.inputs_json,
        deliverables_json = excluded.deliverables_json,
        acceptance_criteria_json = excluded.acceptance_criteria_json,
        owner_json = excluded.owner_json,
        lease_expiration = excluded.lease_expiration,
        progress_percent = excluded.progress_percent,
        evidence_json = excluded.evidence_json,
        blocker_reason = excluded.blocker_reason,
        updated_at = excluded.updated_at
    `);

    for (const t of tasks) {
      stmt.run(
        t.taskId,
        t.projectId,
        t.title,
        t.assignedRole,
        t.status,
        t.priority,
        JSON.stringify(t.dependencies),
        t.objective,
        JSON.stringify(t.allowedPaths),
        JSON.stringify(t.protectedPaths),
        JSON.stringify(t.inputs),
        JSON.stringify(t.deliverables),
        JSON.stringify(t.acceptanceCriteria),
        t.owner ? JSON.stringify(t.owner) : null,
        t.leaseExpiration || null,
        t.progressPercent || 0,
        t.evidence ? JSON.stringify(t.evidence) : null,
        t.blockerReason || null,
        t.createdAt,
        t.updatedAt
      );
    }
  }

  public getTask(taskId: string): TaskContractV2 | null {
    const r = this.db.prepare(`SELECT * FROM hackathon_tasks WHERE id = ?`).get(taskId) as Record<string, unknown> | undefined;
    if (!r) return null;

    return {
      contractVersion: "2.0",
      taskId: String(r.id),
      projectId: String(r.project_id),
      title: String(r.title),
      assignedRole: String(r.assigned_role) as TaskContractV2["assignedRole"],
      status: String(r.status) as TaskStatusV2,
      priority: String(r.priority) as TaskContractV2["priority"],
      dependencies: JSON.parse(String(r.dependencies_json || "[]")),
      objective: String(r.objective),
      allowedPaths: JSON.parse(String(r.allowed_paths_json || "[]")),
      protectedPaths: JSON.parse(String(r.protected_paths_json || "[]")),
      inputs: JSON.parse(String(r.inputs_json || "{}")),
      deliverables: JSON.parse(String(r.deliverables_json || "[]")),
      acceptanceCriteria: JSON.parse(String(r.acceptance_criteria_json || "[]")),
      owner: r.owner_json ? JSON.parse(String(r.owner_json)) : undefined,
      leaseExpiration: r.lease_expiration ? String(r.lease_expiration) : undefined,
      progressPercent: Number(r.progress_percent || 0),
      evidence: r.evidence_json ? JSON.parse(String(r.evidence_json)) : undefined,
      blockerReason: r.blocker_reason ? String(r.blocker_reason) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  public listTasks(projectId: string): TaskContractV2[] {
    const rows = this.db.prepare(`SELECT * FROM hackathon_tasks WHERE project_id = ? ORDER BY created_at ASC`).all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      contractVersion: "2.0",
      taskId: String(r.id),
      projectId: String(r.project_id),
      title: String(r.title),
      assignedRole: String(r.assigned_role) as TaskContractV2["assignedRole"],
      status: String(r.status) as TaskStatusV2,
      priority: String(r.priority) as TaskContractV2["priority"],
      dependencies: JSON.parse(String(r.dependencies_json || "[]")),
      objective: String(r.objective),
      allowedPaths: JSON.parse(String(r.allowed_paths_json || "[]")),
      protectedPaths: JSON.parse(String(r.protected_paths_json || "[]")),
      inputs: JSON.parse(String(r.inputs_json || "{}")),
      deliverables: JSON.parse(String(r.deliverables_json || "[]")),
      acceptanceCriteria: JSON.parse(String(r.acceptance_criteria_json || "[]")),
      owner: r.owner_json ? JSON.parse(String(r.owner_json)) : undefined,
      leaseExpiration: r.lease_expiration ? String(r.lease_expiration) : undefined,
      progressPercent: Number(r.progress_percent || 0),
      evidence: r.evidence_json ? JSON.parse(String(r.evidence_json)) : undefined,
      blockerReason: r.blocker_reason ? String(r.blocker_reason) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  public updateTaskProgress(
    taskId: string,
    status: TaskStatusV2,
    progressPercent: number,
    evidence?: TaskContractV2["evidence"],
    blockerReason?: string
  ): TaskContractV2 | null {
    const now = new Date().toISOString();
    let sql = `UPDATE hackathon_tasks SET status = ?, progress_percent = ?, updated_at = ?`;
    const params: (string | number | null)[] = [status, progressPercent, now];

    if (evidence !== undefined) {
      sql += `, evidence_json = ?`;
      params.push(JSON.stringify(evidence));
    }
    if (blockerReason !== undefined) {
      sql += `, blocker_reason = ?`;
      params.push(blockerReason);
    }

    sql += ` WHERE id = ?`;
    params.push(taskId);

    this.db.prepare(sql).run(...params);
    return this.getTask(taskId);
  }

  // --- CROSS-AGENT HANDOFFS ---
  public createHandoff(handoff: Omit<CrossAgentHandoff, "id" | "createdAt">): CrossAgentHandoff {
    const full: CrossAgentHandoff = {
      ...handoff,
      id: `handoff-${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO hackathon_handoffs (
        id, project_id, source_task_id, source_role, target_task_id, target_role,
        status, request_summary, contract_details_json, resolution_notes, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.projectId,
      full.sourceTaskId,
      full.sourceRole,
      full.targetTaskId,
      full.targetRole,
      full.status,
      full.requestSummary,
      JSON.stringify(full.contractDetails),
      full.resolutionNotes || null,
      full.createdAt,
      full.resolvedAt || null
    );

    return full;
  }

  public listHandoffs(projectId: string): CrossAgentHandoff[] {
    const rows = this.db.prepare(`SELECT * FROM hackathon_handoffs WHERE project_id = ? ORDER BY created_at DESC`).all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      sourceTaskId: String(r.source_task_id),
      sourceRole: String(r.source_role) as CrossAgentHandoff["sourceRole"],
      targetTaskId: String(r.target_task_id),
      targetRole: String(r.target_role) as CrossAgentHandoff["targetRole"],
      status: String(r.status) as HandoffStatus,
      requestSummary: String(r.request_summary),
      contractDetails: JSON.parse(String(r.contract_details_json || "{}")),
      resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : undefined,
      createdAt: String(r.created_at),
      resolvedAt: r.resolved_at ? String(r.resolved_at) : undefined,
    }));
  }

  public getHandoff(handoffId: string): CrossAgentHandoff | null {
    const rows = this.db.prepare(`SELECT * FROM hackathon_handoffs WHERE id = ?`).all(handoffId) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      sourceTaskId: String(r.source_task_id),
      sourceRole: String(r.source_role) as CrossAgentHandoff["sourceRole"],
      targetTaskId: String(r.target_task_id),
      targetRole: String(r.target_role) as CrossAgentHandoff["targetRole"],
      status: String(r.status) as HandoffStatus,
      requestSummary: String(r.request_summary),
      contractDetails: JSON.parse(String(r.contract_details_json || "{}")),
      resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : undefined,
      createdAt: String(r.created_at),
      resolvedAt: r.resolved_at ? String(r.resolved_at) : undefined,
    };
  }

  public resolveHandoff(handoffId: string, status: HandoffStatus, resolutionNotes: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE hackathon_handoffs
      SET status = ?, resolution_notes = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, resolutionNotes, now, handoffId);
  }

  // --- INTEGRATION RELEASES ---
  public createOrUpdateRelease(release: Omit<IntegrationReleaseRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): IntegrationReleaseRecord {
    const id = release.id || `rel-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const full: IntegrationReleaseRecord = {
      ...release,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO hackathon_releases (
        id, project_id, branch, pr_number, pr_url, changed_files_json,
        collision_detected, collision_files_json, contract_check, build_status,
        test_status, release_approved, release_approved_by, deployment_status,
        deployment_url, deployment_evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        branch = excluded.branch,
        pr_number = excluded.pr_number,
        pr_url = excluded.pr_url,
        changed_files_json = excluded.changed_files_json,
        collision_detected = excluded.collision_detected,
        collision_files_json = excluded.collision_files_json,
        contract_check = excluded.contract_check,
        build_status = excluded.build_status,
        test_status = excluded.test_status,
        release_approved = excluded.release_approved,
        release_approved_by = excluded.release_approved_by,
        deployment_status = excluded.deployment_status,
        deployment_url = excluded.deployment_url,
        deployment_evidence = excluded.deployment_evidence,
        updated_at = excluded.updated_at
    `).run(
      full.id,
      full.projectId,
      full.branch,
      full.prNumber || null,
      full.prUrl || null,
      JSON.stringify(full.changedFiles),
      full.collisionDetected ? 1 : 0,
      JSON.stringify(full.collisionFiles),
      full.contractCheck,
      full.buildStatus,
      full.testStatus,
      full.releaseApproved ? 1 : 0,
      full.releaseApprovedBy || null,
      full.deploymentStatus,
      full.deploymentUrl || null,
      full.deploymentEvidence || null,
      full.createdAt,
      full.updatedAt
    );

    return full;
  }

  public getRelease(projectId: string): IntegrationReleaseRecord | null {
    const r = this.db.prepare(`SELECT * FROM hackathon_releases WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1`).get(projectId) as Record<string, unknown> | undefined;
    if (!r) return null;

    return {
      id: String(r.id),
      projectId: String(r.project_id),
      branch: String(r.branch),
      prNumber: r.pr_number ? Number(r.pr_number) : undefined,
      prUrl: r.pr_url ? String(r.pr_url) : undefined,
      changedFiles: JSON.parse(String(r.changed_files_json || "[]")),
      collisionDetected: Number(r.collision_detected) === 1,
      collisionFiles: JSON.parse(String(r.collision_files_json || "[]")),
      contractCheck: String(r.contract_check) as IntegrationReleaseRecord["contractCheck"],
      buildStatus: String(r.build_status) as IntegrationReleaseRecord["buildStatus"],
      testStatus: String(r.test_status) as IntegrationReleaseRecord["testStatus"],
      releaseApproved: Number(r.release_approved) === 1,
      releaseApprovedBy: r.release_approved_by ? String(r.release_approved_by) : undefined,
      deploymentStatus: String(r.deployment_status) as IntegrationReleaseRecord["deploymentStatus"],
      deploymentUrl: r.deployment_url ? String(r.deployment_url) : undefined,
      deploymentEvidence: r.deployment_evidence ? String(r.deployment_evidence) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }
}
