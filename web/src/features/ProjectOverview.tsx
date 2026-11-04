import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Clock3, GitBranch, Layers3, Plus, Rocket, Users, ShieldCheck, X, Sparkles } from 'lucide-react';
import type { HackathonProject, ProjectIdea, ArchitectureBlueprint, TaskContractV2, IntegrationReleaseRecord } from '../api/hackathonApi';

interface Props {
  project: HackathonProject | null;
  selectedIdea: ProjectIdea | null;
  architecture: ArchitectureBlueprint | null;
  tasks: TaskContractV2[];
  release: IntegrationReleaseRecord | null;
  onCreateProject: (data: {
    name: string;
    problemStatement: string;
    availableTime?: string;
    developerCount?: 2 | 3;
    technologies?: string[];
    hostName?: string;
  }) => Promise<void>;
  onNavigateTab: (tab: any) => void;
  onStartMission?: () => Promise<void>;
}

const presets = [
  {
    label: "🤖 AI Multi-Agent Mission Control",
    name: "Autonomous Hackathon Mission Control",
    problem: "Multi-agent coding collaboration suffers from fragmented context, merge conflicts, and uncoordinated task execution.",
    tech: "React 19, Express, SQLite, TypeScript",
    time: "24h",
    devs: 3 as const,
  },
  {
    label: "🏥 Emergency HealthTech Triage",
    name: "Smart MedBridge Triage Protocol",
    problem: "Emergency room crowding and delayed specialist handoffs result in preventable patient complications.",
    tech: "React 19, Node.js, SQLite, WebSockets",
    time: "24h",
    devs: 2 as const,
  },
  {
    label: "💳 High-Velocity FinTech Fraud Shield",
    name: "FraudSentinel Real-Time Anomaly Engine",
    problem: "Cross-border financial transactions and high-frequency payments suffer from delayed fraud detection and high false-positive rates.",
    tech: "React 19, Express, SQLite, Redis",
    time: "24h",
    devs: 3 as const,
  },
  {
    label: "📚 Adaptive EdTech Learning Graph",
    name: "CogniLearn Real-Time Learning Graph",
    problem: "Students drop out of technical courses due to one-size-fits-all curricula that fail to pinpoint exact knowledge gaps.",
    tech: "React 19, Node.js, SQLite, D3.js",
    time: "12h",
    devs: 2 as const,
  },
  {
    label: "🌱 Decentralized CleanTech Energy Grid",
    name: "GreenGrid Decentralized Energy Hub",
    problem: "Localized solar and battery storage owners lack automated peer-to-peer energy routing to offset neighborhood peak demand.",
    tech: "React 19, Express, SQLite, IoT Telemetry",
    time: "24h",
    devs: 3 as const,
  },
];

export function ProjectOverview({
  project,
  selectedIdea,
  architecture,
  tasks,
  release,
  onCreateProject,
  onNavigateTab,
  onStartMission,
}: Props) {
  const [newProject, setNewProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null);

  const [form, setForm] = useState({
    name: '',
    problemStatement: '',
    availableTime: '24h',
    developerCount: 3 as 2 | 3,
    technologies: 'React 19, TypeScript, Express, SQLite',
    hostName: 'Dikshant Duggal',
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (newProject) {
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [newProject]);

  const hours = Number(project?.availableTime.match(/^(\d+(?:\.\d+)?)h$/)?.[1]);
  const remaining = project && hours ? Math.max(0, Date.parse(project.createdAt) + hours * 3600000 - now) : null;
  const timeLabel = remaining === null ? 'Set your timeline' : remaining === 0 ? 'Time window ended' : `${Math.floor(remaining / 3600000)}h ${Math.floor(remaining / 60000) % 60}m remaining`;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const running = tasks.filter((t) => t.status === 'in_progress').length;
  const progress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progressPercent ?? 0), 0) / tasks.length) : 0;

  const steps = [
    { page: 'ideas', name: 'Shape the idea', detail: selectedIdea ? selectedIdea.name : 'Generate 3–5 concepts', complete: !!selectedIdea },
    { page: 'architecture', name: 'Design the system', detail: architecture?.isApproved ? 'Blueprint approved' : 'Review technical spec', complete: !!architecture?.isApproved },
    { page: 'contracts', name: 'Divide the work', detail: tasks.length ? `${tasks.length} active contracts` : 'Assign path bounds', complete: tasks.length > 0 },
    { page: 'github', name: 'Build together', detail: 'Coordinate on GitHub', complete: done > 0 },
    { page: 'integration', name: 'Review & ship', detail: release?.deploymentStatus === 'live' ? 'Live in production' : 'Collision & deploy check', complete: release?.deploymentStatus === 'live' },
  ];

  const next = !selectedIdea ? 'ideas' : !architecture?.isApproved ? 'architecture' : !tasks.length ? 'contracts' : 'github';

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onCreateProject({
        ...form,
        technologies: form.technologies.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setNewProject(false);
      onNavigateTab('ideas');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create project');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overview-space">
      <section className="mission-hero">
        <div className="mission-copy">
          <div className="mission-meta">
            <span className="live-dot" />
            <span>AI HACKATHON MISSION CONTROL</span>
            <span className="badge badge-violet">{project?.status ?? 'new mission'}</span>
          </div>
          <h2>{project?.name ?? 'Your next big idea starts here.'}</h2>
          <p>{project?.problemStatement ?? 'Bring your team, connect your tools, and turn a shared idea into something worth shipping.'}</p>
          <div className="hero-actions">
            {architecture?.isApproved && tasks.length === 0 && onStartMission ? (
              <button
                className="button primary"
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await onStartMission();
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                <Rocket size={16} /> {starting ? 'Starting Mission…' : '🚀 Start Mission'}
              </button>
            ) : (
              <button className="button primary" onClick={() => onNavigateTab(next)}>
                Continue mission <ArrowRight size={16} />
              </button>
            )}
            <button className="button secondary" onClick={() => setNewProject(true)}>
              <Plus size={16} /> New Project
            </button>
          </div>
          <div className="mission-footnote">
            <Clock3 size={14} />
            {timeLabel}
            <span>·</span>
            <span>{project?.developerCount ?? 0} developer slots</span>
            <span>·</span>
            <span className="muted">{project?.technologies?.slice(0, 3).join(', ')}</span>
          </div>
        </div>
        <div className="mission-orbit" aria-hidden="true">
          <div className="orbit-ring ring-two" />
          <div className="orbit-ring" />
          <span className="orbit-node node-plan"><Layers3 size={19} /></span>
          <span className="orbit-node node-code"><GitBranch size={19} /></span>
          <span className="orbit-node node-check"><ShieldCheck size={19} /></span>
          <div className="orbit-core"><GitBranch size={42} /></div>
          <span className="orbit-caption">ONE VISION. SHARED CONTEXT.</span>
        </div>
      </section>

      <div className="mission-stats">
        <article className="metric-card">
          <div className="metric-label">Mission progress <Layers3 size={17} /></div>
          <strong>{progress}<small>%</small></strong>
          <div className="progress-track"><span style={{ width: progress + '%' }} /></div>
          <p>{done} of {tasks.length} contracts completed</p>
        </article>
        <article className="metric-card">
          <div className="metric-label">Team capacity <Users size={17} /></div>
          <strong>{project?.developerCount ?? 0}<small> developers</small></strong>
          <p>Multi-tool AI coding: Antigravity, Claude, Codex, Cursor.</p>
        </article>
        <article className="metric-card">
          <div className="metric-label">Work in motion <GitBranch size={17} /></div>
          <strong>{running}<small> active tasks</small></strong>
          <p>{tasks.filter((t) => t.status === 'blocked').length} blocked · {tasks.filter((t) => t.status === 'in_review').length} awaiting review</p>
        </article>
        <article className="metric-card">
          <div className="metric-label">Release status <ShieldCheck size={17} /></div>
          <strong className="metric-status">{release?.deploymentStatus === 'live' ? 'Live' : release ? 'Review required' : 'Not checked'}</strong>
          <p>{release ? 'Collision engine verified. Safe for production.' : 'Run integration checks before host release sign-off.'}</p>
        </article>
      </div>

      <section className="panel journey-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">FROM PROBLEM TO DEPLOYMENT</span>
            <h2>Your mission, step by step</h2>
          </div>
          <span className="small muted">{steps.filter((s) => s.complete).length} / 5 milestones</span>
        </div>
        <div className="mission-steps">
          {steps.map((s, i) => (
            <button
              className={'mission-step ' + (s.complete ? 'complete ' : s.page === next ? 'current' : '')}
              key={s.page}
              onClick={() => onNavigateTab(s.page)}
            >
              <span className="step-number">{s.complete ? <Check size={17} /> : String(i + 1).padStart(2, '0')}</span>
              <strong>{s.name}</strong>
              <span>{s.detail}</span>
              <ArrowUpRight size={14} className="step-arrow" />
            </button>
          ))}
        </div>
      </section>

      <div className="overview-bottom">
        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">THE NORTH STAR</span>
              <h2>{selectedIdea ? selectedIdea.name : 'Make room for a great idea'}</h2>
            </div>
            <Layers3 size={20} />
          </div>
          <p className="muted">
            {selectedIdea ? selectedIdea.pitch : 'Start with your problem statement. Explore concepts, refine the scope, and choose what your team will build.'}
          </p>
          {selectedIdea && (
            <div style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              <span className="small" style={{ fontWeight: 600 }}>USP: </span>
              <span className="small muted">{selectedIdea.usp}</span>
            </div>
          )}
          <button className="text-button" onClick={() => onNavigateTab('ideas')}>
            {selectedIdea ? 'Review selected concept' : 'Open Idea Studio'} <ArrowRight size={15} />
          </button>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">GITHUB-NATIVE MULTI-AGENT HUB</span>
              <h2>Every handoff has a home.</h2>
            </div>
            <GitBranch size={20} />
          </div>
          <p className="muted">
            Assignments, progress, and prompt bridges live together on GitHub. Zero merge conflicts with isolated path boundaries.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="text-button" onClick={() => onNavigateTab('github')}>
              Open communication center <ArrowRight size={15} />
            </button>
            {architecture?.isApproved && onStartMission && project?.status !== 'development' && (
              <button
                className="button secondary small"
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await onStartMission();
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                <Rocket size={14} />
                {starting ? 'Starting…' : 'Start Mission'}
              </button>
            )}
          </div>
        </section>
      </div>

      {newProject && (
        <dialog
          ref={dialog}
          className="project-dialog"
          aria-labelledby="new-project-title"
          onCancel={() => setNewProject(false)}
        >
          <div className="section-head">
            <div>
              <span className="eyebrow">A FRESH START</span>
              <h2 id="new-project-title">Create a new hackathon project</h2>
            </div>
            <button className="icon-button" aria-label="Close new project" onClick={() => setNewProject(false)}>
              <X size={20} />
            </button>
          </div>
          <p className="muted">Define the problem statement. The AI will synthesize 3–5 tailored concepts, architecture specs, and work contracts.</p>

          {/* Quick Problem Statement Presets */}
          <div style={{ margin: '0.75rem 0 1rem 0' }}>
            <span className="small muted" style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              <Sparkles size={13} style={{ display: 'inline', marginRight: '4px' }} />
              Quick Inspiration Presets (Click to Load):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="button secondary small"
                  style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                  onClick={() =>
                    setForm({
                      name: p.name,
                      problemStatement: p.problem,
                      availableTime: p.time,
                      developerCount: p.devs,
                      technologies: p.tech,
                      hostName: form.hostName || 'Dikshant Duggal',
                    })
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <form className="form-stack" onSubmit={create}>
            <label>
              Project Name
              <input
                autoFocus
                required
                value={form.name}
                placeholder="E.g., Autonomous Hackathon Mission Control"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Problem Statement
              <textarea
                required
                rows={3}
                value={form.problemStatement}
                placeholder="What challenge does this project solve? E.g., Multi-agent developers suffer from merge conflicts..."
                onChange={(e) => setForm({ ...form, problemStatement: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Hackathon Time
                <select value={form.availableTime} onChange={(e) => setForm({ ...form, availableTime: e.target.value })}>
                  <option value="12h">12 hours</option>
                  <option value="24h">24 hours</option>
                  <option value="48h">48 hours</option>
                </select>
              </label>
              <label>
                Developer Team Size
                <select
                  value={form.developerCount}
                  onChange={(e) => setForm({ ...form, developerCount: Number(e.target.value) as 2 | 3 })}
                >
                  <option value={2}>2 developers</option>
                  <option value={3}>3 developers</option>
                </select>
              </label>
            </div>
            <label>
              Allowed Technologies
              <input
                value={form.technologies}
                onChange={(e) => setForm({ ...form, technologies: e.target.value })}
                placeholder="React 19, TypeScript, Express, SQLite"
              />
            </label>
            <label>
              Host Developer Name
              <input
                required
                value={form.hostName}
                onChange={(e) => setForm({ ...form, hostName: e.target.value })}
              />
            </label>
            {error && (
              <p className="notice notice-danger" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setNewProject(false)}>
                Cancel
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? 'Creating workspace…' : 'Initialize Hackathon Workspace'}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
