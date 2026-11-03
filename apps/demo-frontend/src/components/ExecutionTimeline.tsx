import React, { useState } from "react";
import { IconActivity, IconRefresh } from "./icons.tsx";
import type { ActivityEvent } from "../services/api.ts";

interface ExecutionTimelineProps {
  events: ActivityEvent[];
  sseConnected: boolean;
  onRefresh: () => void;
}

export function ExecutionTimeline({ events, sseConnected, onRefresh }: ExecutionTimelineProps) {
  const [filterType, setFilterType] = useState<string>("all");

  const eventTypes = ["all", ...Array.from(new Set(events.map((e) => e.type)))];

  const filtered = filterType === "all" ? events : events.filter((e) => e.type === filterType);

  const getBadgeClass = (type: string) => {
    if (type.includes("created")) return "badge-blue";
    if (type.includes("transitioned")) return "badge-amber";
    if (type.includes("patch")) return "badge-purple";
    if (type.includes("approved")) return "badge-emerald";
    if (type.includes("handoff")) return "badge-indigo";
    return "badge-gray";
  };

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconActivity className="w-5 h-5 text-indigo-400" />
          <span>Live Execution Event Timeline</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className={`badge ${sseConnected ? "badge-emerald" : "badge-rose"}`}>
            ● {sseConnected ? "STREAMING (SSE)" : "DISCONNECTED"}
          </span>
          <button className="btn" onClick={onRefresh}>
            <IconRefresh className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
        {eventTypes.map((t) => (
          <button
            key={t}
            className={`btn ${filterType === t ? "btn-primary" : ""}`}
            style={{ padding: "3px 10px", fontSize: "0.75rem" }}
            onClick={() => setFilterType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="timeline-list">
        {filtered.map((e) => (
          <div key={e.id} className="timeline-item">
            <span className="timeline-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <div className="timeline-body">
              <div className="timeline-header">
                <span className={`badge ${getBadgeClass(e.type)}`}>{e.type}</span>
                <span style={{ fontSize: "0.825rem", color: "#fff", fontWeight: 600 }}>
                  @{e.source}
                </span>
                {e.taskId && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Task: <code>{e.taskId.slice(0, 8)}</code>
                  </span>
                )}
              </div>

              {e.payload && Object.keys(e.payload).length > 0 && (
                <pre className="timeline-payload">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No activity events recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
