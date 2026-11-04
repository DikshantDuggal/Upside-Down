import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  Bot,
  GitCompareArrows,
  GitPullRequest,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  RefreshCw,
  X,
  Lightbulb,
  Cpu,
  Layers,
  Users,
  Rocket,
  ArrowRightLeft,
} from "lucide-react";
import { useDashboard } from "./useDashboard";
import { useLocalSession } from "./useLocalSession";
import { LocalSessionCard, PairBrowser } from "../features/LocalSession";
import { errorMessage } from "../api/client";
import {
  type Command,
  type Conflict,
  type Patch,
} from "../api/types";
import { ActivityList } from "../features/Activity";
import { AgentCards } from "../features/Agents";
import { TaskDetail, TaskList, NewTask } from "../features/Tasks";
import { PatchDetail, PatchList } from "../features/patches";
import { ConflictDetail, ConflictList } from "../features/Conflicts";
import { Network } from "../features/Network";
import { Messages } from "../features/Messages";
import {
  CommandJournal,
  transitionBlocked,
  type Intent,
} from "../features/commands";
import {
  Badge,
  Notice,
  SectionHead,
} from "../components/ui";

// Upside-Down 2.0 Mission Control Features
import {
  hackathonApi,
  type HackathonProject,
  type ProjectIdea,
  type IdeaFeedbackMessage,
  type ArchitectureBlueprint,
  type TaskContractV2,
  type TeamMember,
  type CrossAgentHandoff,
  type IntegrationReleaseRecord,
} from "../api/hackathonApi";
import { ProjectOverview } from "../features/ProjectOverview";
import { IdeaStudio } from "../features/IdeaStudio";
import { ArchitectureView } from "../features/ArchitectureView";
import { HackathonTasks } from "../features/HackathonTasks";
import { TeamHub } from "../features/TeamHub";
import { HandoffsView } from "../features/HandoffsView";
import { IntegrationCenter } from "../features/IntegrationCenter";

const pages = [
  { id: "overview", label: "Mission Control", Icon: LayoutDashboard },
  { id: "ideas", label: "AI Idea Studio", Icon: Lightbulb },
  { id: "architecture", label: "Architecture Blueprint", Icon: Cpu },
  { id: "contracts", label: "Work Contracts (2.0)", Icon: Layers },
  { id: "team", label: "Team & Tools", Icon: Users },
  { id: "handoffs", label: "Agent Handoffs", Icon: ArrowRightLeft },
  { id: "integration", label: "Release & Deploy", Icon: Rocket },
  { id: "tasks", label: "Task List", Icon: ListTodo },
  { id: "agents", label: "Agent Registry", Icon: Bot },
  { id: "activity", label: "Activity Journal", Icon: Activity },
  { id: "reviews", label: "Patch reviews", Icon: GitPullRequest },
  { id: "conflicts", label: "Conflicts", Icon: GitCompareArrows },
  { id: "messages", label: "Team messages", Icon: MessageSquare },
  { id: "network", label: "Network & queue", Icon: ArrowDownUp },
] as const;

type Page = (typeof pages)[number]["id"];

const copy: Record<
  Page,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "AI HACKATHON MISSION CONTROL",
    title: "Good things happen together.",
    description: "Autonomous multi-agent orchestration from problem statement to deployable release.",
  },
  ideas: {
    eyebrow: "STAGE 1 — CONCEPT SYNTHESIS",
    title: "AI Idea Studio & Comparison Board",
    description: "Generate 3–5 distinct concepts, refine iteratively, and approve the winning direction.",
  },
  architecture: {
    eyebrow: "STAGE 2 — TECHNICAL BLUEPRINT",
    title: "Project Specification & API Contracts",
    description: "Concrete interface contracts, time-aware 7-phase roadmap, and host approval.",
  },
  contracts: {
    eyebrow: "STAGE 3 — MULTI-AGENT WORK DIVISION",
    title: "Task Contracts & Prompt Bridges",
    description: "Strict path boundary policies, tool bridges (Antigravity, Claude, Codex), and evidence gating.",
  },
  team: {
    eyebrow: "STAGE 4 — COLLABORATION HUB",
    title: "Developer Team & AI Tool Hub",
    description: "2–3 developer slots, mixed assistant tools, and shareable teammate invite links.",
  },
  handoffs: {
    eyebrow: "STAGE 5 — INTERFACE RECONCILIATION",
    title: "Cross-Agent Dependency Handoffs",
    description: "Structured requests when a frontend developer requires an API or schema from backend.",
  },
  integration: {
    eyebrow: "STAGE 6 — RELEASE & DEPLOY",
    title: "Collision Engine & Release Gatekeeper",
    description: "Automated file collision checks, contract conformance, host release approval, and deployment.",
  },
  tasks: {
    eyebrow: "MAKE PROGRESS VISIBLE",
    title: "A little clarity. A lot of progress.",
    description: "Canonical tasks and revisions, with local proposals kept separate.",
  },
  agents: {
    eyebrow: "YOUR EXTENDED TEAM",
    title: "Meet your collaborators.",
    description: "Live registry status, runtime availability, and assigned work.",
  },
  activity: {
    eyebrow: "THE WORKSPACE JOURNAL",
    title: "Every update has a story.",
    description: "Real events from the coordinator, with sources and timestamps.",
  },
  reviews: {
    eyebrow: "HUMAN JUDGMENT MATTERS",
    title: "A second look, before it lands.",
    description: "Proposed patches with unified diffs, test evidence, and reviewer sign-off.",
  },
  conflicts: {
    eyebrow: "SAFE RESOLUTION",
    title: "When two minds disagree.",
    description: "Conflicting mutations quarantined safely without silent data loss.",
  },
  messages: {
    eyebrow: "DIRECT COMMUNICATION",
    title: "Keep everyone in the loop.",
    description: "Coordinated handoffs and status updates across computers.",
  },
  network: {
    eyebrow: "CONNECTION STATUS",
    title: "Know where you stand.",
    description: "Local queue status, coordinator reachability, and sync diagnostics.",
  },
};

export function App() {
  const data = useDashboard();
  const localSession = useLocalSession();
  const [pairing, setPairing] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [patch, setPatch] = useState<Patch | undefined>();
  const [conflict, setConflict] = useState<Conflict | undefined>();
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  // --- UPSIDE-DOWN 2.0 HACKATHON STATE ---
  const [project, setProject] = useState<HackathonProject | null>(null);
  const [ideas, setIdeas] = useState<ProjectIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<ProjectIdea | null>(null);
  const [architecture, setArchitecture] = useState<ArchitectureBlueprint | null>(null);
  const [tasksV2, setTasksV2] = useState<TaskContractV2[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [handoffs, setHandoffs] = useState<CrossAgentHandoff[]>([]);
  const [release, setRelease] = useState<IntegrationReleaseRecord | null>(null);
  const [collision, setCollision] = useState<{ hasCollision: boolean; collidingFiles: string[]; tasksInvolved: string[]; summary: string } | null>(null);
  const [feedbackMessages, setFeedbackMessages] = useState<IdeaFeedbackMessage[]>([]);
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false);
  const [isApprovingArch, setIsApprovingArch] = useState(false);
  const [isDecomposing, setIsDecomposing] = useState(false);
  const [isCheckingIntegration, setIsCheckingIntegration] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [activeIdentity, setActiveIdentity] = useState<"host" | "developer-a" | "developer-b" | "developer-c">("host");

  const identityProfiles: Record<string, { name: string; tool: string; slot: string; role: string }> = {
    host: { name: "Dikshant Duggal (Host)", tool: "antigravity", slot: "host", role: "host" },
    "developer-a": { name: "Developer A (Frontend Lead)", tool: "antigravity", slot: "developer-a", role: "member" },
    "developer-b": { name: "Developer B (Backend Lead)", tool: "claude-code", slot: "developer-b", role: "member" },
    "developer-c": { name: "Developer C (AI Specialist)", tool: "cursor", slot: "developer-c", role: "member" },
  };

  const handleStartMission = async () => {
    if (!project) return;
    try {
      const res = await hackathonApi.startMission(project.id);
      setProject(res.project);
      setTasksV2(res.tasks);
      const teamRes = await hackathonApi.listTeam(project.id);
      setTeamMembers(teamRes.team);
      setNotice("🚀 MISSION STARTED! Multi-agent work contracts divided and assigned.");
      setPage("contracts");
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  // Load or initialize default Hackathon Project
  const loadProjectData = useCallback(async (projectId?: string) => {
    try {
      let targetId = projectId;
      if (!targetId) {
        const listRes = await hackathonApi.listProjects();
        if (listRes.projects && listRes.projects.length > 0) {
          targetId = listRes.projects[0].id;
        } else {
          // Initialize default project
          const created = await hackathonApi.createProject({
            name: "Autonomous Hackathon Mission Control",
            problemStatement: "Multi-agent coding collaboration suffers from fragmented context, merge conflicts, and uncoordinated task execution.",
            rules: "24-Hour Hackathon MVP. Open Source Stack.",
            availableTime: "24h",
            developerCount: 3,
            skillLevels: "Senior AI Developers",
            technologies: ["React 19", "Express", "SQLite", "TypeScript"],
            hostName: "Dikshant Duggal",
          });
          targetId = created.project.id;
        }
      }

      if (targetId) {
        const full = await hackathonApi.getProject(targetId);
        setProject(full.project);
        setIdeas(full.ideas || []);
        setSelectedIdea(full.selectedIdea || null);
        setArchitecture(full.architecture || null);
        setTasksV2(full.tasks || []);
        setTeamMembers(full.team || []);
        setHandoffs(full.handoffs || []);
        setRelease(full.release || null);

        // Load feedback messages
        const fbRes = await hackathonApi.getIdeaFeedback(targetId);
        setFeedbackMessages(fbRes.messages || []);
      }
    } catch (err) {
      console.error("Failed to load hackathon project data:", err);
    }
  }, []);

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  // Real-time Event Subscription (SSE)
  useEffect(() => {
    if (!project?.id) return;
    const unsubscribe = hackathonApi.subscribeEvents(project.id, (_event) => {
      void loadProjectData(project.id);
    });
    return () => unsubscribe();
  }, [project?.id, loadProjectData]);

  // Hackathon Action Handlers
  const handleCreateProject = async (formData: any) => {
    const res = await hackathonApi.createProject(formData);
    await loadProjectData(res.project.id);
    setNotice(`Created hackathon project: ${res.project.name}`);
  };

  const handleGenerateIdeas = async () => {
    if (!project) return;
    setIsGeneratingIdeas(true);
    try {
      const res = await hackathonApi.generateIdeas(project.id);
      setIdeas(res.ideas);
      setNotice(`Generated ${res.ideas.length} project concepts!`);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsGeneratingIdeas(false);
    }
  };

  const handleRefineIdeas = async (feedback: string) => {
    if (!project) return;
    try {
      const res = await hackathonApi.refineIdeas(project.id, feedback);
      setIdeas(res.ideas);
      const fb = await hackathonApi.getIdeaFeedback(project.id);
      setFeedbackMessages(fb.messages);
      setNotice("Ideas refined based on host feedback!");
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleSelectIdea = async (ideaId: string) => {
    if (!project) return;
    try {
      const res = await hackathonApi.selectIdea(project.id, ideaId);
      setSelectedIdea(res.selectedIdea);
      setNotice(`Selected concept: ${res.selectedIdea.name}. Generating architecture blueprint...`);
      // Auto-trigger architecture generation upon selection
      const archRes = await hackathonApi.generateArchitecture(project.id);
      setArchitecture(archRes.architecture);
      setPage("architecture");
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleApproveArchitecture = async (version: number) => {
    if (!project) return;
    setIsApprovingArch(true);
    try {
      const res = await hackathonApi.approveArchitecture(project.id, version);
      setArchitecture(res.architecture);
      setNotice("Architecture blueprint approved by Host! Decomposing task contracts...");
      // Auto-decompose task contracts for the chosen team size
      const taskRes = await hackathonApi.generateTasks(project.id);
      setTasksV2(taskRes.tasks);
      setPage("contracts");
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsApprovingArch(false);
    }
  };

  const handleGenerateTasks = async () => {
    if (!project) return;
    setIsDecomposing(true);
    try {
      const res = await hackathonApi.generateTasks(project.id);
      setTasksV2(res.tasks);
      setNotice(`Decomposed project into ${res.tasks.length} multi-agent work contracts!`);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsDecomposing(false);
    }
  };

  const handleClaimTask = async (taskId: string, memberName?: string, agentTool?: string) => {
    try {
      const profile = identityProfiles[activeIdentity] || identityProfiles.host;
      await hackathonApi.claimTask(taskId, {
        memberName: memberName || profile.name,
        agentTool: agentTool || profile.tool,
        assignedSlot: profile.slot,
      });
      if (project) await loadProjectData(project.id);
      setNotice(`Claimed task ${taskId} as ${profile.name}!`);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleUpdateProgress = async (taskId: string, status: string, progressPercent: number, blockerReason?: string) => {
    try {
      await hackathonApi.updateTaskProgress(taskId, { status, progressPercent, blockerReason });
      if (project) await loadProjectData(project.id);
      setNotice(`Updated task ${taskId} to ${status}`);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleSubmitEvidence = async (taskId: string, evidence: any) => {
    try {
      await hackathonApi.submitTaskEvidence(taskId, evidence);
      if (project) await loadProjectData(project.id);
      setNotice(`Evidence submitted for ${taskId}! Ready for Host Review.`);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleApproveTask = async (taskId: string) => {
    try {
      await hackathonApi.approveTask(taskId);
      if (project) await loadProjectData(project.id);
      setNotice(`Task ${taskId} approved and completed!`);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleFetchPromptBridge = async (taskId: string, tool: string) => {
    const res = await hackathonApi.getPromptBridge(taskId, tool);
    return res.prompt;
  };

  const handleInviteMember = async (memberData: any) => {
    if (!project) throw new Error("No active project");
    const res = await hackathonApi.inviteTeamMember(project.id, memberData);
    await loadProjectData(project.id);
    return res;
  };

  const handleJoinTeam = async (joinData: any) => {
    await hackathonApi.joinTeam(joinData);
    if (project) await loadProjectData(project.id);
    setNotice("Teammate joined workspace!");
  };

  const handleCreateHandoff = async (handoffData: any) => {
    if (!project) return;
    await hackathonApi.createHandoff(project.id, handoffData);
    await loadProjectData(project.id);
    setNotice("Cross-agent handoff request created!");
  };

  const handleResolveHandoff = async (handoffId: string, status: "resolved" | "rejected", notes?: string) => {
    await hackathonApi.resolveHandoff(handoffId, status, notes);
    if (project) await loadProjectData(project.id);
    setNotice(`Handoff ${status}!`);
  };

  const handleCheckIntegration = async () => {
    if (!project) return;
    setIsCheckingIntegration(true);
    try {
      const res = await hackathonApi.checkIntegration(project.id);
      setRelease(res.release);
      if (res.collisionCheck) setCollision(res.collisionCheck);
      if (project) await loadProjectData(project.id);
      setNotice("Collision check and integration verification complete!");
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsCheckingIntegration(false);
    }
  };

  const handleApproveRelease = async (approvedBy: string) => {
    if (!project) return;
    try {
      const res = await hackathonApi.approveRelease(project.id, approvedBy);
      setRelease(res.release);
      if (project) await loadProjectData(project.id);
      setNotice(`Release approved by ${approvedBy}! Production deployment ready.`);
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const handleDeploy = async () => {
    if (!project) return;
    setIsDeploying(true);
    try {
      const res = await hackathonApi.deployRelease(project.id);
      setRelease(res.release);
      if (project) await loadProjectData(project.id);
      setNotice("Deployment live in production!");
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  // Legacy Command & Session Helpers
  const [intents, setIntents] = useState<Intent[]>([]);
  const [storageError, setStorageError] = useState<string>();
  const journal = useMemo(
    () => (data.local ? new CommandJournal(data.local.deviceId) : undefined),
    [data.local?.deviceId],
  );

  useEffect(() => {
    if (!journal) return;
    let cancelled = false;
    try {
      setIntents(journal.read());
      setStorageError(undefined);
    } catch (err) {
      setStorageError(errorMessage(err));
    }
    void journal
      .reconcile(data.pending)
      .then((value) => {
        if (!cancelled) setIntents(value);
      })
      .catch((err) => {
        if (!cancelled) setStorageError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [journal, data.pending]);

  const unavailable = !journal
    ? "The local service is unavailable. No command has been queued."
    : localSession.status !== "paired" && localSession.status !== "unsupported"
      ? "Pair this browser with the local service before submitting a command."
      : storageError
        ? "Browser retry records could not be saved. Resolve storage access before submitting."
        : undefined;

  const submit = useCallback(
    async (command: Command) => {
      if (!journal || unavailable)
        throw new Error(unavailable ?? "The local service is unavailable.");
      setActionError("");
      if (
        command.type === "task.transition" &&
        transitionBlocked(
          command.taskId,
          data.pending,
          journal.read(),
          data.tasks.find((task) => task.id === command.taskId)?.revision,
        )
      ) {
        throw new Error(
          "Wait for the previous acknowledgement and current task revision before proposing another transition.",
        );
      }
      let intent: Intent;
      try {
        intent = journal.prepare(command);
      } catch (err) {
        setStorageError(errorMessage(err));
        throw err;
      }
      try {
        setIntents(
          journal
            .read()
            .map((value) =>
              value.key === intent.key
                ? { ...value, delivery: "unknown" }
                : value,
            ),
        );
        const result = await journal.submit(intent);
        setIntents(journal.read());
        setNotice(
          `Local service accepted ${command.type}. Receipt: ${result.receipt?.state ?? "queued"}. Coordinator delivery is tracked in Network & queue.`,
        );
        void data.refresh();
      } catch (err) {
        setIntents(journal.read());
        throw err;
      }
    },
    [journal, unavailable, data.refresh, data.pending, data.tasks],
  );

  async function retry(intent: Intent) {
    if (!journal || unavailable) {
      setActionError(unavailable ?? "No local service.");
      return;
    }
    try {
      await journal.submit(intent);
      setIntents(journal.read());
      setNotice("The original request was retried with its existing key.");
      await data.refresh();
    } catch (err) {
      setActionError(errorMessage(err));
      setIntents(journal.read());
    }
  }

  const navigate = (to: Page) => {
    setPage(to);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectedTask = useMemo(
    () => data.tasks.find((task) => task.id === taskId),
    [data.tasks, taskId],
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <button
            className="menu-button"
            aria-label="Toggle navigation menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={20} />
          </button>
          <div className="brand" onClick={() => navigate("overview")} style={{ cursor: "pointer" }}>
            <span className="brand-mark">↕</span>
            <span className="brand-name">UPSIDE DOWN 2.0</span>
            <span className="brand-tag">MISSION CONTROL</span>
          </div>
        </div>

        <div className="header-actions">
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="small muted">View as:</span>
            <select
              value={activeIdentity}
              onChange={(e) => setActiveIdentity(e.target.value as any)}
              style={{
                fontSize: "0.85rem",
                padding: "3px 8px",
                borderRadius: "6px",
                border: "1px solid var(--border-color, #d1d5db)",
                background: "var(--bg-card, #ffffff)",
                color: "var(--text-primary, #111827)",
                fontWeight: 500,
              }}
            >
              <option value="host">👑 Host (Dikshant Duggal)</option>
              <option value="developer-a">💻 Dev A (Frontend / Antigravity)</option>
              <option value="developer-b">⚙️ Dev B (Backend / Claude Code)</option>
              <option value="developer-c">🧠 Dev C (AI / Cursor)</option>
            </select>
          </div>
          {project && (
            <span className="small muted">
              Project: <strong>{project.name}</strong>
            </span>
          )}
          <Badge tone={release?.deploymentStatus === "live" ? "green" : "violet"}>
            {release?.deploymentStatus === "live" ? "LIVE PROD" : project ? project.status.toUpperCase() : "READY"}
          </Badge>
          <button
            className="button secondary small"
            onClick={() => void loadProjectData(project?.id)}
            title="Refresh workspace state"
          >
            <RefreshCw size={14} className={data.refreshing ? "spin" : ""} />
            Sync
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className={`app-nav ${menuOpen ? "open" : ""}`}>
          <div className="nav-header">
            <span className="eyebrow">MISSION CONTROL</span>
          </div>
          <nav className="nav-list">
            {pages.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? "active" : ""}`}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {id === "ideas" && selectedIdea && <span className="nav-pill green">✓</span>}
                {id === "contracts" && tasksV2.length > 0 && <span className="nav-pill">{tasksV2.length}</span>}
                {id === "integration" && release?.deploymentStatus === "live" && <span className="nav-pill green">Live</span>}
              </button>
            ))}
          </nav>
        </aside>

        <main className="app-content">
          <div className="content-hero">
            <div>
              <span className="eyebrow">{copy[page].eyebrow}</span>
              <h1>{copy[page].title}</h1>
              <p className="hero-description">{copy[page].description}</p>
            </div>
          </div>

          {notice && (
            <div className="notice dismissible" role="status">
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {actionError && <Notice danger>{actionError}</Notice>}

          {/* ================= PAGES ================= */}

          {page === "overview" && (
            <ProjectOverview
              project={project}
              selectedIdea={selectedIdea}
              architecture={architecture}
              tasks={tasksV2}
              release={release}
              onCreateProject={handleCreateProject}
              onNavigateTab={navigate}
              onStartMission={handleStartMission}
            />
          )}

          {page === "ideas" && (
            <IdeaStudio
              ideas={ideas}
              selectedIdea={selectedIdea}
              feedbackMessages={feedbackMessages}
              onGenerate={handleGenerateIdeas}
              onRefine={handleRefineIdeas}
              onSelect={handleSelectIdea}
              isGenerating={isGeneratingIdeas}
            />
          )}

          {page === "architecture" && (
            <ArchitectureView
              architecture={architecture}
              onApprove={handleApproveArchitecture}
              isApproving={isApprovingArch}
            />
          )}

          {page === "contracts" && (
            <HackathonTasks
              tasks={tasksV2}
              onGenerateTasks={handleGenerateTasks}
              onClaimTask={handleClaimTask}
              onUpdateProgress={handleUpdateProgress}
              onSubmitEvidence={handleSubmitEvidence}
              onApproveTask={handleApproveTask}
              onFetchPromptBridge={handleFetchPromptBridge}
              isGenerating={isDecomposing}
            />
          )}

          {page === "team" && (
            <TeamHub
              team={teamMembers}
              developerCount={project?.developerCount || 3}
              projectStatus={project?.status}
              onInviteMember={handleInviteMember}
              onJoinTeam={handleJoinTeam}
              onStartMission={handleStartMission}
            />
          )}

          {page === "handoffs" && (
            <HandoffsView
              handoffs={handoffs}
              tasks={tasksV2}
              onCreateHandoff={handleCreateHandoff}
              onResolveHandoff={handleResolveHandoff}
            />
          )}

          {page === "integration" && (
            <IntegrationCenter
              release={release}
              collision={collision}
              onCheckIntegration={handleCheckIntegration}
              onApproveRelease={handleApproveRelease}
              onDeploy={handleDeploy}
              isChecking={isCheckingIntegration}
              isDeploying={isDeploying}
            />
          )}

          {/* Legacy Screens (Preserved for backwards compatibility & tests) */}
          {page === "tasks" && (
            <section className="panel">
              <TaskList
                tasks={data.tasks}
                agents={data.agents}
                selectTask={setTaskId}
              />
            </section>
          )}

          {page === "agents" && (
            <>
              <AgentCards agents={data.agents} selectTask={setTaskId} />
              <Notice>
                A registered or running agent is not proof of LLM execution. The
                current supported provider is bounded heuristic repair.
              </Notice>
            </>
          )}

          {page === "activity" && (
            <section className="panel activity-full">
              <div className="panel-head">
                <SectionHead title="Activity journal">
                  <span className="muted small">
                    Most recent {data.events.length} loaded events
                  </span>
                </SectionHead>
              </div>
              <ActivityList events={data.events} selectTask={setTaskId} />
            </section>
          )}

          {page === "reviews" && (
            <>
              <div className="panel">
                <div className="panel-head">
                  <SectionHead title="Patch proposals">
                    <Badge>
                      {data.capabilities?.patchCompletionMode ?? "legacy_decision"}
                    </Badge>
                  </SectionHead>
                </div>
                <PatchList patches={data.patches} open={setPatch} />
              </div>
            </>
          )}

          {page === "conflicts" && (
            <ConflictList conflicts={data.conflicts} open={setConflict} />
          )}

          {page === "messages" && (
            <Messages
              messages={data.messages}
              submit={submit}
              unavailable={unavailable}
            />
          )}

          {page === "network" && (
            <>
              <LocalSessionCard
                session={localSession}
                open={() => setPairing(true)}
              />
              <Network
                data={data}
                intents={intents}
                storageError={storageError}
                retry={(intent) => void retry(intent)}
              />
            </>
          )}

          <footer className="page-footer">
            <span>
              <span className="brand-mini">↕</span> UPSIDE DOWN 2.0
            </span>
            <span>AI Hackathon Mission Control • Web-First Hosted Platform</span>
            <span>UD-IC/2.0</span>
          </footer>
        </main>
      </div>

      {creating && (
        <NewTask
          close={() => setCreating(false)}
          submit={submit}
          unavailable={unavailable}
        />
      )}
      {selectedTask && (
        <TaskDetail
          key={selectedTask.id}
          task={selectedTask}
          data={data}
          intents={intents}
          openPatch={(value) => {
            setTaskId(undefined);
            setPatch(value);
          }}
          close={() => setTaskId(undefined)}
          submit={submit}
        />
      )}
      {patch && (
        <PatchDetail
          key={patch.id}
          patch={patch}
          data={data}
          close={() => setPatch(undefined)}
        />
      )}
      {conflict && (
        <ConflictDetail
          key={conflict.id}
          conflict={conflict}
          data={data}
          close={() => setConflict(undefined)}
        />
      )}
      {pairing && (
        <PairBrowser pair={localSession.pair} close={() => setPairing(false)} />
      )}
    </div>
  );
}
