import { useState } from "react";
import { UserPlus, Copy, Check, Bot, Activity, Rocket } from "lucide-react";
import type { TeamMember } from "../api/hackathonApi";
import { Badge } from "../components/ui";

interface TeamHubProps {
  team: TeamMember[];
  developerCount: 2 | 3;
  projectStatus?: string;
  onInviteMember: (data: { name: string; role: string; assignedSlot: string; tool: string }) => Promise<{ inviteUrl: string; inviteToken: string }>;
  onJoinTeam: (data: { token: string; name: string; tool: string }) => Promise<void>;
  onStartMission?: () => Promise<void>;
}

export function TeamHub({ team, developerCount, projectStatus, onInviteMember, onJoinTeam, onStartMission }: TeamHubProps) {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [inviteForm, setInviteForm] = useState({ name: "Teammate", role: "member", assignedSlot: "developer-b", tool: "claude-code" });
  const [joinForm, setJoinForm] = useState({ token: "", name: "Arhaan Arora", tool: "claude-code" });

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await onInviteMember(inviteForm);
    setLastInviteUrl(`${window.location.origin}${res.inviteUrl}`);
  }

  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onJoinTeam(joinForm);
    setJoinModalOpen(false);
  }

  function copyInvite() {
    navigator.clipboard.writeText(lastInviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <div className="tab-pane">
      <div className="section-head">
        <div>
          <h2>Developer Team & AI Tool Hub</h2>
          <p className="muted">
            Configure {developerCount} developers with their preferred AI assistants (Antigravity, Claude Code, Codex, Cursor).
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {onStartMission && projectStatus !== "development" && projectStatus !== "released" && projectStatus !== "deployed" && (
            <button
              className="button primary"
              style={{ background: "#2563eb", borderColor: "#1d4ed8" }}
              onClick={() => void onStartMission()}
            >
              <Rocket size={16} />
              Start Mission
            </button>
          )}
          <button className="button secondary" onClick={() => setJoinModalOpen(true)}>
            Simulate Teammate Join
          </button>
          <button className="button primary" onClick={() => { setLastInviteUrl(""); setInviteModalOpen(true); }}>
            <UserPlus size={16} />
            Invite Developer
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        {team.map((member) => (
          <div key={member.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="row-between">
              <Badge tone={member.role === "host" ? "amber" : "violet"}>
                {member.role.toUpperCase()}
              </Badge>
              <span className="small muted">Slot: <code>{member.assignedSlot}</code></span>
            </div>

            <div>
              <h3 style={{ margin: "0.25rem 0" }}>{member.name}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.25rem" }}>
                <Bot size={14} color="#3b82f6" />
                <span className="small" style={{ fontWeight: 600 }}>{member.connectedTool.toUpperCase()}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "var(--text-muted, #6b7280)", marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--border-color, #f3f4f6)" }}>
              <Activity size={12} color="#10b981" />
              <span>Status: {member.isJoined ? "Active Session" : "Invitation Pending"}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="modal-backdrop" onClick={() => setInviteModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <h3>Invite Hackathon Teammate</h3>
            <p className="small muted">
              Generate a shareable link allowing another developer to join your workspace without local configuration.
            </p>

            {!lastInviteUrl ? (
              <form onSubmit={handleInviteSubmit} className="form-stack" style={{ marginTop: "1rem" }}>
                <label>
                  Teammate Name
                  <input
                    type="text"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    required
                  />
                </label>

                <label>
                  Assigned Slot
                  <select
                    value={inviteForm.assignedSlot}
                    onChange={(e) => setInviteForm({ ...inviteForm, assignedSlot: e.target.value })}
                  >
                    <option value="developer-b">Developer B (Backend / APIs)</option>
                    <option value="developer-c">Developer C (AI / Integration)</option>
                  </select>
                </label>

                <label>
                  Preferred AI Coding Tool
                  <select
                    value={inviteForm.tool}
                    onChange={(e) => setInviteForm({ ...inviteForm, tool: e.target.value })}
                  >
                    <option value="claude-code">Claude Code</option>
                    <option value="antigravity">Google Antigravity</option>
                    <option value="codex">OpenAI Codex</option>
                    <option value="cursor">Cursor</option>
                    <option value="aider">Aider</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                </label>

                <div className="form-actions">
                  <button type="button" className="button secondary" onClick={() => setInviteModalOpen(false)}>Cancel</button>
                  <button type="submit" className="button primary">Generate Invite Link</button>
                </div>
              </form>
            ) : (
              <div style={{ marginTop: "1rem" }}>
                <p className="small" style={{ fontWeight: 600, color: "#065f46" }}>Invite Link Created!</p>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <input type="text" readOnly value={lastInviteUrl} style={{ flex: 1, fontSize: "0.85rem" }} />
                  <button className="button primary" onClick={copyInvite}>
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    {copiedLink ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="form-actions" style={{ marginTop: "1.5rem" }}>
                  <button className="button secondary" onClick={() => setInviteModalOpen(false)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Join Simulation Modal */}
      {joinModalOpen && (
        <div className="modal-backdrop" onClick={() => setJoinModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
            <h3>Simulate Teammate Joining</h3>
            <p className="small muted">
              Paste an invite token to simulate another developer joining from a separate browser.
            </p>

            <form onSubmit={handleJoinSubmit} className="form-stack" style={{ marginTop: "1rem" }}>
              <label>
                Invite Token
                <input
                  type="text"
                  placeholder="inv-..."
                  value={joinForm.token}
                  onChange={(e) => setJoinForm({ ...joinForm, token: e.target.value })}
                  required
                />
              </label>

              <label>
                Teammate Name
                <input
                  type="text"
                  value={joinForm.name}
                  onChange={(e) => setJoinForm({ ...joinForm, name: e.target.value })}
                  required
                />
              </label>

              <div className="form-actions">
                <button type="button" className="button secondary" onClick={() => setJoinModalOpen(false)}>Cancel</button>
                <button type="submit" className="button primary">Join Workspace</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
