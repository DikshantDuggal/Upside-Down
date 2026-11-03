import React, { useState } from "react";
import { IconKanban, IconArrowRight, IconSparkles } from "./icons.tsx";
import type { Task, AgentInfo } from "../services/api.ts";

interface TaskManagementProps {
  tasks: Task[];
  agents: AgentInfo[];
  onTransitionTask: (taskId: string, targetStatus: Task["status"], baseRevision: number, ownerId?: string, reason?: string) => Promise<void>;
  onCreateTask: (title: string, description?: string, ownerId?: string) => Promise<void>;
  onInspectPatch: (taskId: string) => void;
}

export function TaskManagement({
  tasks,
  agents,
  onTransitionTask,
  onCreateTask,
  onInspectPatch,
}: TaskManagementProps) {
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newOwner, setNewOwner] = useState(agents[0]?.id || "agent-runner");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const columns: { key: Task["status"]; label: string; badgeColor: string }[] = [
    { key: "pending", label: "Backlog", badgeColor: "badge-gray" },
    { key: "assigned", label: "Assigned", badgeColor: "badge-blue" },
    { key: "running", label: "In Progress", badgeColor: "badge-amber" },
    { key: "review", label: "Review", badgeColor: "badge-purple" },
    { key: "done", label: "Completed", badgeColor: "badge-emerald" },
  ];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setIsSubmitting(true);
    try {
      await onCreateTask(newTitle.trim(), newDesc.trim() || undefined, newOwner);
      setNewTitle("");
      setNewDesc("");
      setShowModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getNextStatus = (current: Task["status"]): Task["status"] | null => {
    switch (current) {
      case "pending": return "assigned";
      case "assigned": return "running";
      case "running": return "review";
      case "review": return "done";
      default: return null;
    }
  };

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconKanban className="w-5 h-5 text-indigo-400" />
          <span>Collaboration Kanban Board</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + Create Task
        </button>
      </div>

      <div className="kanban-grid">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="kanban-column">
              <div className="column-header">
                <span>{col.label}</span>
                <span className={`badge ${col.badgeColor}`}>{colTasks.length}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                {colTasks.map((task) => {
                  const nextStatus = getNextStatus(task.status);
                  return (
                    <div key={task.id} className="task-card">
                      <div className="task-title">{task.title}</div>
                      {task.description && <div className="task-desc">{task.description}</div>}

                      <div className="task-meta">
                        <span>@{task.ownerId || "Unassigned"}</span>
                        <span>Rev: v{task.revision}</span>
                      </div>

                      <div style={{ marginTop: "10px", display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        {task.status === "review" && (
                          <button
                            className="btn btn-primary"
                            style={{ padding: "4px 8px", fontSize: "0.72rem" }}
                            onClick={() => onInspectPatch(task.id)}
                          >
                            Review Diff &rarr;
                          </button>
                        )}

                        {nextStatus && task.status !== "review" && (
                          <button
                            className="btn"
                            style={{ padding: "4px 8px", fontSize: "0.72rem" }}
                            onClick={() => onTransitionTask(task.id, nextStatus, task.revision, task.ownerId, `Promoted to ${nextStatus}`)}
                          >
                            <span>Move to {nextStatus}</span>
                            <IconArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.75rem", fontStyle: "italic" }}>
                    No tasks in {col.label}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dialog */}
      {showModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "12px",
            padding: "24px",
            width: "100%",
            maxWidth: "480px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
          }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "16px", color: "#fff" }}>
              Create Collaboration Task
            </h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Task Title:
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Fix schema validation regression in Auth"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: "#0b0f19",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Description:
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Detailed requirements or failure diagnostic trace..."
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: "#0b0f19",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Assign to Agent:
                </label>
                <select
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    backgroundColor: "#0b0f19",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "0.85rem",
                  }}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.id})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
