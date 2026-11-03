import React from "react";
import { IconCpu, IconKanban, IconActivity, IconSparkles, IconCheck, IconAlertTriangle } from "./icons.tsx";
import type { Task, AgentInfo, SyncStatus, PatchRecord, ConflictRecord } from "../services/api.ts";

interface CommandCenterProps {
  tasks: Task[];
  agents: AgentInfo[];
  syncStatus: SyncStatus | null;
  selectedPatch: PatchRecord | null;
  conflicts: ConflictRecord[];
  onNavigateTab: (tab: string) => void;
  onCreateTaskModal: () => void;
  onRunDemo: () => void;
}

export function CommandCenter({
  tasks,
  agents,
  syncStatus,
  selectedPatch,
  conflicts,
  onNavigateTab,
  onCreateTaskModal,
  onRunDemo,
}: CommandCenterProps) {
  const pendingTasks = tasks.filter((t) => t.status === "pending").length;
  const inProgressTasks = tasks.filter((t) => t.status === "running" || t.status === "assigned").length;
  const reviewTasks = tasks.filter((t) => t.status === "review").length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;
  const activeAgents = agents.filter((a) => a.status === "running" || a.status === "idle").length;

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconCpu className="w-5 h-5 text-indigo-400" />
          <span>Mission Command Center</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn-primary" onClick={onRunDemo}>
            <IconSparkles className="w-4 h-4" /> 🚀 Run 2-Agent Demo
          </button>
          <button className="btn" onClick={onCreateTaskModal}>
            + Create Task
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="stat-grid">
        <div className="stat-card" onClick={() => onNavigateTab("agents")} style={{ cursor: "pointer" }}>
          <div className="stat-label">
            <span>ACTIVE AGENTS</span>
            <span className="badge badge-indigo">{activeAgents} Online</span>
          </div>
          <div className="stat-value">{agents.length}</div>
          <div className="stat-footer">Role 1-4 autonomous specialists</div>
        </div>

        <div className="stat-card" onClick={() => onNavigateTab("tasks")} style={{ cursor: "pointer" }}>
          <div className="stat-label">
            <span>IN-PROGRESS TASKS</span>
            <span className="badge badge-amber">{inProgressTasks} Active</span>
          </div>
          <div className="stat-value">{inProgressTasks}</div>
          <div className="stat-footer">{pendingTasks} in backlog queue</div>
        </div>

        <div className="stat-card" onClick={() => onNavigateTab("tasks")} style={{ cursor: "pointer" }}>
          <div className="stat-label">
            <span>APPROVALS NEEDED</span>
            <span className={`badge ${reviewTasks > 0 ? "badge-rose" : "badge-gray"}`}>
              {reviewTasks} Pending
            </span>
          </div>
          <div className="stat-value" style={{ color: reviewTasks > 0 ? "#fb7185" : "#fff" }}>
            {reviewTasks}
          </div>
          <div className="stat-footer">Human-in-the-loop patch reviews</div>
        </div>

        <div className="stat-card" onClick={() => onNavigateTab("tasks")} style={{ cursor: "pointer" }}>
          <div className="stat-label">
            <span>COMPLETED TASKS</span>
            <span className="badge badge-emerald">Done</span>
          </div>
          <div className="stat-value" style={{ color: "#34d399" }}>{completedTasks}</div>
          <div className="stat-footer">{tasks.length} total tasks managed</div>
        </div>

        <div className="stat-card" onClick={() => onNavigateTab("settings")} style={{ cursor: "pointer" }}>
          <div className="stat-label">
            <span>OFFLINE RESILIENCE</span>
            <span className={`badge ${syncStatus?.isOnline ? "badge-emerald" : "badge-amber"}`}>
              {syncStatus?.isOnline ? "Online" : "Offline"}
            </span>
          </div>
          <div className="stat-value">{syncStatus?.pendingOutboxCount || 0}</div>
          <div className="stat-footer">Durable outbox events queued</div>
        </div>
      </div>

      {/* Review Alert Banner */}
      {selectedPatch && (
        <div style={{
          backgroundColor: "rgba(245, 158, 11, 0.08)",
          border: "1px solid rgba(245, 158, 11, 0.3)",
          borderRadius: "10px",
          padding: "16px 20px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: "4px" }}>
              ⚡ Code Patch Awaiting Human Verification & Approval
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Task ID: <code>{selectedPatch.taskId}</code> | Proposed by run: <code>{selectedPatch.runId}</code>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => onNavigateTab("tasks")}>
            Review & Approve Unified Diff &rarr;
          </button>
        </div>
      )}

      {/* Conflict Alert Banner */}
      {conflicts.length > 0 && (
        <div style={{
          backgroundColor: "rgba(244, 63, 94, 0.08)",
          border: "1px solid rgba(244, 63, 94, 0.3)",
          borderRadius: "10px",
          padding: "16px 20px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontWeight: 700, color: "#fb7185", marginBottom: "4px" }}>
              ⚠ {conflicts.length} Concurrent Device / Branch Revision Conflict(s) Detected
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Changes held in safe staging. Silent overwriting blocked. Human resolution required.
            </div>
          </div>
          <button className="btn btn-danger" onClick={() => onNavigateTab("settings")}>
            Inspect & Resolve Conflicts &rarr;
          </button>
        </div>
      )}
    </div>
  );
}
