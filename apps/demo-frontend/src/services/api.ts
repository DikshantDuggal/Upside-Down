/**
 * Typed API Client for Upside-Down Backend
 * Consumes real REST endpoints & SSE stream
 */

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "assigned" | "running" | "review" | "done" | "blocked" | "failed";
  ownerId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: "idle" | "running" | "review" | "offline" | "blocked" | "error";
  runtimeAvailable: boolean;
  currentTaskId?: string;
  lastSeenAt: string;
}

export interface PatchRecord {
  id: string;
  taskId: string;
  runId: string;
  status: "pending" | "approved" | "rejected";
  diffContent: string;
  testOutput?: string;
  createdAt: string;
  reviewerId?: string;
  rejectionReason?: string;
}

export interface StructuredHandoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskId?: string;
  dependentTaskId?: string;
  handoffType: string;
  summary: string;
  contractVersion: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  taskId?: string;
  source: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SyncStatus {
  enabled: boolean;
  deviceId: string;
  isOnline: boolean;
  pendingOutboxCount: number;
  unresolvedConflictsCount: number;
}

export interface OutboxItem {
  id: string;
  eventId: string;
  destination: string;
  status: string;
  retryCount: number;
  createdAt: string;
}

export interface ConflictRecord {
  id: string;
  taskId: string;
  localRevision: number;
  incomingRevision: number;
  detectedAt: string;
  resolved: boolean;
  resolution?: string;
}

export interface FrontendStatus {
  activeFrontend: string;
  activeFrontendName: string;
  activeFrontendVersion: string;
  sourceDir: string;
  distDir: string;
  resolvedPublicDir: string;
  bundleExists: boolean;
  htmlExists: boolean;
  rollbackAvailable: boolean;
  previousFrontend: string | null;
  lastActivatedAt: string | null;
  lastActivationResult: string | null;
  availableFrontends: string[];
}

export class ApiClient {
  private static async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-UD-Contract": "UD-IC/1.0",
        ...(options?.headers || {}),
      },
    });

    if (!res.ok) {
      let errBody;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      throw new Error(errBody.message || `Request failed with status ${res.status}`);
    }

    return res.json();
  }

  // Health
  public static async getHealth() {
    return this.request<{ status: string; role: string; protocolVersion: string; activeSubscribers: number }>("/api/health");
  }

  // Projects
  public static async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("/api/projects");
  }

  public static async createProject(name: string, description?: string): Promise<Project> {
    return this.request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  }

  // Tasks
  public static async listTasks(): Promise<Task[]> {
    return this.request<Task[]>("/api/tasks");
  }

  public static async createTask(title: string, description?: string, ownerId?: string): Promise<Task> {
    return this.request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description, ownerId }),
    });
  }

  public static async transitionTask(
    taskId: string,
    targetStatus: Task["status"],
    baseRevision: number,
    ownerId?: string,
    reason?: string
  ): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}/transition`, {
      method: "POST",
      body: JSON.stringify({ targetStatus, baseRevision, ownerId, reason }),
    });
  }

  // Agents
  public static async listAgents(): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>("/api/agents");
  }

  public static async registerAgent(agent: Partial<AgentInfo> & { id: string; name: string }): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/agents/register", {
      method: "POST",
      body: JSON.stringify(agent),
    });
  }

  // Patches
  public static async getPatchForTask(taskId: string): Promise<PatchRecord | null> {
    try {
      return await this.request<PatchRecord>(`/api/tasks/${taskId}/patch`);
    } catch {
      return null;
    }
  }

  public static async approvePatch(patchId: string, reviewerId: string = "lead-engineer"): Promise<PatchRecord> {
    return this.request<PatchRecord>(`/api/patches/${patchId}/approve`, {
      method: "POST",
      body: JSON.stringify({ reviewerId }),
    });
  }

  public static async rejectPatch(patchId: string, reason: string = "Needs refinement"): Promise<PatchRecord> {
    return this.request<PatchRecord>(`/api/patches/${patchId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewerId: "lead-engineer", reason }),
    });
  }

  // Handoffs
  public static async listHandoffs(toAgent?: string, taskId?: string): Promise<StructuredHandoff[]> {
    const q = new URLSearchParams();
    if (toAgent) q.set("toAgent", toAgent);
    if (taskId) q.set("taskId", taskId);
    return this.request<StructuredHandoff[]>(`/api/handoffs?${q.toString()}`);
  }

  public static async createHandoff(handoff: {
    fromAgent: string;
    toAgent: string;
    taskId?: string;
    dependentTaskId?: string;
    handoffType?: string;
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<StructuredHandoff> {
    return this.request<StructuredHandoff>("/api/handoffs", {
      method: "POST",
      body: JSON.stringify(handoff),
    });
  }

  // Events
  public static async listEvents(limit: number = 50): Promise<ActivityEvent[]> {
    return this.request<ActivityEvent[]>(`/api/events?limit=${limit}`);
  }

  // Sync & Offline
  public static async getSyncStatus(): Promise<SyncStatus> {
    const health = await this.request<{deviceId:string;coordinatorReachable:boolean;pendingCount:number}>("/local/health");
    const conflicts = await this.getConflicts(false);
    return { enabled: true, deviceId: health.deviceId, isOnline: health.coordinatorReachable, pendingOutboxCount: health.pendingCount, unresolvedConflictsCount: conflicts.length };
  }

  public static async toggleOnline(online: boolean): Promise<{ status: string; isOnline: boolean }> {
    return this.request<{ status: string; isOnline: boolean }>("/api/sync/toggle-online", {
      method: "POST",
      body: JSON.stringify({ online }),
    });
  }

  public static async getOutbox(): Promise<OutboxItem[]> {
    const state = await this.request<{pending:{eventId:string;queuedAt:string;state:string;attempts:number}[]}>("/local/state");
    return state.pending.map(item => ({id:item.eventId,eventId:item.eventId,destination:"coordinator",status:item.state,retryCount:item.attempts,createdAt:item.queuedAt}));
  }

  public static async flushOutbox() {
    return this.request<{ flushed: number; remaining: number }>("/api/sync/flush", { method: "POST" });
  }

  public static async getConflicts(resolved: boolean = false): Promise<ConflictRecord[]> {
    const page = await this.request<{items:{id:string;taskId:string;currentRevision:number;baseRevision:number;detectedAt:string;status:string;resolution?:string}[]}>(`/api/sync/conflicts?status=${resolved ? "resolved" : "open"}`);
    return page.items.map(item => ({id:item.id,taskId:item.taskId,localRevision:item.currentRevision,incomingRevision:item.baseRevision,detectedAt:item.detectedAt,resolved:item.status==="resolved",resolution:item.resolution}));
  }

  public static async resolveConflict(conflictId: string, resolution: "accepted_incoming" | "kept_local") {
    return this.request(`/api/sync/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    });
  }

  // Frontend Handoff / Replacement Controller
  public static async getFrontendStatus(): Promise<FrontendStatus> {
    return this.request<FrontendStatus>("/api/frontend/status");
  }

  public static async activateTeamFrontend(candidatePath?: string) {
    return this.request<{ success: boolean; message: string; activeFrontend: string }>("/api/frontend/activate", {
      method: "POST",
      body: JSON.stringify({ candidatePath }),
    });
  }

  public static async rollbackFrontend() {
    return this.request<{ success: boolean; message: string; activeFrontend: string }>("/api/frontend/rollback", {
      method: "POST",
    });
  }
}
