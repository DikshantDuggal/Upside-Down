import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
import { errorMessage, onlineRequest, request } from "../api/client";
import { CONTRACT } from "../api/types";
import type { Dashboard } from "../app/useDashboard";
import { Empty, Notice, Timestamp } from "../components/ui";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const handoffSchema = z.object({
  id: z.string(),
  fromAgent: z.string(),
  toAgent: z.string(),
  taskId: z.string().optional(),
  dependentTaskId: z.string().optional(),
  handoffType: z.enum([
    "task_completed",
    "review_requested",
    "blocked_dependency",
    "context_sharing",
  ]),
  summary: z.string(),
  contractVersion: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
type Project = z.infer<typeof projectSchema>;
type Handoff = z.infer<typeof handoffSchema>;
type Data = Dashboard & { refresh: () => Promise<void> };
function useCollaboration(data: Data) {
  const [projects, setProjects] = useState<Project[]>([]),
    [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const changes = data.events
    .filter(
      (event) =>
        event.type === "project_created" || event.type === "agent_handoff",
    )
    .map((event) => event.id)
    .join(",");
  const inflight = useRef<AbortController | null>(null),
    fetched = useRef("");
  const revalidate = useRef(true);
  const signature = JSON.stringify([
    data.mode,
    data.local?.deviceId,
    data.coordinator,
    changes,
    revision,
  ]);
  useEffect(
    () => () => {
      inflight.current?.abort();
      inflight.current = null;
    },
    [],
  );
  useEffect(() => {
    if (data.mode !== "local") {
      setLoading(false);
      return;
    }
    if (
      inflight.current ||
      (fetched.current === signature && !revalidate.current)
    )
      return;
    const abort = new AbortController();
    inflight.current = abort;
    Promise.all([
      request("/api/projects", z.array(projectSchema), {
        signal: abort.signal,
      }),
      request("/api/handoffs", z.array(handoffSchema), {
        signal: abort.signal,
      }),
    ])
      .then(([p, h]) => {
        if (!abort.signal.aborted) {
          setProjects(p.value);
          setHandoffs(h.value);
          setStale(p.stale || h.stale);
          setError("");
          fetched.current = signature;
          revalidate.current = p.stale || h.stale;
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          revalidate.current = true;
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (inflight.current === abort) inflight.current = null;
        if (!abort.signal.aborted) setLoading(false);
      });
  }, [signature, data.local?.health.lastSyncAt]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { projects, handoffs, error, stale, loading, reload };
}
const panelStyle = { padding: 20, marginBottom: 20 };

export function Projects({ data }: { data: Data }) {
  const state = useCollaboration(data),
    [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const unavailable =
    data.mode !== "local" ||
    data.coordinator !== true ||
    state.stale ||
    state.loading ||
    !!state.error;
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await onlineRequest(
        "/api/projects",
        projectSchema,
        {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
        data.local?.deviceId ?? "unavailable",
        201,
      );
      setSaved(`Project recorded: ${result.value.name}`);
      setName("");
      setDescription("");
      state.reload();
      await data.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {state.loading && <Notice>Loading projects…</Notice>}
      {(state.error || error) && <Notice danger>{error || state.error}</Notice>}
      {unavailable && (
        <Notice>
          Project changes need a paired local service and a reachable
          coordinator. They are not queued offline.
        </Notice>
      )}
      {state.stale && (
        <Notice>
          Showing cached project records. Reconnect before making changes.
        </Notice>
      )}
      {saved && <Notice>{saved}</Notice>}
      <form className="panel form-stack" style={panelStyle} onSubmit={create}>
        <h2>Create a project</h2>
        <label>
          Project name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Project description
          <textarea
            maxLength={16384}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || unavailable || !name.trim()}
        >
          {busy ? "Recording…" : "Create project"}
        </button>
      </form>
      {state.projects.length ? (
        <div className="agent-grid">
          {state.projects.map((project) => (
            <article className="agent-card" key={project.id}>
              <h3>{project.name}</h3>
              <p className="prewrap">
                {project.description || "No description provided."}
              </p>
              <span className="mono small">{project.id}</span>
              <p className="small muted">
                Recorded <Timestamp value={project.createdAt} />
              </p>
            </article>
          ))}
        </div>
      ) : (
        !state.loading && (
          <Empty title="Start with shared context">
            Create a project to record your team's goal. Tasks remain shared
            workspace items.
          </Empty>
        )
      )}
    </>
  );
}

export function Handoffs({ data }: { data: Data }) {
  const state = useCollaboration(data),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [task, setTask] = useState("");
  const [dependent, setDependent] = useState(""),
    [project, setProject] = useState(""),
    [summary, setSummary] = useState("");
  const [agentId, setAgentId] = useState(""),
    [agentName, setAgentName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const unavailable =
    data.mode !== "local" ||
    data.coordinator !== true ||
    state.stale ||
    state.loading ||
    !!state.error;
  async function register(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await onlineRequest(
        "/api/agents/register",
        z.object({ success: z.boolean() }),
        {
          id: agentId.trim(),
          name: agentName.trim(),
          status: "idle",
          runtimeAvailable: false,
        },
        data.local?.deviceId ?? "unavailable",
        200,
      );
      setFrom(agentId.trim());
      setSaved("Agent registered on this device. No AI runtime was started.");
      setAgentId("");
      setAgentName("");
      await data.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await onlineRequest(
        "/api/handoffs",
        handoffSchema,
        {
          fromAgent: from,
          toAgent: to,
          taskId: task,
          ...(dependent ? { dependentTaskId: dependent } : {}),
          handoffType: "context_sharing",
          summary: summary.trim(),
          payload: {
            contract: CONTRACT,
            ...(project ? { projectId: project } : {}),
          },
        },
        data.local?.deviceId ?? "unavailable",
        201,
      );
      setSaved(
        "Handoff recorded. Recipient acknowledgement is tracked separately.",
      );
      setSummary("");
      state.reload();
      await data.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function acknowledge(handoff: Handoff) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await onlineRequest(
        "/api/handoffs",
        handoffSchema,
        {
          fromAgent: handoff.toAgent,
          toAgent: handoff.fromAgent,
          ...(handoff.taskId ? { taskId: handoff.taskId } : {}),
          handoffType: "context_sharing",
          summary: `Received: ${handoff.summary.slice(0, 1800)}`,
          payload: { ackFor: handoff.id, contract: CONTRACT },
        },
        data.local?.deviceId ?? "unavailable",
        201,
      );
      setSaved("Recipient acknowledgement recorded.");
      state.reload();
      await data.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {(state.error || error) && <Notice danger>{error || state.error}</Notice>}
      {unavailable && (
        <Notice>
          Handoffs require a reachable coordinator. Use an agent registered on
          this device; recipient acknowledgements require the receiving agent's
          device.
        </Notice>
      )}
      {state.stale && (
        <Notice>
          Showing cached handoffs. Acknowledgements are unavailable until
          reconnected.
        </Notice>
      )}
      {saved && <Notice>{saved}</Notice>}
      <form className="panel form-stack" style={panelStyle} onSubmit={register}>
        <h2>Register a device agent</h2>
        <p className="muted small">
          Registration records identity and availability. It does not start an
          AI runtime.
        </p>
        <label>
          New agent ID
          <input
            required
            maxLength={200}
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          />
        </label>
        <label>
          Agent name
          <input
            required
            maxLength={200}
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={unavailable || busy || !agentId.trim() || !agentName.trim()}
        >
          Register agent
        </button>
      </form>
      <form className="panel form-stack" style={panelStyle} onSubmit={send}>
        <h2>Send a structured handoff</h2>
        <label>
          Sending agent
          <select
            aria-label="Sending agent"
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          >
            <option value="">Choose your device's agent</option>
            {data.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Receiving agent
          <select
            aria-label="Receiving agent"
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="">Choose a recipient</option>
            {data.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Associated task
          <select
            aria-label="Associated task"
            required
            value={task}
            onChange={(event) => setTask(event.target.value)}
          >
            <option value="">Choose a task</option>
            {data.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dependent task (optional)
          <select
            aria-label="Dependent task (optional)"
            value={dependent}
            onChange={(event) => setDependent(event.target.value)}
          >
            <option value="">None</option>
            {data.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project context (optional)
          <select
            aria-label="Project context (optional)"
            value={project}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">None</option>
            {state.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Handoff summary
          <textarea
            required
            rows={3}
            maxLength={2048}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={
            busy ||
            unavailable ||
            !from ||
            !to ||
            from === to ||
            !task ||
            !summary.trim()
          }
        >
          Send handoff
        </button>
      </form>
      {state.loading && <Notice>Loading handoffs…</Notice>}
      {!state.loading && !state.handoffs.length && (
        <Empty title="Make the next step clear">
          Share a task's context and track the recipient's acknowledgement.
        </Empty>
      )}
      <div className="form-stack">
        {state.handoffs.map((handoff) => {
          const acknowledgement = typeof handoff.payload.ackFor === "string";
          const acknowledged = state.handoffs.some(
            (item) => item.payload.ackFor === handoff.id,
          );
          return (
            <article className="panel" style={panelStyle} key={handoff.id}>
              <strong>
                {handoff.fromAgent} → {handoff.toAgent}
              </strong>
              <p className="prewrap">{handoff.summary}</p>
              <p className="small muted">
                {acknowledgement
                  ? "Acknowledgement"
                  : acknowledged
                    ? "Acknowledged by recipient"
                    : "Awaiting recipient acknowledgement"}{" "}
                · <Timestamp value={handoff.createdAt} />
              </p>
              <p className="mono small">
                Task {handoff.taskId || "Unassociated"} ·{" "}
                {String(
                  handoff.payload.contract ??
                    `Schema ${handoff.contractVersion}`,
                )}
              </p>
              {!acknowledgement && (
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    unavailable ||
                    acknowledged ||
                    handoff.payload.contract !== CONTRACT
                  }
                  onClick={() => void acknowledge(handoff)}
                >
                  Acknowledge handoff
                </button>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
