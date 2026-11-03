import { useState } from "react";
import {
  ShieldCheck,
  AlertOctagon,
  CheckCircle2,
  Rocket,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { IntegrationReleaseRecord } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface IntegrationCenterProps {
  release: IntegrationReleaseRecord | null;
  collision: { hasCollision: boolean; collidingFiles: string[]; tasksInvolved: string[]; summary: string } | null;
  onCheckIntegration: () => Promise<void>;
  onApproveRelease: (approvedBy: string) => Promise<void>;
  onDeploy: () => Promise<void>;
  isChecking: boolean;
  isDeploying: boolean;
}

export function IntegrationCenter({
  release,
  collision,
  onCheckIntegration,
  onApproveRelease,
  onDeploy,
  isChecking,
  isDeploying,
}: IntegrationCenterProps) {
  const [approverName, setApproverName] = useState("Dikshant Duggal");

  const hasCollision = collision?.hasCollision || release?.collisionDetected;

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>Code Integration & Release Center</h2>
          <p className="muted">
            Automated collision detection, contract verification, and host release gating before production deployment.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={onCheckIntegration}
          disabled={isChecking}
        >
          <RefreshCw size={14} className={isChecking ? "spin" : ""} />
          {isChecking ? "Analyzing..." : "Re-Check Collisions"}
        </button>
      </div>

      {/* Collision Detection Status Banner */}
      <div
        className="panel"
        style={{
          borderLeft: `4px solid ${hasCollision ? "var(--color-red, #ef4444)" : "var(--color-green, #10b981)"}`,
          marginBottom: "1.5rem",
        }}
      >
        <div className="row-between">
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            {hasCollision ? (
              <AlertOctagon size={24} color="#ef4444" style={{ flexShrink: 0, marginTop: "2px" }} />
            ) : (
              <ShieldCheck size={24} color="#10b981" style={{ flexShrink: 0, marginTop: "2px" }} />
            )}
            <div>
              <h3 style={{ margin: "0 0 0.25rem 0" }}>
                {hasCollision ? "File Overlap Collision Detected" : "Clean Workstream Isolation — Zero Collisions"}
              </h3>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>
                {collision?.summary || (hasCollision
                  ? "Overlapping files detected across task branches. Host review required before merge."
                  : "All developer workstreams are modifying strictly non-overlapping files.")}
              </p>
              {hasCollision && collision?.collidingFiles && (
                <div style={{ marginTop: "0.5rem" }}>
                  <strong className="small">Overlapping Path(s):</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}>
                    {collision.collidingFiles.map((f, i) => (
                      <code key={i} style={{ fontSize: "0.8rem", background: "rgba(239, 68, 68, 0.1)", color: "#b91c1c", padding: "2px 6px", borderRadius: "4px" }}>
                        {f}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <Badge tone={hasCollision ? "red" : "green"}>
            {hasCollision ? "Collision Flagged" : "Safe to Integrate"}
          </Badge>
        </div>
      </div>

      {/* Verification Matrix */}
      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3>Automated Integration Checks</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Contract Conformance</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.25rem" }}>
              <Badge tone={release?.contractCheck === "passed" ? "green" : "amber"}>
                {release?.contractCheck || "pending"}
              </Badge>
            </div>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Build Status</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.25rem" }}>
              <Badge tone={release?.buildStatus === "passed" ? "green" : "red"}>
                {release?.buildStatus || "pending"}
              </Badge>
            </div>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Test Verification</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.25rem" }}>
              <Badge tone={release?.testStatus === "passed" ? "green" : "amber"}>
                {release?.testStatus || "pending"}
              </Badge>
            </div>
          </div>
          <div style={{ background: "var(--bg-accent, #f9fafb)", padding: "0.75rem", borderRadius: "6px" }}>
            <span className="small muted">Host Approval</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.25rem" }}>
              <Badge tone={release?.releaseApproved ? "green" : "neutral"}>
                {release?.releaseApproved ? "Approved" : "Pending Signature"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Release Gatekeeper & Deployment */}
      <div className="panel">
        <h3>Host Release Gatekeeper & Deployment</h3>
        <p className="small muted">
          Under the UD-IC/2.0 governance protocol, AI agents may prepare code, but only the authorized human Host can approve the final release.
        </p>

        {release?.deploymentStatus === "live" ? (
          <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "1.25rem", borderRadius: "8px", marginTop: "1rem" }}>
            <div className="row-between">
              <div>
                <span className="small" style={{ color: "#065f46", fontWeight: 600 }}>SYSTEM IS LIVE IN PRODUCTION</span>
                <h3 style={{ margin: "0.25rem 0", color: "#047857" }}>Deployment Verified & Active</h3>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>
                  Release signed by <strong>{release.releaseApprovedBy || "Host"}</strong>. Production assets served with zero contract regressions.
                </p>
                {release.deploymentUrl && (
                  <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
                    <a
                      href={release.deploymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button primary small"
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <ExternalLink size={14} />
                      Open Live Deployment ({release.deploymentUrl})
                    </a>
                  </p>
                )}
              </div>
              <Badge tone="green">LIVE</Badge>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {!release?.releaseApproved ? (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <input
                  type="text"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  placeholder="Host Full Name"
                  style={{ width: "240px" }}
                />
                <button
                  className="button primary"
                  onClick={() => onApproveRelease(approverName)}
                  disabled={hasCollision}
                >
                  <CheckCircle2 size={16} />
                  Approve Release as Host
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button
                  className="button primary"
                  onClick={onDeploy}
                  disabled={isDeploying}
                >
                  <Rocket size={16} />
                  {isDeploying ? "Deploying Assets..." : "Deploy to Production"}
                </button>
                <span className="small muted">
                  Approved by {release.releaseApprovedBy}. Ready for live release.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
