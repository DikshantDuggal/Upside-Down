import { useState } from "react";
import { Sparkles, CheckCircle2, MessageSquare, Lightbulb, RefreshCw } from "lucide-react";
import type { ProjectIdea, IdeaFeedbackMessage } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface IdeaStudioProps {
  ideas: ProjectIdea[];
  selectedIdea: ProjectIdea | null;
  feedbackMessages: IdeaFeedbackMessage[];
  onGenerate: () => Promise<void>;
  onRefine: (feedback: string) => Promise<void>;
  onSelect: (ideaId: string) => Promise<void>;
  isGenerating: boolean;
}

export function IdeaStudio({
  ideas,
  selectedIdea,
  feedbackMessages,
  onGenerate,
  onRefine,
  onSelect,
  isGenerating,
}: IdeaStudioProps) {
  const [feedbackInput, setFeedbackInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [selectedForDetail, setSelectedForDetail] = useState<ProjectIdea | null>(null);

  async function handleRefineSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedbackInput.trim() || isRefining) return;
    setIsRefining(true);
    try {
      await onRefine(feedbackInput.trim());
      setFeedbackInput("");
    } finally {
      setIsRefining(false);
    }
  }

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>AI Idea Studio</h2>
          <p className="muted">
            Transform hackathon problem statements into validated, competitive software concepts.
          </p>
        </div>
        <button
          className="button primary"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          <Sparkles size={16} />
          {isGenerating ? "Analyzing Problem..." : ideas.length === 0 ? "Generate Concepts" : "Regenerate All"}
        </button>
      </div>

      {selectedIdea && (
        <div className="panel" style={{ borderLeft: "4px solid var(--color-green, #10b981)", marginBottom: "1.5rem" }}>
          <div className="row-between">
            <div>
              <span className="small muted">APPROVED HACKATHON CONCEPT (LOCKED)</span>
              <h3 style={{ margin: "0.25rem 0" }}>{selectedIdea.name}</h3>
              <p style={{ margin: 0 }}>{selectedIdea.pitch}</p>
            </div>
            <Badge tone="green">
              <CheckCircle2 size={14} style={{ marginRight: "4px" }} />
              Host Selected
            </Badge>
          </div>
        </div>
      )}

      {ideas.length === 0 ? (
        <div className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
          <Lightbulb size={40} style={{ opacity: 0.5, marginBottom: "1rem" }} />
          <h3>No Concepts Generated Yet</h3>
          <p className="muted" style={{ maxWidth: "480px", margin: "0 auto 1.5rem auto" }}>
            Click "Generate Concepts" to have the AI Coordinator analyze your problem statement and propose 3–5 high-feasibility hackathon concepts.
          </p>
          <button className="button primary" onClick={onGenerate} disabled={isGenerating}>
            <Sparkles size={16} />
            {isGenerating ? "Generating Concepts..." : "Generate Project Ideas"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
          {ideas.map((idea) => {
            const isSelected = selectedIdea?.id === idea.id;
            return (
              <div
                key={idea.id}
                className="panel"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  border: isSelected ? "2px solid var(--color-green, #10b981)" : undefined,
                  background: isSelected ? "rgba(16, 185, 129, 0.04)" : undefined,
                }}
              >
                <div>
                  <div className="row-between" style={{ marginBottom: "0.5rem" }}>
                    <Badge tone={idea.mvpDifficulty === "Easy" ? "green" : idea.mvpDifficulty === "Medium" ? "amber" : "red"}>
                      {idea.mvpDifficulty} MVP
                    </Badge>
                    <span className="small muted">v{idea.version}</span>
                  </div>

                  <h3 style={{ marginTop: 0 }}>{idea.name}</h3>
                  <p className="small muted" style={{ fontStyle: "italic", marginBottom: "0.75rem" }}>
                    "{idea.pitch}"
                  </p>

                  <div style={{ marginBottom: "0.75rem" }}>
                    <strong className="small">Unique Advantage:</strong>
                    <p className="small" style={{ margin: "0.25rem 0" }}>{idea.usp}</p>
                  </div>

                  <div style={{ marginBottom: "0.75rem" }}>
                    <strong className="small">Core Capabilities:</strong>
                    <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                      {idea.coreFeatures.slice(0, 3).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "1rem" }}>
                    {idea.suggestedTech.map((t, i) => (
                      <span key={i} className="badge" style={{ fontSize: "0.75rem" }}>{t}</span>
                    ))}
                  </div>
                </div>

                <div className="action-row" style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-color, #e5e7eb)" }}>
                  <button
                    className="button secondary small"
                    onClick={() => setSelectedForDetail(idea)}
                  >
                    Explore
                  </button>
                  <button
                    className={`button ${isSelected ? "secondary" : "primary"} small`}
                    onClick={() => onSelect(idea.id)}
                    disabled={isSelected}
                  >
                    {isSelected ? "Selected Concept" : "Select This Idea"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Iterative Brainstorming Chat */}
      {ideas.length > 0 && (
        <div className="panel" style={{ marginTop: "2rem" }}>
          <div className="section-head" style={{ marginBottom: "1rem" }}>
            <div>
              <h3><MessageSquare size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} /> Iterative Brainstorming & Refinement</h3>
              <p className="muted small">
                Give feedback to guide the AI without losing your project constraints (e.g. "make this more innovative", "combine idea 1 and 2", "make it easier for 24h").
              </p>
            </div>
          </div>

          {feedbackMessages.length > 0 && (
            <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              {feedbackMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "6px",
                    background: msg.role === "user" ? "var(--bg-accent, #f3f4f6)" : "var(--bg-card, #ffffff)",
                    border: "1px solid var(--border-color, #e5e7eb)",
                    fontSize: "0.85rem",
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                  }}
                >
                  <strong>{msg.role === "user" ? "Host" : "AI Coordinator"}: </strong>
                  <span>{msg.message}</span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleRefineSubmit} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              placeholder="E.g., Focus on open-source tools and make the demo scenario more impressive for judges..."
              value={feedbackInput}
              onChange={(e) => setFeedbackInput(e.target.value)}
              disabled={isRefining}
              style={{ flex: 1 }}
            />
            <button className="button primary" type="submit" disabled={isRefining || !feedbackInput.trim()}>
              <RefreshCw size={14} className={isRefining ? "spin" : ""} />
              {isRefining ? "Refining..." : "Refine Concepts"}
            </button>
          </form>
        </div>
      )}

      {/* Detail Modal */}
      {selectedForDetail && (
        <div className="modal-backdrop" onClick={() => setSelectedForDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px" }}>
            <div className="row-between" style={{ marginBottom: "1rem" }}>
              <h3>{selectedForDetail.name}</h3>
              <Badge tone="amber">v{selectedForDetail.version}</Badge>
            </div>

            <p><strong>One-Sentence Pitch:</strong> {selectedForDetail.pitch}</p>
            <p><strong>Problem Addressed:</strong> {selectedForDetail.problem}</p>
            <p><strong>Target Users:</strong> {selectedForDetail.targetUsers}</p>
            <p><strong>Time Feasibility:</strong> {selectedForDetail.timeFeasibility}</p>

            <h4>Technical Risks:</h4>
            <ul>
              {selectedForDetail.technicalRisks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>

            <h4>Recommended Demo Scenario:</h4>
            <p style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px", fontSize: "0.9rem" }}>
              {selectedForDetail.demoScenario}
            </p>

            <div className="form-actions" style={{ marginTop: "1.5rem" }}>
              <button className="button secondary" onClick={() => setSelectedForDetail(null)}>Close</button>
              <button
                className="button primary"
                onClick={() => {
                  onSelect(selectedForDetail.id);
                  setSelectedForDetail(null);
                }}
              >
                Select This Concept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
