import React from "react";
import { IconSparkles, IconWifi, IconWifiOff, IconRefresh } from "./icons.tsx";
import type { SyncStatus, Project } from "../services/api.ts";

interface HeaderProps {
  syncStatus: SyncStatus | null;
  sseConnected: boolean;
  project: Project | null;
  onToggleOnline: () => void;
  onRunDemo: () => void;
  onRefresh: () => void;
  isDemoRunning: boolean;
}

export function Header({
  syncStatus,
  sseConnected,
  project,
  onToggleOnline,
  onRunDemo,
  onRefresh,
  isDemoRunning,
}: HeaderProps) {
  return (
    <header className="top-navbar">
      <div className="brand-section">
        <div className="brand-logo">
          <span>UPSIDE-DOWN</span>
          <span className="brand-tag">DEMO COCKPIT</span>
        </div>
        {project && (
          <span className="badge badge-indigo">
            📁 {project.name}
          </span>
        )}
        <span className="brand-motto">
          "Internet chala gaya, par AI coding team ka kaam nahi rukta"
        </span>
      </div>

      <div className="nav-actions">
        {syncStatus && (
          <button
            className={`btn ${syncStatus.isOnline ? "btn-outline" : "badge-amber"}`}
            onClick={onToggleOnline}
            title={syncStatus.isOnline ? "Click to simulate network disconnection" : "Click to restore connection"}
          >
            {syncStatus.isOnline ? (
              <>
                <IconWifi className="w-4 h-4 text-emerald-400" />
                <span className="badge badge-emerald">ONLINE (Sync Active)</span>
              </>
            ) : (
              <>
                <IconWifiOff className="w-4 h-4 text-amber-400" />
                <span className="badge badge-amber">OFFLINE (Local Outbox: {syncStatus.pendingOutboxCount})</span>
              </>
            )}
          </button>
        )}

        <span className={`badge ${sseConnected ? "badge-blue" : "badge-rose"}`} title="Live Server-Sent Events status">
          ● {sseConnected ? "SSE LIVE STREAM" : "RECONNECTING..."}
        </span>

        <button className="btn btn-primary" onClick={onRunDemo} disabled={isDemoRunning}>
          <IconSparkles className="w-4 h-4" />
          {isDemoRunning ? "Running 2-Agent Demo..." : "🚀 Run 2-Agent Demo"}
        </button>

        <button className="btn" onClick={onRefresh} title="Manual Refresh">
          <IconRefresh className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
