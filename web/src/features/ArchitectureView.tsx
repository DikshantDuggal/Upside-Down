import { CheckCircle2, Cpu, Check } from "lucide-react";
import type { ArchitectureBlueprint } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface ArchitectureViewProps {
  architecture: ArchitectureBlueprint | null;
  onApprove: (version: number) => Promise<void>;
  isApproving: boolean;
}

export function ArchitectureView({ architecture, onApprove, isApproving }: ArchitectureViewProps) {
  if (!architecture) {
    return (
      <div className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
        <Cpu size={40} style={{ opacity: 0.5, marginBottom: "1rem" }} />
        <h3>No Architecture Generated Yet</h3>
        <p className="muted">
          Select an idea from the AI Idea Studio first, and the system will automatically synthesize an implementation blueprint and 7-phase roadmap.
        </p>
      </div>
    );
  }

  const { spec, technical, contracts, roadmap, isApproved, version } = architecture;

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>Technical Architecture Blueprint</h2>
          <p className="muted">
            Version {version} — Canonical system design, API contracts, and development roadmap.
          </p>
        </div>
        <div>
          {isApproved ? (
            <Badge tone="green">
              <CheckCircle2 size={14} style={{ marginRight: "4px" }} />
              Host Approved
            </Badge>
          ) : (
            <button
              className="button primary"
              onClick={() => onApprove(version)}
              disabled={isApproving}
            >
              <Check size={16} />
              {isApproving ? "Approving..." : "Approve Architecture"}
            </button>
          )}
        </div>
      </div>

      {/* Blueprint Spec */}
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3>1. Project Specification & Scope</h3>
        <p><strong>Primary Objective:</strong> {spec.objective}</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginTop: "1rem" }}>
          <div>
            <strong>MVP Core Deliverables:</strong>
            <ul style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              {spec.mvpFeatures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Non-Functional Requirements:</strong>
            <ul style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
              {spec.nonFunctionalReqs.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Technical Stack */}
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3>2. Technology Stack & Hosting Strategy</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Frontend</span>
            <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{technical.frontend}</p>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Backend API</span>
            <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{technical.backend}</p>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Database</span>
            <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{technical.database}</p>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Hosting & Deployment</span>
            <p style={{ margin: "0.25rem 0", fontWeight: 600 }}>{technical.hosting}</p>
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <strong className="small">Repository Structure:</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
            {technical.repoStructure.map((r, i) => (
              <code key={i} style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem", background: "var(--bg-accent, #f3f4f6)", borderRadius: "4px" }}>
                {r}
              </code>
            ))}
          </div>
        </div>
      </div>

      {/* Integration API Contracts */}
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3>3. Interface Contracts (Pre-Implementation Baseline)</h3>
        <p className="muted small">
          These API and data contracts are defined before parallel development to prevent frontend-backend divergence.
        </p>

        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table style={{ width: "100%", textAlign: "left", fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color, #e5e7eb)" }}>
                <th style={{ padding: "0.5rem" }}>Contract Name</th>
                <th style={{ padding: "0.5rem" }}>Method</th>
                <th style={{ padding: "0.5rem" }}>Endpoint Path</th>
                <th style={{ padding: "0.5rem" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-color, #f3f4f6)" }}>
                  <td style={{ padding: "0.5rem", fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <Badge tone={c.method === "POST" ? "amber" : c.method === "GET" ? "green" : "violet"}>
                      {c.method}
                    </Badge>
                  </td>
                  <td style={{ padding: "0.5rem" }}><code>{c.path}</code></td>
                  <td style={{ padding: "0.5rem", color: "var(--text-muted, #6b7280)" }}>{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7-Phase Vertical Slice Roadmap */}
      <div className="panel">
        <h3>4. Time-Aware Hackathon Roadmap (7 Phases)</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
          {roadmap.map((phase) => (
            <div
              key={phase.phase}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "1rem",
                padding: "0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--border-color, #e5e7eb)",
                background: "var(--bg-card, #ffffff)",
              }}
            >
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: "var(--color-primary, #3b82f6)",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  flexShrink: 0,
                }}
              >
                {phase.phase}
              </div>
              <div style={{ flex: 1 }}>
                <div className="row-between">
                  <h4 style={{ margin: "0 0 0.25rem 0" }}>{phase.title}</h4>
                  <span className="small muted">~{phase.estimatedHours} hrs</span>
                </div>
                <p className="small muted" style={{ margin: "0 0 0.5rem 0" }}>{phase.description}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {phase.deliverables.map((d, i) => (
                    <span key={i} className="badge" style={{ fontSize: "0.75rem" }}>
                      ✓ {d}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
