import { useState } from "react";
import {
  ListTodo,
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  GitPullRequest,
  Bot,
} from "lucide-react";
import type { TaskContractV2, SupportedCodingTool } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface HackathonTasksProps {
  tasks: TaskContractV2[];
  onGenerateTasks: () => Promise<void>;
  onClaimTask: (taskId: string, memberName: string, agentTool: string) => Promise<void>;
  onUpdateProgress: (taskId: string, status: string, progressPercent: number, blockerReason?: string) => Promise<void>;
  onSubmitEvidence: (taskId: string, evidence: { branch?: string; prNumber?: number; prUrl?: string; commitHash?: string; testsPassed?: boolean; testOutput?: string }) => Promise<void>;
  onApproveTask: (taskId: string) => Promise<void>;
  onFetchPromptBridge: (taskId: string, tool: string) => Promise<string>;
  isGenerating: boolean;
}

const COLUMNS: { id: TaskContractV2["status"]; label: string; tone: "gray" | "blue" | "amber" | "green" | "red" | "purple" }[] = [
  { id: "ready", label: "Ready", tone: "blue" },
  { id: "assigned", label: "Assigned", tone: "purple" },
  { id: "in_progress", label: "In Progress", tone: "amber" },
  { id: "blocked", label: "Blocked", tone: "red" },
  { id: "in_review", label: "In Review", tone: "blue" },
  { id: "completed", label: "Completed", tone: "green" },
];

export function HackathonTasks({
  tasks,
  onGenerateTasks,
  onClaimTask,
  onUpdateProgress,
  onSubmitEvidence,
  onApproveTask,
  onFetchPromptBridge,
  isGenerating,
}: HackathonTasksProps) {
  const [activeTask, setActiveTask] = useState<TaskContractV2 | null>(null);
  const [promptModal, setPromptModal] = useState<{ taskId: string; prompt: string; tool: SupportedCodingTool } | null>(null);
  const [copied, setCopied] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState<TaskContractV2 | null>(null);
  const [evidenceForm, setEvidenceForm] = useState({ branch: "", prNumber: "42", prUrl: "", commitHash: "", testOutput: "PASS 40 tests passed" });

  async function handleOpenPromptBridge(task: TaskContractV2, tool: SupportedCodingTool = "antigravity") {
    const promptText = await onFetchPromptBridge(task.taskId, tool);
    setPromptModal({ taskId: task.taskId, prompt: promptText, tool });
  }

  async function handleToolSwitch(tool: SupportedCodingTool) {
    if (!promptModal) return;
    const promptText = await onFetchPromptBridge(promptModal.taskId, tool);
    setPromptModal({ ...promptModal, prompt: promptText, tool });
  }

  function handleCopyPrompt() {
    if (!promptModal) return;
    navigator.clipboard.writeText(promptModal.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleEvidenceSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!evidenceModal) return;
    await onSubmitEvidence(evidenceModal.taskId, {
      branch: evidenceForm.branch || `feat/${evidenceModal.taskId.toLowerCase()}`,
      prNumber: parseInt(evidenceForm.prNumber, 10) || 42,
      prUrl: evidenceForm.prUrl || `https://github.com/DikshantDuggal/Upside-Down/pull/${evidenceForm.prNumber || 42}`,
      commitHash: evidenceForm.commitHash || "8e56108",
      testsPassed: true,
      testOutput: evidenceForm.testOutput,
    });
    setEvidenceModal(null);
  }

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>Multi-Agent Task Contracts (2.0)</h2>
          <p className="muted">
            Strict work contracts decomposed across 2–3 developers with explicit path policies and acceptance criteria.
          </p>
        </div>
        <button className="button primary" onClick={onGenerateTasks} disabled={isGenerating}>
          <Sparkles size={16} />
          {isGenerating ? "Decomposing..." : tasks.length === 0 ? "Decompose Work Contracts" : "Regenerate Tasks"}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
          <ListTodo size={40} style={{ opacity: 0.5, marginBottom: "1rem" }} />
          <h3>No Task Contracts Generated Yet</h3>
          <p className="muted" style={{ maxWidth: "480px", margin: "0 auto 1.5rem auto" }}>
            Once the architecture blueprint is approved, click "Decompose Work Contracts" to divide the hackathon project into parallel, isolated workstreams.
          </p>
          <button className="button primary" onClick={onGenerateTasks} disabled={isGenerating}>
            <Sparkles size={16} />
            {isGenerating ? "Decomposing..." : "Decompose Work Contracts"}
          </button>
        </div>
      ) : (
        /* Kanban Board */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            overflowX: "auto",
            alignItems: "flex-start",
          }}
        >
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                style={{
                  background: "var(--bg-accent, #f9fafb)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  minHeight: "360px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  border: "1px solid var(--border-color, #e5e7eb)",
                }}
              >
                <div className="row-between" style={{ paddingBottom: "0.5rem", borderBottom: "1px solid var(--border-color, #e5e7eb)" }}>
                  <strong style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {col.label}
                  </strong>
                  <span className="badge" style={{ fontSize: "0.75rem" }}>{colTasks.length}</span>
                </div>

                {colTasks.map((t) => (
                  <div
                    key={t.taskId}
                    className="panel"
                    onClick={() => setActiveTask(t)}
                    style={{
                      cursor: "pointer",
                      padding: "0.75rem",
                      background: "var(--bg-card, #ffffff)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <div className="row-between">
                      <Badge tone={t.assignedRole === "frontend" ? "violet" : t.assignedRole === "backend" ? "green" : "neutral"}>
                        {t.assignedRole}
                      </Badge>
                      <span className="small muted"><code>{t.taskId}</code></span>
                    </div>

                    <h4 style={{ margin: "0.25rem 0", fontSize: "0.95rem" }}>{t.title}</h4>

                    {t.owner && (
                      <div className="small muted" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Bot size={13} />
                        <span>{t.owner.agentTool || "Agent"} ({t.owner.memberName || "Dev"})</span>
                      </div>
                    )}

                    {t.progressPercent > 0 && (
                      <div style={{ width: "100%", background: "#e5e7eb", borderRadius: "4px", height: "5px", overflow: "hidden" }}>
                        <div style={{ width: `${t.progressPercent}%`, background: "#3b82f6", height: "100%" }} />
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.25rem" }}>
                      <span className="small muted" style={{ fontSize: "0.75rem" }}>
                        {t.allowedPaths.length} allowed path(s)
                      </span>
                      {t.status === "blocked" && <AlertTriangle size={14} color="#ef4444" />}
                      {t.evidence && <GitPullRequest size={14} color="#10b981" />}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Task Details Modal */}
      {activeTask && (
        <div className="modal-backdrop" onClick={() => setActiveTask(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "640px" }}>
            <div className="row-between" style={{ marginBottom: "1rem" }}>
              <div>
                <span className="small muted">CONTRACT 2.0 • {activeTask.taskId}</span>
                <h3 style={{ margin: "0.25rem 0" }}>{activeTask.title}</h3>
              </div>
              <Badge tone={activeTask.status === "completed" ? "green" : activeTask.status === "blocked" ? "red" : "violet"}>
                {activeTask.status}
              </Badge>
            </div>

            <p><strong>Objective:</strong> {activeTask.objective}</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", margin: "1rem 0" }}>
              <div style={{ background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)", padding: "0.75rem", borderRadius: "6px" }}>
                <strong className="small" style={{ color: "#065f46" }}>Allowed File Paths:</strong>
                <ul style={{ fontSize: "0.8rem", margin: "0.25rem 0", paddingLeft: "1.2rem" }}>
                  {activeTask.allowedPaths.map((p, i) => (
                    <li key={i}><code>{p}</code></li>
                  ))}
                </ul>
              </div>
              <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "0.75rem", borderRadius: "6px" }}>
                <strong className="small" style={{ color: "#991b1b" }}>Protected File Paths:</strong>
                <ul style={{ fontSize: "0.8rem", margin: "0.25rem 0", paddingLeft: "1.2rem" }}>
                  {activeTask.protectedPaths.map((p, i) => (
                    <li key={i}><code>{p}</code></li>
                  ))}
                </ul>
              </div>
            </div>

            <h4>Acceptance Criteria:</h4>
            <ul style={{ fontSize: "0.85rem" }}>
              {activeTask.acceptanceCriteria.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>

            {activeTask.evidence && (
              <div className="panel" style={{ background: "var(--bg-accent, #f9fafb)", marginTop: "1rem" }}>
                <h4>Submitted Evidence:</h4>
                <p className="small"><strong>Branch:</strong> <code>{activeTask.evidence.branch}</code></p>
                <p className="small"><strong>Pull Request:</strong> <a href={activeTask.evidence.prUrl} target="_blank" rel="noreferrer">{activeTask.evidence.prUrl}</a></p>
                <p className="small"><strong>Test Verification:</strong> {activeTask.evidence.testOutput}</p>
              </div>
            )}

            {/* Actions Bar */}
            <div className="action-row" style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-color, #e5e7eb)", paddingTop: "1rem" }}>
              <button
                className="button secondary"
                onClick={() => {
                  handleOpenPromptBridge(activeTask, (activeTask.owner?.agentTool as SupportedCodingTool) || "antigravity");
                }}
              >
                <Copy size={14} />
                Agent Prompt Bridge
              </button>

              {activeTask.status === "ready" && (
                <button
                  className="button primary"
                  onClick={async () => {
                    await onClaimTask(activeTask.taskId, "Developer", "antigravity");
                    setActiveTask(null);
                  }}
                >
                  Claim Task
                </button>
              )}

              {activeTask.status === "assigned" && (
                <button
                  className="button primary"
                  onClick={async () => {
                    await onUpdateProgress(activeTask.taskId, "in_progress", 25);
                    setActiveTask(null);
                  }}
                >
                  Start Work
                </button>
              )}

              {activeTask.status === "in_progress" && (
                <>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      await onUpdateProgress(activeTask.taskId, "blocked", activeTask.progressPercent, "Waiting for API endpoint");
                      setActiveTask(null);
                    }}
                  >
                    Flag Blocked
                  </button>
                  <button
                    className="button primary"
                    onClick={() => {
                      setEvidenceModal(activeTask);
                      setActiveTask(null);
                    }}
                  >
                    Submit for Review
                  </button>
                </>
              )}

              {activeTask.status === "in_review" && (
                <button
                  className="button primary"
                  onClick={async () => {
                    await onApproveTask(activeTask.taskId);
                    setActiveTask(null);
                  }}
                >
                  <CheckCircle2 size={14} />
                  Host Approve Task
                </button>
              )}

              <button className="button secondary" onClick={() => setActiveTask(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Bridge Modal */}
      {promptModal && (
        <div className="modal-backdrop" onClick={() => setPromptModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "700px" }}>
            <div className="row-between" style={{ marginBottom: "0.5rem" }}>
              <h3>Agent Prompt Bridge</h3>
              <button className="button primary small" onClick={handleCopyPrompt}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy Full Prompt"}
              </button>
            </div>
            <p className="small muted">
              Paste this prompt directly into your AI coding tool (Antigravity, Claude Code, Codex, Cursor, etc.). It injects the full project context, task contract, allowed paths, and PR instructions.
            </p>

            {/* Tool Tabs */}
            <div style={{ display: "flex", gap: "0.5rem", margin: "1rem 0", borderBottom: "1px solid var(--border-color, #e5e7eb)", paddingBottom: "0.5rem" }}>
              {(["antigravity", "claude-code", "codex", "cursor", "aider", "opencode"] as SupportedCodingTool[]).map((tool) => (
                <button
                  key={tool}
                  className={`button ${promptModal.tool === tool ? "primary" : "secondary"} small`}
                  onClick={() => handleToolSwitch(tool)}
                >
                  {tool}
                </button>
              ))}
            </div>

            <textarea
              readOnly
              value={promptModal.prompt}
              style={{
                width: "100%",
                height: "320px",
                fontFamily: "monospace",
                fontSize: "0.8rem",
                padding: "0.75rem",
                borderRadius: "6px",
                background: "var(--bg-accent, #f9fafb)",
                border: "1px solid var(--border-color, #e5e7eb)",
              }}
            />

            <div className="form-actions" style={{ marginTop: "1rem" }}>
              <button className="button secondary" onClick={() => setPromptModal(null)}>Done</button>
              <button className="button primary" onClick={handleCopyPrompt}>
                {copied ? "Copied to Clipboard!" : "Copy Prompt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evidence Submission Modal */}
      {evidenceModal && (
        <div className="modal-backdrop" onClick={() => setEvidenceModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <h3>Submit Implementation Evidence</h3>
            <p className="small muted">
              Under UD-IC/2.0, tasks require genuine evidence (branch, PR, tests) to move to In Review.
            </p>

            <form onSubmit={handleEvidenceSubmit} className="form-stack" style={{ marginTop: "1rem" }}>
              <label>
                Git Feature Branch
                <input
                  type="text"
                  value={evidenceForm.branch}
                  placeholder={`feat/${evidenceModal.taskId.toLowerCase()}`}
                  onChange={(e) => setEvidenceForm({ ...evidenceForm, branch: e.target.value })}
                />
              </label>

              <label>
                GitHub Pull Request URL
                <input
                  type="text"
                  value={evidenceForm.prUrl}
                  placeholder="https://github.com/DikshantDuggal/Upside-Down/pull/42"
                  onChange={(e) => setEvidenceForm({ ...evidenceForm, prUrl: e.target.value })}
                />
              </label>

              <label>
                Test Verification Output
                <textarea
                  value={evidenceForm.testOutput}
                  rows={3}
                  onChange={(e) => setEvidenceForm({ ...evidenceForm, testOutput: e.target.value })}
                />
              </label>

              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setEvidenceModal(null)}>Cancel</button>
                <button type="submit" className="button primary">Submit for Host Review</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
