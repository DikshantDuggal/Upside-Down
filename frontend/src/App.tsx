import React, { useState, useEffect } from "react";

interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "assigned" | "running" | "review" | "done" | "blocked" | "failed";
  ownerId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  id: string;
  name: string;
  status: "idle" | "running" | "review" | "offline";
  runtimeAvailable: boolean;
  currentTaskId?: string;
  lastSeenAt: string;
}

interface Patch {
  id: string;
  taskId: string;
  runId: string;
  status: "pending" | "approved" | "rejected";
  diffContent: string;
  testOutput?: string;
  createdAt: string;
}

interface ActivityEvent {
  id: string;
  taskId?: string;
  source: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface SyncStatus {
  enabled: boolean;
  deviceId: string;
  isOnline: boolean;
  pendingOutboxCount: number;
  unresolvedConflictsCount: number;
}

interface OutboxItem {
  id: string;
  eventId: string;
  destination: string;
  status: string;
  retryCount: number;
  createdAt: string;
}

interface ConflictRecord {
  id: string;
  taskId: string;
  localRevision: number;
  incomingRevision: number;
  detectedAt: string;
  resolved: boolean;
  resolution?: string;
}

interface Handoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskId?: string;
  dependentTaskId?: string;
  handoffType: string;
  summary: string;
  contractVersion: string;
  createdAt: string;
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [selectedPatch, setSelectedPatch] = useState<Patch | null>(null);

  // Initial Data Fetch
  const refreshData = async () => {
    try {
      const [tasksRes, agentsRes, eventsRes, syncRes, outboxRes, conflictsRes, projectsRes, handoffsRes] = await Promise.all([
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/agents").then((r) => r.json()),
        fetch("/api/events?limit=25").then((r) => r.json()),
        fetch("/api/sync/status").then((r) => r.json()),
        fetch("/api/sync/outbox").then((r) => r.json()),
        fetch("/api/sync/conflicts?resolved=false").then((r) => r.json()),
        fetch("/api/projects").then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch("/api/handoffs").then((r) => r.ok ? r.json() : []).catch(() => []),
      ]);

      if (Array.isArray(tasksRes)) setTasks(tasksRes);
      if (Array.isArray(agentsRes)) setAgents(agentsRes);
      if (Array.isArray(eventsRes)) setEvents(eventsRes);
      if (syncRes && syncRes.enabled) setSyncStatus(syncRes);
      if (Array.isArray(outboxRes)) setOutbox(outboxRes);
      if (Array.isArray(conflictsRes)) setConflicts(conflictsRes);
      if (Array.isArray(projectsRes)) setProjects(projectsRes);
      if (Array.isArray(handoffsRes)) setHandoffs(handoffsRes);

      // Check for review patches
      const reviewTasks = (tasksRes as Task[]).filter((t) => t.status === "review");
      if (reviewTasks.length > 0) {
        const patchRes = await fetch(`/api/tasks/${reviewTasks[0].id}/patch`).then((r) => r.ok ? r.json() : null);
        if (patchRes) setSelectedPatch(patchRes);
      } else {
        setSelectedPatch(null);
      }
    } catch (err) {
      console.error("Error refreshing data:", err);
    }
  };

  useEffect(() => {
    refreshData();

    // Setup Server-Sent Events (SSE) Stream
    const eventSource = new EventSource("/api/events/stream");

    eventSource.onopen = () => {
      setSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") return;

        setEvents((prev) => [data as ActivityEvent, ...prev.slice(0, 49)]);
        refreshData();
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const toggleOnline = async () => {
    if (!syncStatus) return;
    try {
      await fetch("/api/sync/toggle-online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ online: !syncStatus.isOnline }),
      });
      refreshData();
    } catch (err) {
      console.error("Toggle online failed:", err);
    }
  };

  const flushOutbox = async () => {
    try {
      await fetch("/api/sync/flush", { method: "POST" });
      refreshData();
    } catch (err) {
      console.error("Flush outbox failed:", err);
    }
  };

  const approvePatch = async (patchId: string) => {
    try {
      await fetch(`/api/patches/${patchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerId: "human-dev" }),
      });
      refreshData();
    } catch (err) {
      console.error("Approve patch failed:", err);
    }
  };

  const rejectPatch = async (patchId: string) => {
    try {
      await fetch(`/api/patches/${patchId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerId: "human-dev", reason: "Rejected by reviewer" }),
      });
      refreshData();
    } catch (err) {
      console.error("Reject patch failed:", err);
    }
  };

  const resolveConflict = async (conflictId: string, resolution: "accepted_incoming" | "kept_local") => {
    try {
      await fetch(`/api/sync/conflicts/${conflictId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      refreshData();
    } catch (err) {
      console.error("Resolve conflict failed:", err);
    }
  };

  const createSampleTask = async () => {
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Fix math utility regression #${Date.now().toString().slice(-4)}`,
          description: "Detected assertion error in calculateTotal: expected 15, got NaN. Automatic repair requested.",
          ownerId: "agent-runner",
        }),
      });
      refreshData();
    } catch (err) {
      console.error("Create task failed:", err);
    }
  };

  const runMultiAgentDemo = async () => {
    try {
      await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "agent-backend-codex", name: "Backend Agent (Codex)", status: "running" }),
      });
      await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "agent-frontend-claude", name: "Frontend Agent (Claude)", status: "running" }),
      });

      const taskA = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Auth REST Endpoint & Schema #${Date.now().toString().slice(-4)}`,
          description: "Implement /api/auth/login and user session token schema",
          ownerId: "agent-backend-codex",
        }),
      }).then((r) => r.json());

      const taskB = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Frontend Login Modal & State #${Date.now().toString().slice(-4)}`,
          description: "Integrate login dialog with backend token contract",
          ownerId: "agent-frontend-claude",
        }),
      }).then((r) => r.json());

      await fetch(`/api/tasks/${taskA.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStatus: "running",
          baseRevision: taskA.revision,
          ownerId: "agent-backend-codex",
          reason: "Agent A acknowledged task assignment and started implementation",
        }),
      });

      await fetch(`/api/tasks/${taskB.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetStatus: "assigned",
          baseRevision: taskB.revision,
          ownerId: "agent-frontend-claude",
          reason: "Agent B acknowledged assignment (awaiting backend contract handoff)",
        }),
      });

      await fetch("/api/patches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskA.id,
          runId: `run-demo-${Date.now()}`,
          diffContent: "--- a/server/api/auth.ts\n+++ b/server/api/auth.ts\n@@ -0,0 +1,5 @@\n+export const login = () => ({ token: 'jwt_secure_session_token' });",
          testOutput: "PASS: 4/4 auth unit tests passed in 42ms.",
        }),
      });

      await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAgent: "agent-backend-codex",
          toAgent: "agent-frontend-claude",
          taskId: taskA.id,
          dependentTaskId: taskB.id,
          handoffType: "task_completed",
          summary: "Auth API endpoints (/api/auth/login) deployed; frontend integration unblocked.",
          payload: { endpoint: "/api/auth/login", method: "POST", schemaVersion: "1.0.0" },
        }),
      });

      refreshData();
    } catch (err) {
      console.error("Multi-agent demo failed:", err);
    }
  };

  const columns = [
    { key: "pending", label: "Backlog" },
    { key: "assigned", label: "Assigned" },
    { key: "running", label: "In Progress" },
    { key: "review", label: "Review (Approval Needed)" },
    { key: "done", label: "Done" },
  ];

  const activeProject = projects.length > 0 ? projects[0] : null;

  return (
    <div>
      {/* Top Header */}
      <header className="header">
        <div className="brand">
          <h1>UPSIDE-DOWN</h1>
          <span>PROTO-G</span>
          {activeProject && (
            <span className="badge badge-blue" style={{ fontSize: "0.75rem" }}>
              📁 {activeProject.name}
            </span>
          )}
          <div className="tagline">"Internet chala gaya, par AI coding team ka kaam nahi rukta"</div>
        </div>

        <div className="header-actions">
          {syncStatus && (
            <span className={`badge ${syncStatus.isOnline ? "badge-green" : "badge-amber"}`}>
              ● {syncStatus.isOnline ? "ONLINE (Sync Active)" : "OFFLINE (Local Outbox)"}
            </span>
          )}

          <span className={`badge ${sseConnected ? "badge-blue" : "badge-red"}`}>
            ● {sseConnected ? "SSE LIVE STREAM" : "POLLING RECOVERY"}
          </span>

          <button className="btn" onClick={toggleOnline}>
            {syncStatus?.isOnline ? "Simulate Offline Mode" : "Restore Online Mode"}
          </button>

          <button className="btn btn-primary" onClick={runMultiAgentDemo}>
            🚀 Run 2-Agent Demo
          </button>

          <button className="btn" onClick={createSampleTask}>
            + Single Task
          </button>
        </div>
      </header>

      <div className="container">
        {/* Section 1: Agent Status Cards */}
        <div>
          <div className="section-title">
            <span>Collaborating AI Agents</span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {agents.length} Agents Registered
            </span>
          </div>
          <div className="agent-grid">
            {agents.map((agent) => (
              <div key={agent.id} className="agent-card">
                <div className="agent-header">
                  <span className="agent-name">{agent.name}</span>
                  <span className={`badge ${agent.status === "running" ? "badge-amber" : agent.status === "review" ? "badge-blue" : "badge-green"}`}>
                    {agent.status.toUpperCase()}
                  </span>
                </div>
                <div className="agent-meta">
                  Role: {agent.id.includes("backend") ? "Backend Agent (Role 1/2)" : agent.id.includes("frontend") ? "Frontend Agent (Role 3)" : agent.id.includes("watcher") ? "File Monitor" : agent.id.includes("repair") ? "Code Repair" : agent.id.includes("sync") ? "Offline Sync" : "Coordinator"}
                </div>
                <div className="agent-meta">
                  Active Task: {agent.currentTaskId ? agent.currentTaskId.slice(0, 8) + "..." : "None (Idle)"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: Task Kanban Board */}
        <div>
          <div className="section-title">
            <span>Collaboration Task Board</span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {tasks.length} Total Tasks
            </span>
          </div>
          <div className="kanban-board">
            {columns.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="kanban-col">
                  <div className="col-header">
                    <span>{col.label}</span>
                    <span className="badge badge-blue">{colTasks.length}</span>
                  </div>
                  {colTasks.map((task) => (
                    <div key={task.id} className="task-card">
                      <div className="task-title">{task.title}</div>
                      {task.description && <div className="task-desc">{task.description}</div>}
                      <div className="task-footer">
                        <span>Owner: {task.ownerId || "Unassigned"}</span>
                        <span>Rev: v{task.revision}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 3: Split Layout (Diff Reviewer & Sync Outbox) */}
        <div className="split-layout">
          {/* Patch Review Panel */}
          <div className="review-panel">
            <div className="section-title">
              <span>Code Patch Review & Approval</span>
              {selectedPatch && (
                <span className="badge badge-amber">AWAITING HUMAN APPROVAL</span>
              )}
            </div>

            {selectedPatch ? (
              <div>
                <div style={{ marginBottom: "8px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Task ID: <code>{selectedPatch.taskId}</code> | Patch ID: <code>{selectedPatch.id}</code>
                </div>
                <div className="diff-box">
                  {selectedPatch.diffContent.split("\n").map((line, idx) => {
                    let className = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) className = "diff-add";
                    if (line.startsWith("-") && !line.startsWith("---")) className = "diff-del";
                    return (
                      <div key={idx} className={className}>
                        {line}
                      </div>
                    );
                  })}
                </div>
                {selectedPatch.testOutput && (
                  <div style={{ marginTop: "12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    <strong>Verification Test Output:</strong>
                    <pre style={{ backgroundColor: "#0b0f19", padding: "8px", borderRadius: "4px", marginTop: "4px" }}>
                      {selectedPatch.testOutput}
                    </pre>
                  </div>
                )}
                <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
                  <button className="btn btn-success" onClick={() => approvePatch(selectedPatch.id)}>
                    ✓ Approve & Apply Patch
                  </button>
                  <button className="btn btn-danger" onClick={() => rejectPatch(selectedPatch.id)}>
                    ✕ Reject Patch
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No patches currently awaiting review. Tasks in "Review" state will appear here for human authorization.
              </div>
            )}
          </div>

          {/* Offline Outbox & Conflict Monitor */}
          <div className="review-panel">
            <div className="section-title">
              <span>Offline Outbox & Conflict Engine</span>
              <button className="btn" onClick={flushOutbox}>
                Flush Outbox ({outbox.length})
              </button>
            </div>

            {conflicts.length > 0 && (
              <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--accent-red)", borderRadius: "6px" }}>
                <div style={{ fontWeight: 700, color: "var(--accent-red)", marginBottom: "6px" }}>
                  ⚠ Concurrent Branch/Device Revision Conflicts Detected:
                </div>
                {conflicts.map((c) => (
                  <div key={c.id} style={{ fontSize: "0.8rem", marginBottom: "8px" }}>
                    Task: <code>{c.taskId.slice(0, 8)}</code> (Local Rev {c.localRevision} vs Remote Rev {c.incomingRevision})
                    <div style={{ marginTop: "4px", display: "flex", gap: "8px" }}>
                      <button className="btn btn-primary" style={{ padding: "2px 8px", fontSize: "0.75rem" }} onClick={() => resolveConflict(c.id, "accepted_incoming")}>
                        Accept Remote
                      </button>
                      <button className="btn" style={{ padding: "2px 8px", fontSize: "0.75rem" }} onClick={() => resolveConflict(c.id, "kept_local")}>
                        Keep Local
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>
              Pending Durable Outbox Items ({outbox.length}):
            </div>
            {outbox.length > 0 ? (
              <table className="sync-table">
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Destination</th>
                    <th>Status</th>
                    <th>Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((item) => (
                    <tr key={item.id}>
                      <td><code>{item.eventId.slice(0, 12)}...</code></td>
                      <td>{item.destination}</td>
                      <td><span className="badge badge-amber">{item.status}</span></td>
                      <td>{item.retryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                Outbox is clean. All local events synchronized.
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Structured Agent Handoffs */}
        {handoffs.length > 0 && (
          <div>
            <div className="section-title">
              <span>Structured Agent Handoffs</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {handoffs.length} Cross-Agent Contracts Exchanged
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "12px", marginBottom: "24px" }}>
              {handoffs.map((h) => (
                <div key={h.id} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent-blue)" }}>
                      @{h.fromAgent} ➔ @{h.toAgent}
                    </span>
                    <span className="badge badge-green" style={{ fontSize: "0.7rem" }}>
                      {h.handoffType.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-primary)", marginBottom: "6px" }}>
                    {h.summary}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Contract v{h.contractVersion} • {new Date(h.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 5: Live Activity Timeline */}
        <div>
          <div className="section-title">
            <span>Live Activity Stream (SSE)</span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {events.length} Events Logged
            </span>
          </div>
          <div className="timeline">
            {events.map((ev) => (
              <div key={ev.id} className="event-row">
                <span className="event-time">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                <span className="event-type">[{ev.type}]</span>
                <span className="event-desc">
                  Source: <strong>{ev.source}</strong> {ev.taskId ? `(Task: ${ev.taskId.slice(0, 8)})` : ""} — {JSON.stringify(ev.payload)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
