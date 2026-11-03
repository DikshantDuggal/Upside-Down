import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command as CommandIcon,
  FileCode2,
  GitCompareArrows,
  GitPullRequest,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import { useDashboard } from "./useDashboard";
import { useLocalSession } from "./useLocalSession";
import { LocalSessionCard, PairBrowser } from "../features/LocalSession";
import { errorMessage, idPath, request } from "../api/client";
import {
  patchSchema,
  type Command,
  type Conflict,
  type Patch,
} from "../api/types";
import { useBrowserSession } from "../api/session";
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
  Modal,
  Notice,
  PanelLink,
  SectionHead,
  Timestamp,
} from "../components/ui";

const pages = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", Icon: ListTodo },
  { id: "agents", label: "Agents", Icon: Bot },
  { id: "activity", label: "Activity", Icon: Activity },
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
    eyebrow: "YOUR LOCAL-FIRST WORKSPACE",
    title: "Good things happen together.",
    description:
      "One place for your team, your agents, and everything in motion.",
  },
  tasks: {
    eyebrow: "MAKE PROGRESS VISIBLE",
    title: "A little clarity. A lot of progress.",
    description:
      "Canonical tasks and revisions, with local proposals kept separate.",
  },
  agents: {
    eyebrow: "YOUR EXTENDED TEAM",
    title: "Meet your collaborators.",
    description:
      "Live registry status, runtime availability, and assigned work.",
  },
  activity: {
    eyebrow: "THE WORKSPACE JOURNAL",
    title: "Every update has a story.",
    description:
      "Real events from the coordinator, with sources and timestamps.",
  },
  reviews: {
    eyebrow: "HUMAN JUDGMENT MATTERS",
    title: "A second look, before it lands.",
    description:
      "Inspect code, record a decision, and verify application separately.",
  },
  conflicts: {
    eyebrow: "KEEP EVERYONE ALIGNED",
    title: "Different versions. One way forward.",
    description: "Compare proposals with current state and resolve with care.",
  },
  messages: {
    eyebrow: "WORK BETTER, TOGETHER",
    title: "Keep the conversation moving.",
    description: "Team updates over your local network, even without internet.",
  },
  network: {
    eyebrow: "LOCAL FIRST. ALWAYS CLEAR.",
    title: "Know where things stand.",
    description:
      "Connectivity, cache freshness, and every command’s delivery state.",
  },
};
function initialPage(): Page {
  const value = window.location.hash.slice(1);
  return pages.some((page) => page.id === value) ? (value as Page) : "overview";
}

export function App() {
  const data = useDashboard();
  const session = useBrowserSession();
  const localSession = useLocalSession();
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    if (session.csrfToken) void data.refresh();
  }, [session.csrfToken, data.refresh]);
  const [page, setPage] = useState<Page>(initialPage);
  const [sidebar, setSidebar] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [patch, setPatch] = useState<Patch>();
  const [conflict, setConflict] = useState<Conflict>();
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [storageError, setStorageError] = useState<string>();
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [patchId, setPatchId] = useState("");
  const [patchLoading, setPatchLoading] = useState(false);
  const journal = useMemo(
    () => (data.local ? new CommandJournal(data.local.deviceId) : undefined),
    [data.local?.deviceId],
  );
  useEffect(() => {
    const changed = () => {
      setPage(initialPage());
      setSidebar(false);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
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
  const navigate = (next: Page) => {
    window.location.hash = next;
    setPage(next);
    setSidebar(false);
  };
  const unavailable = !journal
    ? "The local service is unavailable. No command has been queued."
    : !session.csrfToken
      ? "Pair this browser with the local service to submit commands."
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
  async function loadPatch() {
    if (!patchId.trim()) return;
    setPatchLoading(true);
    setActionError("");
    try {
      setPatch(
        (
          await request(`/api/patches/${idPath(patchId.trim())}`, patchSchema, {
            versioned: false,
          })
        ).value,
      );
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPatchLoading(false);
    }
  }
  const selectedTask = data.tasks.find((task) => task.id === taskId);
  const taskStatusCounts = Object.fromEntries(
    [
      "pending",
      "assigned",
      "running",
      "review",
      "done",
      "blocked",
      "failed",
    ].map((status) => [
      status,
      data.tasks.filter((task) => task.status === status).length,
    ]),
  );
  const activeAgents = data.agents.filter(
    (agent) => agent.status === "running",
  ).length;
  const openConflicts = data.conflicts.filter(
    (item) => item.status === "open",
  ).length;
  const pendingCount = data.local?.health.pendingCount;
  const reviewCount = data.patches.filter(
    (item) => item.status === "pending",
  ).length;
  const stats = [
    {
      label: "Total tasks",
      value: data.tasks.length,
      Icon: ListTodo,
      detail: `${taskStatusCounts.running} running`,
      tone: "sage",
      to: "tasks" as Page,
    },
    {
      label: "Registered agents",
      value: data.agents.length,
      Icon: Bot,
      detail: `${activeAgents} reporting running`,
      tone: "lavender",
      to: "agents" as Page,
    },
    {
      label: "Awaiting review",
      value: reviewCount,
      Icon: GitPullRequest,
      detail: "Human decisions",
      tone: "peach",
      to: "reviews" as Page,
    },
    {
      label: "Pending delivery",
      value: pendingCount ?? "—",
      Icon: ArrowDownUp,
      detail:
        pendingCount === undefined
          ? "Local service unavailable"
          : `${openConflicts} open conflicts`,
      tone: "blue",
      to: "network" as Page,
    },
  ];
  return (
    <div className="workspace">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to workspace
      </a>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
        <a className="brand" href="#overview" aria-label="Upside Down overview">
          <span className="brand-symbol">
            <span />
            <span />
          </span>
          <span>
            upside
            <span className="brand-down">
              down<span className="brand-period">.</span>
            </span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">U</span>
          <div>
            <strong>Team workspace</strong>
            <span>Local-first collaboration</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace">
          {pages.map(({ id, label, Icon }) => (
            <a
              href={`#${id}`}
              key={id}
              className={`nav-item ${page === id ? "nav-active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              aria-label={label}
              onClick={() => setSidebar(false)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "conflicts" && openConflicts > 0 && (
                <span className="nav-count">{openConflicts}</span>
              )}
              {id === "reviews" && reviewCount > 0 && (
                <span className="nav-count">{reviewCount}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-note-icon">
              <Wifi size={18} />
            </span>
            <strong>Built for your network.</strong>
            <p>Your LAN keeps working when the internet takes a break.</p>
            <button onClick={() => navigate("network")}>
              Connection details
              <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Workspace guide
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">T</span>
            <div>
              <strong>Your team</strong>
              <span>
                {data.local
                  ? `Device ${data.local.deviceId.slice(0, 8)}`
                  : "No local device connected"}
              </span>
            </div>
            <span
              className={`connection-dot ${data.coordinator ? "dot-green" : "dot-amber"}`}
            />
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{pages.find((item) => item.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="connection-button"
              onClick={() => navigate("network")}
            >
              <span
                className={`connection-dot ${data.coordinator ? "dot-green" : "dot-amber"}`}
              />
              {data.coordinator
                ? "Coordinator connected"
                : data.loading
                  ? "Connecting…"
                  : "Coordinator unavailable"}
            </button>
            <span className="topbar-divider" />
            <button
              className={`icon-button ${data.refreshing ? "is-refreshing" : ""}`}
              aria-label="Refresh workspace"
              disabled={data.refreshing}
              onClick={() => void data.refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <span className="topbar-avatar" title="Team workspace">
              U
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{copy[page].eyebrow}</div>
              <h1>{copy[page].title}</h1>
              <p>{copy[page].description}</p>
            </div>
            <button
              className="button primary new-task"
              onClick={() => setCreating(true)}
            >
              <Plus size={17} />
              New task
            </button>
          </div>
          <div className="status-strip">
            <div>
              <span
                className={`connection-dot ${data.stale ? "dot-amber" : "dot-green"}`}
              />
              <span>
                {data.loading
                  ? "Loading workspace"
                  : data.stale
                    ? "Stale or unavailable snapshot"
                    : "Snapshot refreshed"}
                {data.refreshedAt && (
                  <>
                    {" "}
                    · <Timestamp value={data.refreshedAt} />
                  </>
                )}
              </span>
            </div>
            <button className="inline-link" onClick={() => navigate("network")}>
              {data.mode === "local"
                ? "Local service"
                : data.mode === "legacy"
                  ? "Legacy read mode"
                  : "Services unavailable"}
              <ArrowUpRight size={13} />
            </button>
          </div>
          {localSession.status === "required" && (
            <Notice>
              Pair this browser to open the local workspace.{" "}
              <button className="inline-link" onClick={() => setPairing(true)}>
                Pair browser
              </button>
            </Notice>
          )}
          {data.error && <Notice danger>{data.error}</Notice>}
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
          {data.historyGap && (
            <Notice>
              Activity history may have gaps after reconnection. Task and agent
              snapshots are refreshed; legacy timestamp history does not
              guarantee complete replay.
            </Notice>
          )}
          {page === "overview" && (
            <>
              <div className="stats-grid">
                {stats.map(({ label, value, Icon, detail, tone, to }) => (
                  <button
                    className="stat-card"
                    key={label}
                    onClick={() => navigate(to)}
                  >
                    <div className="stat-top">
                      <span>{label}</span>
                      <span className={`stat-icon stat-${tone}`}>
                        <Icon size={18} />
                      </span>
                    </div>
                    <strong className="stat-value">
                      {data.loading || (!data.refreshedAt && !data.local)
                        ? "—"
                        : value}
                    </strong>
                    <div className="stat-footer">
                      <span>{detail}</span>
                      <ArrowUpRight size={14} />
                    </div>
                  </button>
                ))}
              </div>
              <section className="section-block">
                <SectionHead
                  title="Your agent team"
                  eyebrow="PEOPLE + MACHINES"
                >
                  <PanelLink onClick={() => navigate("agents")}>
                    View all agents
                  </PanelLink>
                </SectionHead>
                <AgentCards
                  agents={data.agents.slice(0, 3)}
                  selectTask={setTaskId}
                />
              </section>
              <div className="overview-columns">
                <section className="panel tasks-panel">
                  <div className="panel-head">
                    <SectionHead title="Tasks in focus">
                      <PanelLink onClick={() => navigate("tasks")}>
                        All tasks
                      </PanelLink>
                    </SectionHead>
                  </div>
                  <TaskList
                    tasks={data.tasks}
                    agents={data.agents}
                    selectTask={setTaskId}
                    compact
                  />
                </section>
                <section className="panel activity-panel">
                  <div className="panel-head">
                    <SectionHead title="Latest activity">
                      <span
                        className={`activity-live ${data.remoteStream ? "text-green" : "muted"}`}
                      >
                        <span
                          className={`connection-dot ${data.remoteStream ? "dot-green" : "dot-gray"}`}
                        />
                        {data.remoteStream ? "Live" : "Offline"}
                      </span>
                    </SectionHead>
                  </div>
                  <ActivityList
                    events={data.events}
                    selectTask={setTaskId}
                    compact
                  />
                  <div className="panel-foot">
                    <PanelLink onClick={() => navigate("activity")}>
                      Open activity journal
                    </PanelLink>
                  </div>
                </section>
              </div>
              <section className="workspace-principle">
                <div className="principle-icon">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3>Progress you can trust.</h3>
                  <p>
                    Every task, patch, and test result reflects reported backend
                    state. Approval and verified application are always
                    separate.
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Open workspace guide"
                  onClick={() => setHelp(true)}
                >
                  <ArrowUpRight size={20} />
                </button>
              </section>
            </>
          )}
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
                      {data.capabilities?.patchCompletionMode ??
                        "legacy_decision"}
                    </Badge>
                  </SectionHead>
                </div>
                <PatchList patches={data.patches} open={setPatch} />
              </div>
              <form
                className="patch-lookup"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadPatch();
                }}
              >
                <FileCode2 size={19} />
                <div>
                  <strong>Have a patch ID?</strong>
                  <span className="muted small">
                    Legacy backends discover proposals through activity. You can
                    also open one directly.
                  </span>
                </div>
                <input
                  aria-label="Patch ID"
                  placeholder="Paste patch ID"
                  value={patchId}
                  onChange={(event) => setPatchId(event.target.value)}
                />
                <button
                  className="button secondary"
                  disabled={!patchId.trim() || patchLoading}
                >
                  {patchLoading ? "Opening…" : "Open patch"}
                  <ArrowRight size={14} />
                </button>
              </form>
            </>
          )}
          {page === "conflicts" && (
            <>
              <ConflictList conflicts={data.conflicts} open={setConflict} />
              {!data.capabilities?.features.sync && (
                <Notice>
                  Durable conflict synchronization is unavailable on this
                  backend.
                </Notice>
              )}
            </>
          )}
          {page === "messages" && (
            <Messages
              messages={data.messages}
              submit={submit}
              unavailable={unavailable}
            />
          )}
          {page === "network" && (
            <LocalSessionCard
              session={localSession}
              open={() => setPairing(true)}
            />
          )}
          {page === "network" && (
            <Network
              data={data}
              intents={intents}
              storageError={storageError}
              retry={(intent) => void retry(intent)}
            />
          )}
          <footer className="page-footer">
            <span>
              <span className="brand-mini">↕</span> UPSIDE DOWN
            </span>
            <span>One coordinator. Shared context. Your local network.</span>
            <span>UD-IC/1.0</span>
          </footer>
        </main>
      </div>
      {pairing && (
        <PairBrowser pair={localSession.pair} close={() => setPairing(false)} />
      )}
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
      {taskId && !selectedTask && (
        <Modal title="Task unavailable" onClose={() => setTaskId(undefined)}>
          <div className="detail-body">
            <Notice>
              This task is not present in the current snapshot. Refresh the
              workspace or reconnect to load it.
            </Notice>
          </div>
        </Modal>
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
      {help && (
        <Modal
          title="A workspace that tells it straight"
          onClose={() => setHelp(false)}
        >
          <div className="detail-body guide">
            <p>
              <Server size={18} />
              <span>
                <strong>The coordinator is the authority.</strong> Devices
                propose changes; revisions come from the coordinator.
              </span>
            </p>
            <p>
              <ArrowDownUp size={18} />
              <span>
                <strong>Queued means accepted locally.</strong> Acknowledgements
                distinguish applied, conflict, and rejected outcomes.
              </span>
            </p>
            <p>
              <GitPullRequest size={18} />
              <span>
                <strong>Approval is a decision.</strong> Code is verified only
                when application includes a real commit and passing evidence.
              </span>
            </p>
            <p>
              <CheckCheck size={18} />
              <span>
                <strong>Read the evidence.</strong> Legacy output text, task
                completion, and agent registration do not prove tests or model
                execution.
              </span>
            </p>
            <p>
              <CommandIcon size={18} />
              <span>
                <strong>Keep credentials in the local service.</strong> Device
                bearer tokens never belong in this browser.
              </span>
            </p>
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
