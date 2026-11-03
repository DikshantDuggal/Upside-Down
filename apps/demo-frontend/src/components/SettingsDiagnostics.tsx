import React, { useState } from "react";
import { IconSettings, IconRefresh, IconCheck, IconAlertTriangle } from "./icons.tsx";
import type { FrontendStatus, SyncStatus, ConflictRecord, OutboxItem } from "../services/api.ts";

interface SettingsDiagnosticsProps {
  frontendStatus: FrontendStatus | null;
  syncStatus: SyncStatus | null;
  outbox: OutboxItem[];
  conflicts: ConflictRecord[];
  onActivateTeamFrontend: (candidatePath?: string) => Promise<void>;
  onRollbackFrontend: () => Promise<void>;
  onFlushOutbox: () => Promise<void>;
  onResolveConflict: (conflictId: string, resolution: "accepted_incoming" | "kept_local") => Promise<void>;
  onRefresh: () => void;
}

export function SettingsDiagnostics({
  frontendStatus,
  syncStatus,
  outbox,
  conflicts,
  onActivateTeamFrontend,
  onRollbackFrontend,
  onFlushOutbox,
  onResolveConflict,
  onRefresh,
}: SettingsDiagnosticsProps) {
  const [candidatePath, setCandidatePath] = useState("");
  const [isActivating, setIsActivating] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleActivate = async () => {
    setIsActivating(true);
    setActionMessage(null);
    try {
      await onActivateTeamFrontend(candidatePath.trim() || undefined);
      setActionMessage("Successfully executed frontend activation!");
    } catch (err) {
      setActionMessage(`Activation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsActivating(false);
    }
  };

  const handleRollback = async () => {
    setIsRollingBack(true);
    setActionMessage(null);
    try {
      await onRollbackFrontend();
      setActionMessage("Successfully rolled back to previous frontend!");
    } catch (err) {
      setActionMessage(`Rollback error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <div>
      <div className="section-title-bar">
        <div className="section-heading">
          <IconSettings className="w-5 h-5 text-indigo-400" />
          <span>System Settings, Diagnostics & Frontend Replacement</span>
        </div>
        <button className="btn" onClick={onRefresh}>
          <IconRefresh className="w-4 h-4" /> Refresh Status
        </button>
      </div>

      {actionMessage && (
        <div style={{
          padding: "12px 16px",
          backgroundColor: actionMessage.includes("error") ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
          border: `1px solid ${actionMessage.includes("error") ? "var(--accent-rose)" : "var(--accent-emerald)"}`,
          borderRadius: "8px",
          marginBottom: "20px",
          fontSize: "0.85rem",
          color: "#fff",
        }}>
          {actionMessage}
        </div>
      )}

      {/* Frontend Replacement Card */}
      <div style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "10px",
        padding: "20px",
        marginBottom: "24px",
        boxShadow: "var(--shadow-card)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
              Frontend Handoff & Replacement Controller
            </h3>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Seamlessly toggle between the disposable Demo Frontend and the official Team Frontend without touching backend data.
            </div>
          </div>
          {frontendStatus && (
            <span className={`badge ${frontendStatus.activeFrontend === "demo" ? "badge-indigo" : "badge-emerald"}`} style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
              ACTIVE: {frontendStatus.activeFrontend.toUpperCase()}
            </span>
          )}
        </div>

        {frontendStatus && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", margin: "16px 0", backgroundColor: "#0b0f19", padding: "14px", borderRadius: "8px" }}>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Implementation:</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>{frontendStatus.activeFrontendName}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Source Directory:</div>
              <code>{frontendStatus.sourceDir}</code>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Distribution Bundle:</div>
              <span style={{ color: frontendStatus.bundleExists ? "#34d399" : "#fb7185", fontSize: "0.85rem", fontWeight: 600 }}>
                {frontendStatus.bundleExists ? "Compiled (app.js ready)" : "Missing"}
              </span>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Rollback Safety:</div>
              <span style={{ color: frontendStatus.rollbackAvailable ? "#34d399" : "#94a3b8", fontSize: "0.85rem" }}>
                {frontendStatus.rollbackAvailable ? "Available" : "No previous snapshot"}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
              Custom Team Frontend Directory (Optional, defaults to <code>frontend/</code>):
            </label>
            <input
              type="text"
              value={candidatePath}
              onChange={(e) => setCandidatePath(e.target.value)}
              placeholder="e.g. C:\Users\diksh\...\official-frontend"
              style={{
                width: "100%",
                padding: "8px 12px",
                backgroundColor: "#0b0f19",
                border: "1px solid #334155",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "0.85rem",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className="btn btn-primary"
              onClick={handleActivate}
              disabled={isActivating || frontendStatus?.activeFrontend === "team"}
            >
              {isActivating ? "Validating & Activating..." : "🚀 Validate & Activate Official Team Frontend"}
            </button>

            <button
              className="btn"
              onClick={handleRollback}
              disabled={isRollingBack || !frontendStatus?.rollbackAvailable}
            >
              {isRollingBack ? "Rolling back..." : "↺ Rollback to Previous Frontend"}
            </button>
          </div>
        </div>
      </div>

      {/* Offline Outbox & Conflict Diagnostics */}
      <div style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "10px",
        padding: "20px",
        marginBottom: "24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
              Offline Sync Engine & Conflict Diagnostics
            </h3>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Durable SQLite outbox and 3-way optimistic concurrency arbiter.
            </div>
          </div>
          <button className="btn" onClick={onFlushOutbox} disabled={!syncStatus?.isOnline || outbox.length === 0}>
            Flush Outbox ({outbox.length})
          </button>
        </div>

        {conflicts.length > 0 && (
          <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "rgba(244, 63, 94, 0.1)", border: "1px solid var(--accent-rose)", borderRadius: "8px" }}>
            <div style={{ fontWeight: 700, color: "#fb7185", marginBottom: "8px" }}>
              Concurrent Branch Conflicts ({conflicts.length}):
            </div>
            {conflicts.map((c) => (
              <div key={c.id} style={{ fontSize: "0.8rem", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Task <code>{c.taskId.slice(0, 8)}</code>: Local Rev {c.localRevision} vs Incoming Rev {c.incomingRevision}</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button className="btn btn-primary" style={{ padding: "2px 8px", fontSize: "0.72rem" }} onClick={() => onResolveConflict(c.id, "accepted_incoming")}>
                    Accept Remote
                  </button>
                  <button className="btn" style={{ padding: "2px 8px", fontSize: "0.72rem" }} onClick={() => onResolveConflict(c.id, "kept_local")}>
                    Keep Local
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          <div>Device ID: <code>{syncStatus?.deviceId || "Local"}</code></div>
          <div>Pending Outbox Count: <strong>{syncStatus?.pendingOutboxCount || 0}</strong></div>
          <div>Unresolved Conflicts: <strong>{syncStatus?.unresolvedConflictsCount || 0}</strong></div>
          <div>Backend Database: <code>data/upside_down.db (SQLite)</code></div>
        </div>
      </div>
    </div>
  );
}
