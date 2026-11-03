import React from "react";
import { IconCheck, IconX } from "./icons.tsx";
import type { PatchRecord } from "../services/api.ts";

interface PatchReviewModalProps {
  patch: PatchRecord;
  onApprove: (patchId: string) => Promise<void>;
  onReject: (patchId: string) => Promise<void>;
  onClose: () => void;
}

export function PatchReviewModal({ patch, onApprove, onReject, onClose }: PatchReviewModalProps) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: "20px",
    }}>
      <div style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "12px",
        padding: "24px",
        width: "100%",
        maxWidth: "720px",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.9)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
              Code Patch Review & Human Authorization
            </h3>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Task: <code>{patch.taskId}</code> | Patch ID: <code>{patch.id}</code>
            </div>
          </div>
          <span className="badge badge-amber">AWAITING APPROVAL</span>
        </div>

        {/* Diff Content */}
        <div style={{ flex: 1, overflowY: "auto", marginBottom: "16px" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px" }}>
            Proposed Unified Diff:
          </div>
          <div className="diff-box">
            {patch.diffContent.split("\n").map((line, idx) => {
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

          {patch.testOutput && (
            <div style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                Verification Test Execution Output:
              </div>
              <pre style={{
                backgroundColor: "#0b0f19",
                padding: "10px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                color: "#34d399",
                fontFamily: "monospace",
              }}>
                {patch.testOutput}
              </pre>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
          <button className="btn" onClick={onClose}>
            Close Preview
          </button>

          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn-danger" onClick={() => onReject(patch.id)}>
              <IconX className="w-4 h-4" /> Reject Patch
            </button>
            <button className="btn btn-success" onClick={() => onApprove(patch.id)}>
              <IconCheck className="w-4 h-4" /> ✓ Authorize & Apply Patch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
