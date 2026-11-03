/**
 * Upside-Down 2.0 — Hackathon Mission Control Contracts
 * Canonical Schema for Web-First AI Hackathon Collaboration
 */

export type ProjectStatus =
  | "ideation"
  | "architecture"
  | "planning"
  | "development"
  | "integration"
  | "released"
  | "deployed";

export interface HackathonProject {
  id: string;
  name: string;
  problemStatement: string;
  rules?: string;
  availableTime: string; // e.g. "24h", "48h"
  developerCount: 2 | 3;
  skillLevels?: string;
  technologies?: string[];
  budgetConstraints?: string;
  judgingCriteria?: string;
  status: ProjectStatus;
  selectedIdeaId?: string;
  architectureVersion?: number;
  hostId: string;
  createdAt: string;
  updatedAt: string;
}

export type MvpDifficulty = "Easy" | "Medium" | "Hard";

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
  mvpDifficulty: MvpDifficulty;
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

export interface ApiContractDefinition {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
}

export interface RoadmapPhase {
  phase: number;
  title: string;
  description: string;
  estimatedHours: number;
  deliverables: string[];
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
  contracts: ApiContractDefinition[];
  roadmap: RoadmapPhase[];
  createdAt: string;
}

export type TeamRole = "host" | "member" | "viewer";
export type SupportedCodingTool =
  | "antigravity"
  | "claude-code"
  | "codex"
  | "cursor"
  | "aider"
  | "opencode"
  | "custom";

export interface TeamMember {
  id: string;
  projectId: string;
  name: string;
  email?: string;
  role: TeamRole;
  assignedSlot: "developer-a" | "developer-b" | "developer-c" | "host";
  connectedTool: SupportedCodingTool;
  inviteToken?: string;
  isJoined: boolean;
  lastHeartbeatAt?: string;
  joinedAt?: string;
}

export type TaskStatusV2 =
  | "backlog"
  | "ready"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "completed";

export type TaskPriority = "low" | "medium" | "high" | "critical";
export type AssignedWorkRole = "frontend" | "backend" | "ai_integration" | "fullstack";

export interface TaskEvidence {
  branch?: string;
  prUrl?: string;
  prNumber?: number;
  commitHash?: string;
  testsPassed?: boolean;
  testOutput?: string;
  artifactUrl?: string;
  submittedAt?: string;
}

export interface TaskContractV2 {
  contractVersion: "2.0";
  taskId: string;
  projectId: string;
  title: string;
  assignedRole: AssignedWorkRole;
  status: TaskStatusV2;
  priority: TaskPriority;
  dependencies: string[]; // dependent taskIds
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
    agentTool?: SupportedCodingTool;
  };
  leaseExpiration?: string;
  progressPercent: number; // 0 - 100
  evidence?: TaskEvidence;
  blockerReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type HandoffStatus = "pending" | "acknowledged" | "resolved" | "rejected";

export interface CrossAgentHandoff {
  id: string;
  projectId: string;
  sourceTaskId: string;
  sourceRole: AssignedWorkRole;
  targetTaskId: string;
  targetRole: AssignedWorkRole;
  status: HandoffStatus;
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
