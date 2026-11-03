import React, { useState } from "react";
import { IconMessageSquare, IconActivity, IconSparkles } from "./icons.tsx";
import type { StructuredHandoff, ActivityEvent } from "../services/api.ts";

interface CommunicationCenterProps {
  handoffs: StructuredHandoff[];
  events: ActivityEvent[];
  onTriggerDemoHandoff: () => void;
}

export function CommunicationCenter({
  handoffs,
  events,
  onTriggerDemoHandoff,
}: CommunicationCenterProps) {
  const [activeTab, setActiveTab] = useState<"handoffs" | "messages">("handoffs");

  const coordinationEvents = events.filter(
    (e) => e.type.includes("handoff") || e.type.includes("heartbeat") || e.source.includes("agent")
  );

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconMessageSquare className="w-5 h-5 text-indigo-400" />
          <span>Agent-to-Agent Communication & Handoff Center</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className={`btn ${activeTab === "handoffs" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("handoffs")}
          >
            Structured Handoffs ({handoffs.length})
          </button>
          <button
            className={`btn ${activeTab === "messages" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("messages")}
          >
            Coordination Stream ({coordinationEvents.length})
          </button>
          <button className="btn" onClick={onTriggerDemoHandoff}>
            <IconSparkles className="w-4 h-4" /> Synthesize Handoff
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "20px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        Autonomous agents communicate contractually without ad-hoc chat parsing. Every handoff specifies versions, dependencies, and payload schemas.
      </div>

      {activeTab === "handoffs" ? (
        <div>
          {handoffs.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px" }}>
              {handoffs.map((h) => (
                <div key={h.id} style={{
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "10px",
                  padding: "16px",
                  boxShadow: "var(--shadow-card)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#818cf8" }}>
                      @{h.fromAgent} &rarr; @{h.toAgent}
                    </div>
                    <span className="badge badge-emerald">
                      {h.handoffType.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: "0.85rem", color: "#fff", marginBottom: "8px", fontWeight: 500 }}>
                    {h.summary}
                  </div>

                  <div style={{ display: "flex", gap: "12px", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "10px" }}>
                    <span>Handoff ID: <code>{h.id.slice(0, 8)}...</code></span>
                    <span>Contract v{h.contractVersion}</span>
                    <span>{new Date(h.createdAt).toLocaleTimeString()}</span>
                  </div>

                  {h.payload && Object.keys(h.payload).length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                        Contract Payload:
                      </div>
                      <pre style={{
                        backgroundColor: "#0b0f19",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        fontSize: "0.75rem",
                        color: "#94a3b8",
                        overflowX: "auto",
                        maxHeight: "140px",
                      }}>
                        {JSON.stringify(h.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "40px", textAlign: "center", backgroundColor: "var(--bg-card)", borderRadius: "10px", border: "1px solid var(--border-subtle)" }}>
              <IconMessageSquare className="w-8 h-8 text-indigo-400" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontWeight: 600, color: "#fff", marginBottom: "4px" }}>No Structured Handoffs Recorded Yet</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "16px" }}>
                Click "Run 2-Agent Demo" to observe an automated backend-to-frontend handoff sequence.
              </div>
              <button className="btn btn-primary" onClick={onTriggerDemoHandoff}>
                Trigger Demo Handoff
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="timeline-list">
          {coordinationEvents.map((e) => (
            <div key={e.id} className="timeline-item">
              <span className="timeline-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <div className="timeline-body">
                <div className="timeline-header">
                  <span className="badge badge-purple">{e.type}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    Source: <strong>@{e.source}</strong> {e.taskId ? `(Task: ${e.taskId.slice(0, 8)})` : ""}
                  </span>
                </div>
                {e.payload && (
                  <pre className="timeline-payload">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
