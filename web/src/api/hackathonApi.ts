/**
 * Upside-Down 2.0 Web API Client
 * Web-first HTTP & SSE client for Hackathon Mission Control
 */

export interface HackathonProject {
  id: string;
  name: string;
  problemStatement: string;
  rules?: string;
  availableTime: string;
  developerCount: 2 | 3;
  skillLevels?: string;
  technologies?: string[];
  budgetConstraints?: string;
  judgingCriteria?: string;
  status: "ideation" | "architecture" | "planning" | "development" | "integration" | "released" | "deployed";
  selectedIdeaId?: string;
  architectureVersion?: number;
  hostId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIdea {
  id: string;
  projectId: string;
  name: string;
  pitch: string;
  problem: string;
  targetUsers: string;
  usp: string;
  coreFeatures: string[];
  suggestedTech: string[];
  mvpDifficulty: "Easy" | "Medium" | "Hard";
  timeFeasibility: string;
  technicalRisks: string[];
  demoScenario: string;
  judgingAlignment: string;
  version: number;
  isSelected: boolean;
  createdAt: string;
}

export interface IdeaFeedbackMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  message: string;
  timestamp: string;
}

export interface ArchitectureBlueprint {
  id: string;
  projectId: string;
  version: number;
  isApproved: boolean;
  approvedAt?: string;
  spec: {
    objective: string;
    targetUsers: string[];
    userJourneys: string[];
    mvpFeatures: string[];
    optionalFeatures: string[];
    nonFunctionalReqs: string[];
    successCriteria: string[];
  };
  technical: {
    frontend: string;
    backend: string;
    database: string;
    auth: string;
    apis: string;
    aiProviders: string[];
    externalServices: string[];
    hosting: string;
    repoStructure: string[];
  };
  contracts: Array<{
    name: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    path: string;
    description: string;
  }>;
  roadmap: Array<{
    phase: number;
    title: string;
    description: string;
    estimatedHours: number;
    deliverables: string[];
  }>;
  createdAt: string;
}

export type SupportedCodingTool = "antigravity" | "claude-code" | "codex" | "cursor" | "aider" | "opencode" | "custom";

export interface TeamMember {
  id: string;
  projectId: string;
  name: string;
  email?: string;
  role: "host" | "member" | "viewer";
  assignedSlot: "developer-a" | "developer-b" | "developer-c" | "host";
  connectedTool: SupportedCodingTool;
  inviteToken?: string;
  isJoined: boolean;
  lastHeartbeatAt?: string;
  joinedAt?: string;
}

export interface TaskContractV2 {
  contractVersion: "2.0";
  taskId: string;
  projectId: string;
  title: string;
  assignedRole: "frontend" | "backend" | "ai_integration" | "fullstack";
  status: "backlog" | "ready" | "assigned" | "in_progress" | "blocked" | "in_review" | "completed";
  priority: "low" | "medium" | "high" | "critical";
  dependencies: string[];
  objective: string;
  allowedPaths: string[];
  protectedPaths: string[];
  inputs: Record<string, unknown>;
  deliverables: string[];
  acceptanceCriteria: string[];
  owner?: {
    memberId?: string;
    memberName?: string;
    assignedSlot?: string;
    agentTool?: string;
  };
  leaseExpiration?: string;
  progressPercent: number;
  evidence?: {
    branch?: string;
    prUrl?: string;
    prNumber?: number;
    commitHash?: string;
    testsPassed?: boolean;
    testOutput?: string;
    submittedAt?: string;
  };
  blockerReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrossAgentHandoff {
  id: string;
  projectId: string;
  sourceTaskId: string;
  sourceRole: string;
  targetTaskId: string;
  targetRole: string;
  status: "pending" | "acknowledged" | "resolved" | "rejected";
  requestSummary: string;
  contractDetails: Record<string, unknown>;
  resolutionNotes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface IntegrationReleaseRecord {
  id: string;
  projectId: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
  changedFiles: string[];
  collisionDetected: boolean;
  collisionFiles: string[];
  contractCheck: "passed" | "failed" | "pending";
  buildStatus: "passed" | "failed" | "pending";
  testStatus: "passed" | "failed" | "pending";
  releaseApproved: boolean;
  releaseApprovedBy?: string;
  deploymentStatus: "not_started" | "deploying" | "live" | "failed";
  deploymentUrl?: string;
  deploymentEvidence?: string;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = "/api/hackathon";

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Accept": "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}`;
    try {
      const data = await response.json();
      errorMsg = data.error || data.message || errorMsg;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

export const hackathonApi = {
  // Projects
  async createProject(data: {
    name: string;
    problemStatement: string;
    rules?: string;
    availableTime?: string;
    developerCount?: 2 | 3;
    skillLevels?: string;
    technologies?: string[];
    budgetConstraints?: string;
    judgingCriteria?: string;
    hostName?: string;
  }): Promise<{ success: boolean; project: HackathonProject }> {
    return fetchJson(`${API_BASE}/projects`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async listProjects(): Promise<{ projects: HackathonProject[] }> {
    return fetchJson(`${API_BASE}/projects`);
  },

  async getProject(projectId: string): Promise<{
    project: HackathonProject;
    ideas: ProjectIdea[];
    selectedIdea: ProjectIdea | null;
    architecture: ArchitectureBlueprint | null;
    tasks: TaskContractV2[];
    team: TeamMember[];
    handoffs: CrossAgentHandoff[];
    release: IntegrationReleaseRecord | null;
    aiProvider: string;
    isDemoMode: boolean;
  }> {
    return fetchJson(`${API_BASE}/projects/${projectId}`);
  },

  // Ideas
  async generateIdeas(projectId: string): Promise<{ success: boolean; ideas: ProjectIdea[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/ideas/generate`, { method: "POST" });
  },

  async refineIdeas(projectId: string, feedback: string): Promise<{ success: boolean; ideas: ProjectIdea[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/ideas/refine`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    });
  },

  async getIdeaFeedback(projectId: string): Promise<{ messages: IdeaFeedbackMessage[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/ideas/feedback`);
  },

  async selectIdea(projectId: string, ideaId: string): Promise<{ success: boolean; selectedIdea: ProjectIdea }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/ideas/${ideaId}/select`, { method: "POST" });
  },

  // Architecture
  async generateArchitecture(projectId: string): Promise<{ success: boolean; architecture: ArchitectureBlueprint }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/architecture/generate`, { method: "POST" });
  },

  async approveArchitecture(projectId: string, version: number): Promise<{ success: boolean; architecture: ArchitectureBlueprint }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/architecture/approve`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  },

  // Tasks
  async startMission(projectId: string): Promise<{ success: boolean; project: HackathonProject; tasks: TaskContractV2[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/start-mission`, { method: "POST" });
  },

  async generateTasks(projectId: string): Promise<{ success: boolean; tasks: TaskContractV2[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/tasks/generate`, { method: "POST" });
  },

  async listTasks(projectId: string): Promise<{ tasks: TaskContractV2[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/tasks`);
  },

  async getTask(taskId: string): Promise<{ task: TaskContractV2 }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}`);
  },

  async claimTask(taskId: string, data: { memberName: string; agentTool: string; assignedSlot?: string }): Promise<{ success: boolean; task: TaskContractV2 }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}/claim`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateTaskProgress(taskId: string, data: { status: string; progressPercent: number; blockerReason?: string }): Promise<{ success: boolean; task: TaskContractV2 }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}/progress`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async submitTaskEvidence(taskId: string, evidence: { branch?: string; prNumber?: number; prUrl?: string; commitHash?: string; testsPassed?: boolean; testOutput?: string }): Promise<{ success: boolean; task: TaskContractV2 }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify(evidence),
    });
  },

  async approveTask(taskId: string): Promise<{ success: boolean; task: TaskContractV2 }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}/approve`, { method: "POST" });
  },

  async getPromptBridge(taskId: string, tool: string): Promise<{ tool: string; taskId: string; prompt: string }> {
    return fetchJson(`${API_BASE}/tasks/${taskId}/prompt-bridge/${tool}`);
  },

  // Team
  async listTeam(projectId: string): Promise<{ team: TeamMember[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/team`);
  },

  async inviteTeamMember(projectId: string, data: { role?: string; assignedSlot?: string; name?: string; tool?: string }): Promise<{ success: boolean; member: TeamMember; inviteUrl: string; inviteToken: string }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/team/invite`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async joinTeam(data: { token: string; name?: string; tool?: string }): Promise<{ success: boolean; memberId: string; projectId: string }> {
    return fetchJson(`${API_BASE}/team/join`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Handoffs
  async listHandoffs(projectId: string): Promise<{ handoffs: CrossAgentHandoff[] }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/handoffs`);
  },

  async createHandoff(projectId: string, data: { sourceTaskId: string; sourceRole?: string; targetTaskId: string; targetRole?: string; requestSummary: string; contractDetails?: Record<string, unknown> }): Promise<{ success: boolean; handoff: CrossAgentHandoff }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/handoffs`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async resolveHandoff(handoffId: string, status: "resolved" | "rejected", resolutionNotes?: string): Promise<{ success: boolean; handoffId: string; status: string }> {
    return fetchJson(`${API_BASE}/handoffs/${handoffId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, resolutionNotes }),
    });
  },

  // Integration & Release
  async checkIntegration(projectId: string): Promise<{ success: boolean; release: IntegrationReleaseRecord; collisionCheck?: any }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/integration/check`, { method: "POST" });
  },

  async approveRelease(projectId: string, approvedBy?: string): Promise<{ success: boolean; release: IntegrationReleaseRecord }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/release/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy }),
    });
  },

  async deployRelease(projectId: string): Promise<{ success: boolean; release: IntegrationReleaseRecord }> {
    return fetchJson(`${API_BASE}/projects/${projectId}/deploy`, { method: "POST" });
  },

  // GitHub Webhook Simulator
  async handleGithubWebhook(payload: Record<string, unknown>): Promise<{ success: boolean; processed: boolean; taskId?: string; status?: string }> {
    return fetchJson(`${API_BASE}/github/webhook`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Real-time Event Subscription (SSE)
  subscribeEvents(projectId: string, onEvent: (event: { type: string; payload: any }) => void): () => void {
    const sse = new EventSource(`${API_BASE}/projects/${projectId}/events/stream`);

    const handleMessage = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        onEvent({ type: e.type, payload: parsed.payload });
      } catch {
        // ignore raw pings
      }
    };

    sse.addEventListener("PROJECT_CREATED", handleMessage as any);
    sse.addEventListener("IDEAS_GENERATED", handleMessage as any);
    sse.addEventListener("IDEAS_REFINED", handleMessage as any);
    sse.addEventListener("IDEA_SELECTED", handleMessage as any);
    sse.addEventListener("ARCHITECTURE_GENERATED", handleMessage as any);
    sse.addEventListener("ARCHITECTURE_APPROVED", handleMessage as any);
    sse.addEventListener("MISSION_STARTED", handleMessage as any);
    sse.addEventListener("TASKS_DECOMPOSED", handleMessage as any);
    sse.addEventListener("TASK_CLAIMED", handleMessage as any);
    sse.addEventListener("TASK_PROGRESS", handleMessage as any);
    sse.addEventListener("TASK_SUBMITTED", handleMessage as any);
    sse.addEventListener("TASK_COMPLETED", handleMessage as any);
    sse.addEventListener("TEAM_MEMBER_JOINED", handleMessage as any);
    sse.addEventListener("HANDOFF_CREATED", handleMessage as any);
    sse.addEventListener("HANDOFF_RESOLVED", handleMessage as any);
    sse.addEventListener("INTEGRATION_CHECKED", handleMessage as any);
    sse.addEventListener("RELEASE_APPROVED", handleMessage as any);
    sse.addEventListener("DEPLOYMENT_FINISHED", handleMessage as any);

    return () => {
      sse.close();
    };
  },
};
