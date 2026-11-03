import { useState } from "react";
import { ArrowRightLeft, Plus } from "lucide-react";
import type { CrossAgentHandoff, TaskContractV2 } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface HandoffsViewProps {
  handoffs: CrossAgentHandoff[];
  tasks: TaskContractV2[];
  onCreateHandoff: (data: { sourceTaskId: string; sourceRole?: string; targetTaskId: string; targetRole?: string; requestSummary: string; contractDetails?: Record<string, unknown> }) => Promise<void>;
  onResolveHandoff: (handoffId: string, status: "resolved" | "rejected", notes?: string) => Promise<void>;
}

export function HandoffsView({ handoffs, tasks, onCreateHandoff, onResolveHandoff }: HandoffsViewProps) {
  const [createModal, setCreateModal] = useState(false);
  const [resolveModal, setResolveModal] = useState<CrossAgentHandoff | null>(null);
  const [resolveNotes, setResolveNotes] = useState("Implemented endpoint in backend PR and verified schema.");
  const [form, setForm] = useState({
    sourceTaskId: tasks[0]?.taskId || "",
    targetTaskId: tasks[1]?.taskId || "",
    requestSummary: "Need additional field in user profile response for avatarUrl and role.",
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await onCreateHandoff({
      sourceTaskId: form.sourceTaskId,
      sourceRole: tasks.find((t) => t.taskId === form.sourceTaskId)?.assignedRole || "frontend",
      targetTaskId: form.targetTaskId,
      targetRole: tasks.find((t) => t.taskId === form.targetTaskId)?.assignedRole || "backend",
      requestSummary: form.requestSummary,
    });
    setCreateModal(false);
  }

  async function handleResolve(status: "resolved" | "rejected") {
    if (!resolveModal) return;
    await onResolveHandoff(resolveModal.id, status, resolveNotes);
    setResolveModal(null);
  }

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>Cross-Agent Handoffs & Dependencies</h2>
          <p className="muted">
            Structured request exchange when one agent depends on an API or interface built by another agent.
          </p>
        </div>
        <button className="button primary" onClick={() => setCreateModal(true)} disabled={tasks.length < 2}>
          <Plus size={16} />
          Create Handoff Request
        </button>
      </div>

      {handoffs.length === 0 ? (
        <div className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
          <ArrowRightLeft size={40} style={{ opacity: 0.5, marginBottom: "1rem" }} />
          <h3>No Active Handoff Requests</h3>
          <p className="muted" style={{ maxWidth: "480px", margin: "0 auto 1.5rem auto" }}>
            When a frontend developer needs an API endpoint from a backend developer, create a structured handoff to track the dependency without manual message confusion.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {handoffs.map((h) => (
            <div key={h.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="row-between">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Badge tone={h.sourceRole === "frontend" ? "violet" : "green"}>{h.sourceRole}</Badge>
                  <span className="small muted">➔</span>
                  <Badge tone={h.targetRole === "backend" ? "green" : "violet"}>{h.targetRole}</Badge>
                  <span className="small muted"><code>{h.id}</code></span>
                </div>
                <Badge tone={h.status === "resolved" ? "green" : h.status === "pending" ? "amber" : "red"}>
                  {h.status}
                </Badge>
              </div>

              <div>
                <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{h.requestSummary}</p>
                <div className="small muted" style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
                  <span>Source: <code>{h.sourceTaskId}</code></span>
                  <span>Target: <code>{h.targetTaskId}</code></span>
                </div>
              </div>

              {h.resolutionNotes && (
                <div style={{ background: "rgba(16, 185, 129, 0.05)", padding: "0.5rem 0.75rem", borderRadius: "6px", fontSize: "0.85rem" }}>
                  <strong>Resolution:</strong> {h.resolutionNotes}
                </div>
              )}

              {h.status === "pending" && (
                <div className="action-row" style={{ marginTop: "0.5rem", borderTop: "1px solid var(--border-color, #f3f4f6)", paddingTop: "0.5rem" }}>
                  <button className="button primary small" onClick={() => setResolveModal(h)}>
                    Resolve Handoff
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {createModal && (
        <div className="modal-backdrop" onClick={() => setCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <h3>Request Dependency from Teammate</h3>
            <p className="small muted">
              Request a new API endpoint, database schema update, or component interface from a peer agent.
            </p>

            <form onSubmit={handleCreate} className="form-stack" style={{ marginTop: "1rem" }}>
              <label>
                Your Current Task (Source)
                <select
                  value={form.sourceTaskId}
                  onChange={(e) => setForm({ ...form, sourceTaskId: e.target.value })}
                >
                  {tasks.map((t) => (
                    <option key={t.taskId} value={t.taskId}>[{t.assignedRole}] {t.title}</option>
                  ))}
                </select>
              </label>

              <label>
                Target Task to Request From
                <select
                  value={form.targetTaskId}
                  onChange={(e) => setForm({ ...form, targetTaskId: e.target.value })}
                >
                  {tasks.map((t) => (
                    <option key={t.taskId} value={t.taskId}>[{t.assignedRole}] {t.title}</option>
                  ))}
                </select>
              </label>

              <label>
                Dependency Request Summary
                <textarea
                  value={form.requestSummary}
                  rows={3}
                  onChange={(e) => setForm({ ...form, requestSummary: e.target.value })}
                  placeholder="Specify exact endpoint path, query parameters, or response payload requirements..."
                  required
                />
              </label>

              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setCreateModal(false)}>Cancel</button>
                <button type="submit" className="button primary">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="modal-backdrop" onClick={() => setResolveModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3>Resolve Handoff Request</h3>
            <p className="small muted">{resolveModal.requestSummary}</p>

            <div className="form-stack" style={{ marginTop: "1rem" }}>
              <label>
                Resolution Notes
                <textarea
                  value={resolveNotes}
                  rows={3}
                  onChange={(e) => setResolveNotes(e.target.value)}
                />
              </label>

              <div className="form-actions">
                <button className="button secondary" onClick={() => handleResolve("rejected")}>Reject</button>
                <button className="button primary" onClick={() => handleResolve("resolved")}>Mark Resolved</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
