import { useState, useEffect } from "react";
import {
  Clock,
  Plus,
  ArrowRight,
} from "lucide-react";
import type { HackathonProject, ProjectIdea, ArchitectureBlueprint, TaskContractV2, IntegrationReleaseRecord } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface ProjectOverviewProps {
  project: HackathonProject | null;
  selectedIdea: ProjectIdea | null;
  architecture: ArchitectureBlueprint | null;
  tasks: TaskContractV2[];
  release: IntegrationReleaseRecord | null;
  onCreateProject: (data: {
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
  }) => Promise<void>;
  onNavigateTab: (tab: any) => void;
}

export function ProjectOverview({
  project,
  selectedIdea,
  architecture,
  tasks,
  release,
  onCreateProject,
  onNavigateTab,
}: ProjectOverviewProps) {
  const [newProjectModal, setNewProjectModal] = useState(false);
  const [countdown, setCountdown] = useState("23h 54m 12s");
  const [form, setForm] = useState({
    name: "Autonomous Hackathon Mission Control",
    problemStatement: "Hackathon teams struggle with uncoordinated multi-agent coding assistants, leading to merge conflicts and lost time.",
    rules: "24-Hour MVP. Open Source Stack.",
    availableTime: "24h",
    developerCount: 3 as 2 | 3,
    skillLevels: "Senior AI Developers",
    technologies: "React 19, TypeScript, Express, SQLite",
    budgetConstraints: "Zero budget / free tier only",
    judgingCriteria: "Multi-agent coordination, real-world utility, polish",
    hostName: "Dikshant Duggal",
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const sec = 59 - now.getSeconds();
      const min = 59 - now.getMinutes();
      setCountdown(`23h ${min.toString().padStart(2, "0")}m ${sec.toString().padStart(2, "0")}s`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onCreateProject({
      ...form,
      technologies: form.technologies.split(",").map((s) => s.trim()),
    });
    setNewProjectModal(false);
  }

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const progressPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="tab-pane">
      {/* Hero Mission Control Banner */}
      <div
        className="panel"
        style={{
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.05) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.2)",
          marginBottom: "1.5rem",
          padding: "1.5rem",
        }}
      >
        <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.25rem" }}>
              <Badge tone="violet">UPSIDE-DOWN 2.0</Badge>
              <Badge tone="green">Web-First Hosted</Badge>
              {project && <Badge tone="violet">{project.status.toUpperCase()}</Badge>}
            </div>
            <h1 style={{ margin: "0.5rem 0", fontSize: "1.75rem" }}>
              {project ? project.name : "AI Hackathon Mission Control"}
            </h1>
            <p className="muted" style={{ maxWidth: "680px", margin: "0 0 0.5rem 0" }}>
              {project ? project.problemStatement : "Autonomous multi-agent orchestration taking your team from hackathon problem statement to verified deployment."}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--bg-card, #ffffff)", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border-color, #e5e7eb)", fontSize: "0.9rem", fontWeight: 600 }}>
              <Clock size={16} color="#3b82f6" />
              <span>{countdown} remaining</span>
            </div>
            <button className="button primary small" onClick={() => setNewProjectModal(true)}>
              <Plus size={14} />
              New Project
            </button>
          </div>
        </div>

        {/* Milestone Steps */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginTop: "1.5rem", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "1rem" }}>
          <div
            onClick={() => onNavigateTab("ideas")}
            style={{ cursor: "pointer", padding: "0.5rem", borderRadius: "6px", background: selectedIdea ? "rgba(16, 185, 129, 0.1)" : "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e5e7eb)" }}
          >
            <span className="small muted">Step 1</span>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Idea Studio {selectedIdea && "✓"}</p>
          </div>
          <div
            onClick={() => onNavigateTab("architecture")}
            style={{ cursor: "pointer", padding: "0.5rem", borderRadius: "6px", background: architecture?.isApproved ? "rgba(16, 185, 129, 0.1)" : "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e5e7eb)" }}
          >
            <span className="small muted">Step 2</span>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Architecture {architecture?.isApproved && "✓"}</p>
          </div>
          <div
            onClick={() => onNavigateTab("tasks")}
            style={{ cursor: "pointer", padding: "0.5rem", borderRadius: "6px", background: tasks.length > 0 ? "rgba(59, 130, 246, 0.1)" : "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e5e7eb)" }}
          >
            <span className="small muted">Step 3</span>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Work Contracts ({tasks.length})</p>
          </div>
          <div
            onClick={() => onNavigateTab("team")}
            style={{ cursor: "pointer", padding: "0.5rem", borderRadius: "6px", background: "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e5e7eb)" }}
          >
            <span className="small muted">Step 4</span>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Team Hub ({project?.developerCount || 3} Devs)</p>
          </div>
          <div
            onClick={() => onNavigateTab("integration")}
            style={{ cursor: "pointer", padding: "0.5rem", borderRadius: "6px", background: release?.deploymentStatus === "live" ? "rgba(16, 185, 129, 0.1)" : "var(--bg-card, #ffffff)", border: "1px solid var(--border-color, #e5e7eb)" }}
          >
            <span className="small muted">Step 5</span>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.85rem" }}>Release & Deploy {release?.deploymentStatus === "live" && "✓"}</p>
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div className="panel" style={{ padding: "1rem" }}>
          <span className="small muted">Task Progress</span>
          <h2 style={{ margin: "0.25rem 0" }}>{progressPercent}%</h2>
          <span className="small muted">{completedCount} of {tasks.length} contracts completed</span>
        </div>

        <div className="panel" style={{ padding: "1rem" }}>
          <span className="small muted">Active Developers</span>
          <h2 style={{ margin: "0.25rem 0" }}>{project?.developerCount || 3} Agents</h2>
          <span className="small muted">Mixed Tools (Antigravity, Claude, Codex)</span>
        </div>

        <div className="panel" style={{ padding: "1rem" }}>
          <span className="small muted">Collision Engine</span>
          <h2 style={{ margin: "0.25rem 0", color: release?.collisionDetected ? "#ef4444" : "#10b981" }}>
            {release?.collisionDetected ? "Collision" : "0 Collisions"}
          </h2>
          <span className="small muted">Path boundaries strictly isolated</span>
        </div>

        <div className="panel" style={{ padding: "1rem" }}>
          <span className="small muted">Deployment Readiness</span>
          <h2 style={{ margin: "0.25rem 0", color: release?.deploymentStatus === "live" ? "#10b981" : "#3b82f6" }}>
            {release?.deploymentStatus === "live" ? "Live in Prod" : "Verified Ready"}
          </h2>
          <span className="small muted">{release?.deploymentUrl ? "Vercel / Cloud Live" : "Pending Host Approval"}</span>
        </div>
      </div>

      {/* Selected Idea Highlight */}
      {selectedIdea && (
        <div className="panel" style={{ marginBottom: "1.5rem" }}>
          <div className="row-between">
            <div>
              <span className="small muted">ACTIVE PROJECT CONCEPT</span>
              <h3 style={{ margin: "0.25rem 0" }}>{selectedIdea.name}</h3>
              <p style={{ margin: 0 }}>{selectedIdea.pitch}</p>
            </div>
            <button className="button secondary small" onClick={() => onNavigateTab("ideas")}>
              Review Concepts <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      {newProjectModal && (
        <div className="modal-backdrop" onClick={() => setNewProjectModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px" }}>
            <h3>Create New Hackathon Project</h3>
            <p className="small muted">
              Enter your hackathon problem statement and constraints to start the AI ideation process.
            </p>

            <form onSubmit={handleCreateSubmit} className="form-stack" style={{ marginTop: "1rem" }}>
              <label>
                Project Name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </label>

              <label>
                Problem Statement
                <textarea
                  value={form.problemStatement}
                  rows={3}
                  onChange={(e) => setForm({ ...form, problemStatement: e.target.value })}
                  required
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <label>
                  Hackathon Time
                  <select
                    value={form.availableTime}
                    onChange={(e) => setForm({ ...form, availableTime: e.target.value })}
                  >
                    <option value="24h">24 Hours</option>
                    <option value="48h">48 Hours</option>
                    <option value="12h">12 Hours (Sprint)</option>
                  </select>
                </label>

                <label>
                  Developer Team Size
                  <select
                    value={form.developerCount}
                    onChange={(e) => setForm({ ...form, developerCount: parseInt(e.target.value, 10) as 2 | 3 })}
                  >
                    <option value={2}>2 Developers (Frontend + Backend)</option>
                    <option value={3}>3 Developers (Frontend + Backend + AI/Integration)</option>
                  </select>
                </label>
              </div>

              <label>
                Allowed Technologies
                <input
                  type="text"
                  value={form.technologies}
                  onChange={(e) => setForm({ ...form, technologies: e.target.value })}
                />
              </label>

              <label>
                Host Developer Name
                <input
                  type="text"
                  value={form.hostName}
                  onChange={(e) => setForm({ ...form, hostName: e.target.value })}
                />
              </label>

              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setNewProjectModal(false)}>Cancel</button>
                <button type="submit" className="button primary">Initialize Hackathon Workspace</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
