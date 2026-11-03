import React, { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header.tsx";
import { CommandCenter } from "./components/CommandCenter.tsx";
import { AgentWorkspace } from "./components/AgentWorkspace.tsx";
import { TaskManagement } from "./components/TaskManagement.tsx";
import { CommunicationCenter } from "./components/CommunicationCenter.tsx";
import { ExecutionTimeline } from "./components/ExecutionTimeline.tsx";
import { ProjectWorkspace } from "./components/ProjectWorkspace.tsx";
import { SettingsDiagnostics } from "./components/SettingsDiagnostics.tsx";
import { PatchReviewModal } from "./components/PatchReviewModal.tsx";
import {
  IconCommand,
  IconCpu,
  IconKanban,
  IconMessageSquare,
  IconActivity,
  IconFolder,
  IconSettings,
} from "./components/icons.tsx";
import {
  ApiClient,
  type Project,
  type Task,
  type AgentInfo,
  type PatchRecord,
  type StructuredHandoff,
  type ActivityEvent,
  type SyncStatus,
  type OutboxItem,
  type ConflictRecord,
  type FrontendStatus,
} from "./services/api.ts";

export function App() {
  const [activeTab, setActiveTab] = useState<string>("command");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [handoffs, setHandoffs] = useState<StructuredHandoff[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [frontendStatus, setFrontendStatus] = useState<FrontendStatus | null>(null);
  const [selectedPatch, setSelectedPatch] = useState<PatchRecord | null>(null);
  const [activeReviewPatch, setActiveReviewPatch] = useState<PatchRecord | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);

  // Fetch all live data from backend
  const refreshAll = useCallback(async () => {
    try {
      const [
        tasksRes,
        agentsRes,
        eventsRes,
        syncRes,
        outboxRes,
        conflictsRes,
        projectsRes,
        handoffsRes,
        feStatusRes,
      ] = await Promise.all([
        ApiClient.listTasks().catch(() => []),
        ApiClient.listAgents().catch(() => []),
        ApiClient.listEvents(50).catch(() => []),
        ApiClient.getSyncStatus().catch(() => null),
        ApiClient.getOutbox().catch(() => []),
        ApiClient.getConflicts(false).catch(() => []),
        ApiClient.listProjects().catch(() => []),
        ApiClient.listHandoffs().catch(() => []),
        ApiClient.getFrontendStatus().catch(() => null),
      ]);

      setTasks(tasksRes);
      setAgents(agentsRes);
      setEvents(eventsRes);
      if (syncRes) setSyncStatus(syncRes);
      setOutbox(outboxRes);
      setConflicts(conflictsRes);
      setProjects(projectsRes);
      setHandoffs(handoffsRes);
      if (feStatusRes) setFrontendStatus(feStatusRes);

      // Check review task patches
      const reviewTasks = tasksRes.filter((t) => t.status === "review");
      if (reviewTasks.length > 0) {
        const patch = await ApiClient.getPatchForTask(reviewTasks[0].id);
        setSelectedPatch(patch);
      } else {
        setSelectedPatch(null);
      }
    } catch (err) {
      console.error("Failed to refresh application data:", err);
    }
  }, []);

  // Server-Sent Events setup
  useEffect(() => {
    refreshAll();

    const eventSource = new EventSource("/api/events/stream");

    eventSource.onopen = () => {
      setSseConnected(true);
    };

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type === "connected") return;
        setEvents((prev) => [parsed as ActivityEvent, ...prev.slice(0, 49)]);
        refreshAll();
      } catch (err) {
        console.error("SSE JSON parse error:", err);
      }
    };

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [refreshAll]);

  // Actions
  const handleToggleOnline = async () => {
    if (!syncStatus) return;
    try {
      await ApiClient.toggleOnline(!syncStatus.isOnline);
      refreshAll();
    } catch (err) {
      console.error("Failed to toggle online mode:", err);
    }
  };

  const handleRunDemo = async () => {
    setIsDemoRunning(true);
    try {
      // 1. Register agents
      await ApiClient.registerAgent({ id: "agent-backend-codex", name: "Backend Agent (Codex)", status: "running" });
      await ApiClient.registerAgent({ id: "agent-frontend-claude", name: "Frontend Agent (Claude)", status: "running" });

      // 2. Create tasks
      const taskA = await ApiClient.createTask(
        `Auth API & Token Session #${Date.now().toString().slice(-4)}`,
        "Deploy /api/auth/login and user session verification contract",
        "agent-backend-codex"
      );

      const taskB = await ApiClient.createTask(
        `Client Login Dialog & State #${Date.now().toString().slice(-4)}`,
        "Implement login modal and integrate with backend token contract",
        "agent-frontend-claude"
      );

      // 3. Acknowledge and start
      await ApiClient.transitionTask(taskA.id, "running", taskA.revision, "agent-backend-codex", "Agent A acknowledged task");
      await ApiClient.transitionTask(taskB.id, "assigned", taskB.revision, "agent-frontend-claude", "Agent B awaiting backend contract");

      // 4. Propose patch
      const patch = await fetch("/api/patches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskA.id,
          runId: `run-demo-${Date.now()}`,
          diffContent: "--- a/server/api/auth.ts\n+++ b/server/api/auth.ts\n@@ -0,0 +1,8 @@\n+export interface SessionToken {\n+  token: string;\n+  expiresAt: string;\n+}\n+\n+export const login = () => ({ token: 'jwt_secure_session_token' });",
          testOutput: "PASS: 4/4 auth unit tests passed in 38ms.",
        }),
      }).then((r) => r.json());

      // 5. Create handoff
      await ApiClient.createHandoff({
        fromAgent: "agent-backend-codex",
        toAgent: "agent-frontend-claude",
        taskId: taskA.id,
        dependentTaskId: taskB.id,
        handoffType: "task_completed",
        summary: "Auth API endpoints (/api/auth/login) deployed; frontend integration unblocked.",
        payload: { endpoint: "/api/auth/login", method: "POST", schemaVersion: "1.0.0" },
      });

      refreshAll();
      setSelectedPatch(patch);
      setActiveReviewPatch(patch);
    } catch (err) {
      console.error("Demo run error:", err);
    } finally {
      setIsDemoRunning(false);
    }
  };

  const handleTransitionTask = async (
    taskId: string,
    targetStatus: Task["status"],
    baseRevision: number,
    ownerId?: string,
    reason?: string
  ) => {
    try {
      await ApiClient.transitionTask(taskId, targetStatus, baseRevision, ownerId, reason);
      refreshAll();
    } catch (err) {
      alert(`Transition error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateTask = async (title: string, description?: string, ownerId?: string) => {
    await ApiClient.createTask(title, description, ownerId);
    refreshAll();
  };

  const handleApprovePatch = async (patchId: string) => {
    try {
      await ApiClient.approvePatch(patchId, "lead-engineer");
      setActiveReviewPatch(null);
      refreshAll();
    } catch (err) {
      alert(`Approval error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRejectPatch = async (patchId: string) => {
    try {
      await ApiClient.rejectPatch(patchId, "Needs revision per review");
      setActiveReviewPatch(null);
      refreshAll();
    } catch (err) {
      alert(`Rejection error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFlushOutbox = async () => {
    await ApiClient.flushOutbox();
    refreshAll();
  };

  const handleResolveConflict = async (conflictId: string, resolution: "accepted_incoming" | "kept_local") => {
    await ApiClient.resolveConflict(conflictId, resolution);
    refreshAll();
  };

  const handleActivateTeamFrontend = async (candidatePath?: string) => {
    const res = await ApiClient.activateTeamFrontend(candidatePath);
    refreshAll();
    if (!res.success) {
      throw new Error(res.message);
    }
  };

  const handleRollbackFrontend = async () => {
    const res = await ApiClient.rollbackFrontend();
    refreshAll();
    if (!res.success) {
      throw new Error(res.message);
    }
  };

  const activeProject = projects.length > 0 ? projects[0] : null;

  return (
    <div>
      {/* Top Navbar */}
      <Header
        syncStatus={syncStatus}
        sseConnected={sseConnected}
        project={activeProject}
        onToggleOnline={handleToggleOnline}
        onRunDemo={handleRunDemo}
        onRefresh={refreshAll}
        isDemoRunning={isDemoRunning}
      />

      {/* Tabs */}
      <nav className="tab-navigation">
        <button
          className={`tab-btn ${activeTab === "command" ? "active" : ""}`}
          onClick={() => setActiveTab("command")}
        >
          <IconCommand className="w-4 h-4" /> Command Center
        </button>

        <button
          className={`tab-btn ${activeTab === "agents" ? "active" : ""}`}
          onClick={() => setActiveTab("agents")}
        >
          <IconCpu className="w-4 h-4" /> Multi-Agent Workspace ({agents.length})
        </button>

        <button
          className={`tab-btn ${activeTab === "tasks" ? "active" : ""}`}
          onClick={() => setActiveTab("tasks")}
        >
          <IconKanban className="w-4 h-4" /> Kanban Tasks ({tasks.length})
        </button>

        <button
          className={`tab-btn ${activeTab === "comms" ? "active" : ""}`}
          onClick={() => setActiveTab("comms")}
        >
          <IconMessageSquare className="w-4 h-4" /> Handoffs & Comms ({handoffs.length})
        </button>

        <button
          className={`tab-btn ${activeTab === "timeline" ? "active" : ""}`}
          onClick={() => setActiveTab("timeline")}
        >
          <IconActivity className="w-4 h-4" /> Live Timeline ({events.length})
        </button>

        <button
          className={`tab-btn ${activeTab === "project" ? "active" : ""}`}
          onClick={() => setActiveTab("project")}
        >
          <IconFolder className="w-4 h-4" /> Project & Contracts
        </button>

        <button
          className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <IconSettings className="w-4 h-4" /> Settings & Replacement
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="main-container">
        {activeTab === "command" && (
          <CommandCenter
            tasks={tasks}
            agents={agents}
            syncStatus={syncStatus}
            selectedPatch={selectedPatch}
            conflicts={conflicts}
            onNavigateTab={setActiveTab}
            onCreateTaskModal={() => setActiveTab("tasks")}
            onRunDemo={handleRunDemo}
          />
        )}

        {activeTab === "agents" && (
          <AgentWorkspace agents={agents} onTriggerDemo={handleRunDemo} />
        )}

        {activeTab === "tasks" && (
          <TaskManagement
            tasks={tasks}
            agents={agents}
            onTransitionTask={handleTransitionTask}
            onCreateTask={handleCreateTask}
            onInspectPatch={async (taskId) => {
              const patch = await ApiClient.getPatchForTask(taskId);
              if (patch) setActiveReviewPatch(patch);
            }}
          />
        )}

        {activeTab === "comms" && (
          <CommunicationCenter
            handoffs={handoffs}
            events={events}
            onTriggerDemoHandoff={handleRunDemo}
          />
        )}

        {activeTab === "timeline" && (
          <ExecutionTimeline
            events={events}
            sseConnected={sseConnected}
            onRefresh={refreshAll}
          />
        )}

        {activeTab === "project" && (
          <ProjectWorkspace project={activeProject} tasks={tasks} agents={agents} />
        )}

        {activeTab === "settings" && (
          <SettingsDiagnostics
            frontendStatus={frontendStatus}
            syncStatus={syncStatus}
            outbox={outbox}
            conflicts={conflicts}
            onActivateTeamFrontend={handleActivateTeamFrontend}
            onRollbackFrontend={handleRollbackFrontend}
            onFlushOutbox={handleFlushOutbox}
            onResolveConflict={handleResolveConflict}
            onRefresh={refreshAll}
          />
        )}
      </main>

      {/* Review Modal */}
      {activeReviewPatch && (
        <PatchReviewModal
          patch={activeReviewPatch}
          onApprove={handleApprovePatch}
          onReject={handleRejectPatch}
          onClose={() => setActiveReviewPatch(null)}
        />
      )}
    </div>
  );
}
