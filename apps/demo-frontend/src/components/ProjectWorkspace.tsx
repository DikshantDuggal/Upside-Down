import React from "react";
import { IconFolder, IconCheck } from "./icons.tsx";
import type { Project, Task, AgentInfo } from "../services/api.ts";

interface ProjectWorkspaceProps {
  project: Project | null;
  tasks: Task[];
  agents: AgentInfo[];
}

export function ProjectWorkspace({ project, tasks, agents }: ProjectWorkspaceProps) {
  const completedCount = tasks.filter((t) => t.status === "done").length;
  const progressPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const contracts = [
    { name: "contracts/task.ts", version: "1.0.0", role: "Role 1", desc: "Canonical task schema, lifecycle state machine, and optimistic revision validation." },
    { name: "contracts/agent.ts", version: "1.1.0", role: "Role 2", desc: "Agent run request, subprocess execution timeouts, and patch review scoring contract." },
    { name: "contracts/events.ts", version: "1.0.0", role: "Role 1", desc: "Standard activity event payload schema for Server-Sent Events broadcasting." },
    { name: "contracts/sync.ts", version: "1.0.0", role: "Role 4", desc: "Offline outbox serialization, 3-way conflict record, and idempotency keys." },
    { name: "contracts/project.ts", version: "1.0.0", role: "Role 1", desc: "Multi-project metadata and boundary isolation contract." },
    { name: "contracts/handoff.ts", version: "1.0.0", role: "Role 1/3", desc: "Structured inter-agent dependency handoff specification and payload schemas." },
  ];

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconFolder className="w-5 h-5 text-indigo-400" />
          <span>Project Workspace & Architecture Contracts</span>
        </div>
      </div>

      {project && (
        <div style={{
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "10px",
          padding: "20px",
          marginBottom: "24px",
          boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#fff", marginBottom: "4px" }}>
                {project.name}
              </h2>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                {project.description || "Offline-First Multi-Agent Coding Collaboration Platform"}
              </div>
            </div>
            <span className="badge badge-emerald">ACTIVE WORKSPACE</span>
          </div>

          <div style={{ margin: "16px 0 8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "4px" }}>
              <span>Milestone Progress</span>
              <span>{completedCount} / {tasks.length} Tasks Completed ({progressPercent}%)</span>
            </div>
            <div style={{ height: "6px", backgroundColor: "#0b0f19", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${progressPercent}%`,
                background: "linear-gradient(90deg, #4f46e5, #06b6d4)",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Shared TypeScript Contracts */}
      <div className="section-title-bar" style={{ marginTop: "24px" }}>
        <div className="section-heading" style={{ fontSize: "1rem" }}>
          <span>Canonical TypeScript Architecture Contracts</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
        {contracts.map((c) => (
          <div key={c.name} style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "8px",
            padding: "16px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <code style={{ fontSize: "0.85rem", fontWeight: 700, color: "#818cf8" }}>{c.name}</code>
              <span className="badge badge-indigo">v{c.version}</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", marginBottom: "6px" }}>
              Owner: {c.role}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
              {c.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
