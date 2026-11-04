import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCheck,
  GitBranch,
  Laptop,
  MessageSquare,
  Network,
  Plus,
  Send,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { DemoEntry } from "./DemoWorkspace";
import { roles } from "./data";
import "./dashboard.css";

const initialTasks = [
  {
    id: "TASK-101",
    title: "Persist coordinator events in SQLite",
    owner: "P1",
    status: "Done",
    progress: 100,
  },
  {
    id: "TASK-102",
    title: "Build the agent activity dashboard",
    owner: "P2",
    status: "Running",
    progress: 72,
  },
  {
    id: "TASK-103",
    title: "Validate the event ingestion endpoint",
    owner: "P3",
    status: "Review",
    progress: 90,
  },
  {
    id: "TASK-104",
    title: "Connect the agent bridge to the API",
    owner: "P4",
    status: "Running",
    progress: 64,
  },
  {
    id: "TASK-105",
    title: "Detect competing file ownership claims",
    owner: "P1",
    status: "Running",
    progress: 81,
  },
  {
    id: "TASK-106",
    title: "Add offline and reconnect indicators",
    owner: "P2",
    status: "Todo",
    progress: 0,
  },
  {
    id: "TASK-107",
    title: "Publish shared request fixtures",
    owner: "P3",
    status: "Done",
    progress: 100,
  },
  {
    id: "TASK-108",
    title: "Rehearse the conflict recovery scenario",
    owner: "P4",
    status: "Todo",
    progress: 0,
  },
];
const seedEvents = [
  {
    agent: "P3",
    title: "Published event payload contract v1",
    detail: "shared/schemas.json → P1, P2 and P4",
    time: "Just now",
  },
  {
    agent: "P2",
    title: "Acknowledged the API contract",
    detail: "Frontend fixtures now match the shared response shape",
    time: "1 min ago",
  },
  {
    agent: "P1",
    title: "Completed durable event persistence",
    detail: "TASK-101 · SQLite transaction and event-ID deduplication",
    time: "3 min ago",
  },
  {
    agent: "P4",
    title: "Sent a bridge heartbeat",
    detail: "Laptop D → coordinator → laptop A",
    time: "4 min ago",
  },
  {
    agent: "P3",
    title: "Submitted API validation patch",
    detail: "PATCH-31 is ready for a human review",
    time: "6 min ago",
  },
  {
    agent: "P1",
    title: "Flagged a shared-file ownership overlap",
    detail: "shared/schemas.json · P1 and P3 · waiting for a decision",
    time: "8 min ago",
  },
];
const seedMessages = [
  {
    agent: "P3",
    to: "Everyone",
    text: "Event schemas are ready. Please use the status enum from CONTRACT.md.",
    time: "09:41",
  },
  {
    agent: "P1",
    to: "P3",
    text: "CoordinatorService is ready. Event persistence happens before the SSE broadcast.",
    time: "09:42",
  },
  {
    agent: "P2",
    to: "P3",
    text: "Acknowledged. Connecting the activity feed to your fixtures now.",
    time: "09:43",
  },
  {
    agent: "P4",
    to: "Everyone",
    text: "Bridge scenario prepared: contract change → acknowledgement → conflict review.",
    time: "09:44",
  },
];
const patchSeeds = [
  {
    id: "PATCH-31",
    title: "Validate incoming agent events",
    owner: "P3",
    file: "server/src/http/events.ts",
    added: 28,
    removed: 6,
    diff: "- const input = req.body;\n+ const input = eventInputSchema.parse(req.body);\n+ const result = await coordinator.appendEvent(input);\n+ res.status(result.duplicate ? 200 : 201).json(result);",
  },
  {
    id: "PATCH-32",
    title: "Recover activity after reconnect",
    owner: "P2",
    file: "web/src/hooks/useActivity.ts",
    added: 19,
    removed: 3,
    diff: "+ stream.addEventListener('open', async () => {\n+   await fetchEventsAfter(lastSequence);\n+   await refreshAffectedLists();\n+ });",
  },
];
export const showcaseDescriptions: Record<string, string> = {
  overview:
    "Your four-laptop team at a glance. Sample activity, progress and shared work.",
  tasks:
    "Explore assignments, add a sample task and move work through the board.",
  agents:
    "Four simulated collaborators, with clear roles and shared communication paths.",
  activity: "Follow sample updates as they travel between your team's agents.",
  reviews: "Inspect example code changes and record a demo review decision.",
  conflicts: "See where two agents overlap and practice resolving the handoff.",
  messages: "Try a team conversation with browser-local sample messages.",
  network:
    "Explore simulated connections, queued updates and reconnect behavior.",
};
export function DemoDashboard({ page }: { page: string }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [events, setEvents] = useState(seedEvents);
  const [messages, setMessages] = useState(seedMessages);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [newTask, setNewTask] = useState("");
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState("Everyone");
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(true);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    setFilter("All");
    setQuery("");
  }, [page]);
  useEffect(() => {
    const timer = setInterval(() => setBeat((b) => (b + 1) % 4), 2200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => {
      setSynced(true);
      setSyncing(false);
      setNotice(
        "Demo queue replayed. Four sample updates marked delivered in this browser.",
      );
    }, 1800);
    return () => clearTimeout(timer);
  }, [syncing]);
  const addEvent = (title: string, agent = "P2") =>
    setEvents((e) => [
      {
        title,
        agent,
        detail: "Interactive demo action · this browser only",
        time: "Just now",
      },
      ...e,
    ]);
  const done = tasks.filter((t) => t.status === "Done").length;
  const filtered = tasks.filter(
    (t) =>
      `${t.title} ${t.id} ${t.owner}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "All" || t.status === filter),
  );
  function taskList(compact = false) {
    return (
      <div className="dd-task-list">
        {(compact ? tasks.slice(0, 4) : filtered).map((t) => (
          <div className="dd-task" key={t.id}>
            <span className="dd-task-check">
              {t.status === "Done" ? <Check size={16} /> : <span />}
            </span>
            <div>
              <small>
                {t.id} · {t.owner}
              </small>
              <strong>{t.title}</strong>
              <div className="dd-bar">
                <span style={{ width: `${t.progress}%` }} />
              </div>
            </div>
            <span className={`dd-status ${t.status.toLowerCase()}`}>
              {t.status}
            </span>
            {!compact && (
              <select
                aria-label={`Status for ${t.id}`}
                value={t.status}
                onChange={(e) => {
                  setTasks((ts) =>
                    ts.map((item) =>
                      item.id === t.id
                        ? {
                            ...item,
                            status: e.target.value,
                            progress:
                              e.target.value === "Done"
                                ? 100
                                : e.target.value === "Todo"
                                  ? 0
                                  : 65,
                          }
                        : item,
                    ),
                  );
                  addEvent(`${t.id} moved to ${e.target.value}`, t.owner);
                }}
              >
                {["Todo", "Running", "Review", "Done"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </div>
        ))}
        {!filtered.length && !compact && (
          <p className="dd-empty">No sample tasks match this search.</p>
        )}
      </div>
    );
  }
  function team() {
    return (
      <div className="dd-team">
        {roles.map((r, i) => (
          <article className={`dd-agent ${r.color}`} key={r.id}>
            <div className="dd-agent-top">
              <span className="dd-avatar">
                <Laptop size={22} />
              </span>
              <span className="dd-status running">
                {beat === i ? "Sending update" : "Connected"}
              </span>
            </div>
            <small>
              LAPTOP {r.letter} · {r.id}
            </small>
            <h3>{r.name}</h3>
            <p>{r.tool} · sample agent</p>
            <code>{r.paths[0]}</code>
            <div className="dd-agent-bottom">
              <span>
                {tasks.filter((t) => t.owner === r.id).length} tasks assigned
              </span>
              <span>{[12, 18, 9, 24][i]} ms</span>
            </div>
          </article>
        ))}
      </div>
    );
  }
  function feed(compact = false) {
    return (
      <div className="dd-timeline">
        {(compact
          ? events.slice(0, 4)
          : events.filter((e) => filter === "All" || e.agent === filter)
        ).map((e, i) => (
          <div className="dd-event" key={`${e.title}-${i}`}>
            <span className="dd-event-avatar">{e.agent}</span>
            <div>
              <strong>{e.title}</strong>
              <p>{e.detail}</p>
              <small>{e.time}</small>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="demo-workspace dd-workspace">
      <div className="dd-demo-banner">
        <span className="demo-pill">
          <span /> Demo workspace
        </span>
        <span>
          Sample data · simulated connections · no backend or pairing needed
        </span>
      </div>
      {notice && (
        <div className="dd-notice" role="status">
          <CheckCheck size={17} />
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss demo notice"
          >
            ×
          </button>
        </div>
      )}
      {page === "overview" && (
        <>
          <DemoEntry />
          <div className="dd-stats">
            {[
              {
                title: "Team tasks",
                value: tasks.length,
                detail: `${done} completed`,
                link: "tasks",
              },
              {
                title: "Connected laptops",
                value: 4,
                detail: "Four assigned roles",
                link: "agents",
              },
              {
                title: "Awaiting review",
                value: 2 - Object.keys(reviews).length,
                detail: "Sample code proposals",
                link: "reviews",
              },
              {
                title: "Queued updates",
                value: synced ? 0 : 4,
                detail: "Ready for demo replay",
                link: "network",
              },
            ].map((s) => (
              <a href={`#${s.link}`} className="dd-stat" key={s.title}>
                <span>
                  {s.title}
                  <ArrowRight size={15} />
                </span>
                <strong>{s.value}</strong>
                <small>{s.detail}</small>
              </a>
            ))}
          </div>
          <div className="demo-section-title">
            <div>
              <span className="demo-kicker">PEOPLE + MACHINES</span>
              <h2>Your agent team</h2>
            </div>
            <a href="#agents" className="demo-text-button">
              Explore connections <ArrowRight size={15} />
            </a>
          </div>
          {team()}
          <div className="dd-columns">
            <section className="dd-panel">
              <div className="dd-panel-head">
                <h3>Tasks in focus</h3>
                <a href="#tasks">
                  View board <ArrowRight size={14} />
                </a>
              </div>
              {taskList(true)}
            </section>
            <section className="dd-panel">
              <div className="dd-panel-head">
                <h3>Latest activity</h3>
                <Activity size={18} />
              </div>
              {feed(true)}
            </section>
          </div>
        </>
      )}
      {page === "tasks" && (
        <>
          <form
            className="dd-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTask.trim()) return;
              setTasks((t) => [
                ...t,
                {
                  id: `TASK-${101 + t.length}`,
                  title: newTask.trim(),
                  owner: "P2",
                  status: "Todo",
                  progress: 0,
                },
              ]);
              addEvent(`Created task: ${newTask.trim()}`);
              setNewTask("");
            }}
          >
            <input
              aria-label="New demo task"
              placeholder="Add a task to the demo board…"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
            <button className="button primary" disabled={!newTask.trim()}>
              <Plus size={16} />
              Add task
            </button>
          </form>
          <div className="dd-filters">
            <input
              aria-label="Search demo tasks"
              placeholder="Search tasks or laptop role…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Filter task status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["All", "Todo", "Running", "Review", "Done"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <section className="dd-panel">{taskList()}</section>
        </>
      )}
      {page === "agents" && (
        <>
          {team()}
          <section className="dd-panel dd-connection-map">
            <div className="dd-panel-head">
              <div>
                <span className="demo-kicker">
                  SIMULATED AGENT COMMUNICATION
                </span>
                <h3>Four laptops. One shared conversation.</h3>
              </div>
              <Network size={22} />
            </div>
            <div className="dd-hub">
              <Network size={28} />
              <strong>Upside Down coordinator</strong>
              <span>Shared context · task routing · event relay</span>
            </div>
            <div className="dd-links">
              {roles.map((r, i) => (
                <div className={beat === i ? "pulse" : ""} key={r.id}>
                  <span className="dd-packet" />
                  <Laptop size={23} />
                  <strong>Laptop {r.letter}</strong>
                  <small>{r.short}</small>
                  <span>
                    {beat === i
                      ? "Publishing a sample update"
                      : "Waiting for next update"}
                  </span>
                </div>
              ))}
            </div>
            <div className="dd-route">
              <span className="demo-pill">Example handoff</span>
              <span>P3 publishes API contract</span>
              <ArrowRight size={16} />
              <span>P1 updates coordinator</span>
              <ArrowRight size={16} />
              <span>P2 refreshes UI</span>
              <ArrowRight size={16} />
              <span>P4 verifies scenario</span>
            </div>
          </section>
        </>
      )}
      {page === "activity" && (
        <section className="dd-panel">
          <div className="dd-panel-head">
            <h3>
              Activity journal <small>{events.length} sample events</small>
            </h3>
            <select
              aria-label="Filter activity by agent"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["All", "P1", "P2", "P3", "P4"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {feed()}
        </section>
      )}
      {page === "reviews" && (
        <div className="dd-review-list">
          {patchSeeds.map((p) => (
            <section className="dd-panel" key={p.id}>
              <div className="dd-panel-head">
                <div>
                  <span className="demo-kicker">
                    {p.id} · {p.owner}
                  </span>
                  <h3>{p.title}</h3>
                </div>
                <span className="dd-status review">
                  {reviews[p.id] || "Awaiting review"}
                </span>
              </div>
              <div className="dd-patch-meta">
                <GitBranch size={15} />
                <code>{p.file}</code>
                <span>
                  +{p.added} / −{p.removed}
                </span>
              </div>
              <pre className="dd-diff">{p.diff}</pre>
              <div className="dd-review-footer">
                <span>
                  <ShieldCheck size={17} />
                  Example patch · no code is applied
                </span>
                <button
                  className="button secondary"
                  disabled={!!reviews[p.id]}
                  onClick={() => {
                    setReviews((r) => ({ ...r, [p.id]: "Changes requested" }));
                    setNotice(`${p.id}: changes requested in the demo.`);
                  }}
                >
                  Request changes
                </button>
                <button
                  className="button primary"
                  disabled={!!reviews[p.id]}
                  onClick={() => {
                    setReviews((r) => ({ ...r, [p.id]: "Approved" }));
                    addEvent(`Approved ${p.id}`);
                    setNotice(
                      `${p.id} approved in the demo. No repository files were changed.`,
                    );
                  }}
                >
                  <Check size={16} />
                  Approve demo patch
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {page === "conflicts" && (
        <div className="dd-review-list">
          {[
            {
              id: "CONFLICT-01",
              title: "Shared schema ownership overlap",
              path: "shared/schemas.json",
              actors: "P1 ↔ P3",
              detail:
                "Both agents proposed a change to the event payload. Assign the schema change to P3; let P1 consume the agreed interface.",
            },
            {
              id: "CONFLICT-02",
              title: "Frontend is using an older response shape",
              path: "web/src/hooks/useActivity.ts",
              actors: "P2 ↔ P3",
              detail:
                "The sample UI expects statusText while the shared contract defines status. Align the frontend fixture with CONTRACT.md.",
            },
          ].map((c) => (
            <section className="dd-panel" key={c.id}>
              <div className="dd-panel-head">
                <div>
                  <span className="demo-kicker">
                    {c.id} · {c.actors}
                  </span>
                  <h3>{c.title}</h3>
                </div>
                <span
                  className={`dd-status ${resolved.includes(c.id) ? "done" : "review"}`}
                >
                  {resolved.includes(c.id) ? "Resolved" : "Needs review"}
                </span>
              </div>
              <div className="dd-conflict-body">
                <code>{c.path}</code>
                <p>{c.detail}</p>
                <label>
                  Resolution note
                  <textarea
                    aria-label={`Resolution note for ${c.id}`}
                    value={notes[c.id] || ""}
                    onChange={(e) =>
                      setNotes((n) => ({ ...n, [c.id]: e.target.value }))
                    }
                    placeholder="Describe the handoff or agreed change…"
                    disabled={resolved.includes(c.id)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={resolved.includes(c.id) || !notes[c.id]?.trim()}
                  onClick={() => {
                    setResolved((r) => [...r, c.id]);
                    addEvent(`Resolved ${c.id}`);
                    setNotice(
                      "Sample conflict resolved. The decision is recorded for this walkthrough.",
                    );
                  }}
                >
                  <CheckCheck size={17} />
                  {resolved.includes(c.id)
                    ? "Resolved in demo"
                    : "Resolve demo conflict"}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {page === "messages" && (
        <section className="dd-panel">
          <div className="dd-panel-head">
            <h3>
              <MessageSquare size={19} /> Team channel
            </h3>
            <span className="dd-status running">4 sample participants</span>
          </div>
          <div className="dd-messages">
            {messages.map((m, i) => (
              <div
                className={`dd-message ${m.agent === "You" ? "mine" : ""}`}
                key={i}
              >
                <span className="dd-event-avatar">{m.agent}</span>
                <div>
                  <strong>
                    {m.agent}{" "}
                    <small>
                      → {m.to} · {m.time}
                    </small>
                  </strong>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
          </div>
          <form
            className="dd-message-compose"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              setMessages((m) => [
                ...m,
                {
                  agent: "You",
                  to: recipient,
                  text: draft.trim(),
                  time: "Now",
                },
                {
                  agent: recipient === "Everyone" ? "P3" : recipient,
                  to: "You",
                  text: "Demo acknowledgement: message received. I will keep my assigned module aligned with the shared contract.",
                  time: "Now · simulated reply",
                },
              ]);
              addEvent(`Sent a sample message to ${recipient}`);
              setDraft("");
            }}
          >
            <select
              aria-label="Message recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            >
              {["Everyone", "P1", "P2", "P3", "P4"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input
              aria-label="Demo message"
              placeholder="Send a message to your sample team…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="button primary" disabled={!draft.trim()}>
              <Send size={16} />
              Send
            </button>
          </form>
        </section>
      )}
      {page === "network" && (
        <>
          <div className="dd-stats">
            {[
              {
                title: "Local network",
                value: "4 / 4",
                detail: "Simulated laptop links",
              },
              {
                title: "Average latency",
                value: "16 ms",
                detail: "Illustrative network metric",
              },
              {
                title: "Pending updates",
                value: synced ? "0" : "4",
                detail: "Browser-local queue",
              },
              {
                title: "Delivery rate",
                value: "99.8%",
                detail: "Sample presentation metric",
              },
            ].map((s) => (
              <div className="dd-stat" key={s.title}>
                <span>{s.title}</span>
                <strong>{s.value}</strong>
                <small>{s.detail}</small>
              </div>
            ))}
          </div>
          <section className="dd-panel">
            <div className="dd-panel-head">
              <h3>
                <Wifi size={20} />
                Connectivity simulator
              </h3>
              <button
                className="button secondary"
                onClick={() => {
                  setOnline((v) => !v);
                  setSynced(false);
                  setNotice(
                    online
                      ? "Simulated internet disconnected. The sample LAN stays connected."
                      : "Simulated internet restored. You can replay the sample queue.",
                  );
                }}
              >
                {online ? "Simulate internet loss" : "Restore internet"}
              </button>
            </div>
            <div className="dd-network-state">
              <span className="dd-status running">
                Local network: connected
              </span>
              <span className={`dd-status ${online ? "done" : "review"}`}>
                Internet: {online ? "online" : "offline"}
              </span>
              <p>
                {online
                  ? "The sample cloud route is available. Pending updates can be replayed."
                  : "Laptop communication continues over the illustrated LAN. Cloud updates wait in the queue."}
              </p>
            </div>
          </section>
          <section className="dd-panel">
            <div className="dd-panel-head">
              <h3>Delivery queue</h3>
              <button
                className="button primary"
                disabled={!online || synced || syncing}
                onClick={() => setSyncing(true)}
              >
                {syncing
                  ? "Replaying…"
                  : synced
                    ? "Demo queue delivered"
                    : "Replay demo queue"}
                <ArrowRight size={16} />
              </button>
            </div>
            {[
              "P1 · Persist event receipt",
              "P3 · Share contract update",
              "P2 · Acknowledge schema",
              "P4 · Publish scenario summary",
            ].map((item, i) => (
              <div className="dd-queue-row" key={item}>
                <span className="dd-event-avatar">0{i + 1}</span>
                <strong>{item}</strong>
                <span className={`dd-status ${synced ? "done" : "review"}`}>
                  {synced
                    ? "Delivered (demo)"
                    : syncing
                      ? "Replaying"
                      : "Queued"}
                </span>
              </div>
            ))}
            <p className="dd-queue-note">
              This is a visual simulation. Replay does not contact GitHub or
              another laptop.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
