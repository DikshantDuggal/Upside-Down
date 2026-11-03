import React from "react";
import { IconCpu, IconActivity, IconSparkles } from "./icons.tsx";
import type { AgentInfo } from "../services/api.ts";

interface AgentWorkspaceProps {
  agents: AgentInfo[];
  onTriggerDemo: () => void;
}

export function AgentWorkspace({ agents, onTriggerDemo }: AgentWorkspaceProps) {
  const getRoleDescription = (id: string) => {
    if (id.includes("coordinator")) return "Role 1 — Core Backend, Task Lifecycle & DB State Arbiter";
    if (id.includes("watcher")) return "Role 2 — Continuous Workspace File Watcher & Test Invalidator";
    if (id.includes("runner")) return "Role 2 — Test Runner Subprocess Worker with Timeout Guard";
    if (id.includes("repair")) return "Role 2 — Bounded Unified Diff Repair Engine & Fix Proposer";
    if (id.includes("sync")) return "Role 4 — Offline Outbox Manager & GitHub Board Adapter";
    if (id.includes("backend")) return "Role 1/2 — Autonomous Backend Coding Agent (Codex/Antigravity)";
    if (id.includes("frontend")) return "Role 3 — Autonomous Frontend Prototyping Agent (Claude Code)";
    return "Autonomous Specialist Agent";
  };

  const getStatusBadge = (status: AgentInfo["status"]) => {
    switch (status) {
      case "running":
        return <span className="badge badge-amber">● WORKING</span>;
      case "review":
        return <span className="badge badge-purple">● IN REVIEW</span>;
      case "blocked":
        return <span className="badge badge-rose">● BLOCKED</span>;
      case "idle":
        return <span className="badge badge-emerald">● IDLE (READY)</span>;
      default:
        return <span className="badge badge-gray">● {status.toUpperCase()}</span>;
    }
  };

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconCpu className="w-5 h-5 text-indigo-400" />
          <span>Collaborating AI Agents & Multi-Agent Workspace</span>
        </div>
        <button className="btn btn-primary" onClick={onTriggerDemo}>
          <IconSparkles className="w-4 h-4" /> Trigger Collaboration Flow
        </button>
      </div>

      <div style={{ marginBottom: "20px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        All four autonomous roles coordinate asynchronously via the shared message board and local coordinator state.
      </div>

      <div className="agent-grid">
        {agents.map((agent) => (
          <div key={agent.id} className="agent-card">
            <div className="agent-title">
              <span className="agent-name">{agent.name}</span>
              {getStatusBadge(agent.status)}
            </div>

            <div className="agent-role">{getRoleDescription(agent.id)}</div>

            <div className="agent-detail-row">
              <span>Agent ID:</span>
              <code>{agent.id}</code>
            </div>

            <div className="agent-detail-row">
              <span>Runtime Capability:</span>
              <span style={{ color: agent.runtimeAvailable ? "#34d399" : "#fb7185" }}>
                {agent.runtimeAvailable ? "Active Subprocess" : "Suspended"}
              </span>
            </div>

            <div className="agent-detail-row">
              <span>Current Task:</span>
              <code>{agent.currentTaskId ? agent.currentTaskId.slice(0, 8) + "..." : "None (Idle)"}</code>
            </div>

            <div className="agent-detail-row">
              <span>Last Heartbeat:</span>
              <span>{new Date(agent.lastSeenAt).toLocaleTimeString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Visual Communication Map */}
      <div style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "10px",
        padding: "20px",
        marginTop: "16px"
      }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#fff", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <IconActivity className="w-4 h-4 text-cyan-400" />
          <span>Multi-Agent Topology & Communication Channels</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
          <div style={{ padding: "10px 14px", backgroundColor: "#0b0f19", borderRadius: "8px", border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#818cf8" }}>@agent-coordinator</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>State Machine & Event Bus</div>
          </div>

          <span style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>&harr;</span>

          <div style={{ padding: "10px 14px", backgroundColor: "#0b0f19", borderRadius: "8px", border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#34d399" }}>@agent-watcher / @runner</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Execution & Test Watcher</div>
          </div>

          <span style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>&harr;</span>

          <div style={{ padding: "10px 14px", backgroundColor: "#0b0f19", borderRadius: "8px", border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#fbbf24" }}>@agent-repair</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Heuristic Patch Synthesis</div>
          </div>

          <span style={{ color: "var(--accent-cyan)", fontWeight: 700 }}>&harr;</span>

          <div style={{ padding: "10px 14px", backgroundColor: "#0b0f19", borderRadius: "8px", border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#c084fc" }}>@agent-sync</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Offline Outbox & GitHub Sync</div>
          </div>
        </div>
      </div>
    </div>
  );
}
