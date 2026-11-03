import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { errorMessage, idPath, onlineRequest, request } from "../api/client";
import {
  checkpointSchema,
  patchSchema,
  runSchema,
  taskStatuses,
  transitions,
  type Checkpoint,
  type Command,
  type Run,
  type Patch,
  type Task,
  type TaskStatus,
} from "../api/types";
import type { Dashboard } from "../app/useDashboard";
import { useBrowserSession } from "../api/session";
import {
  Empty,
  Modal,
  Notice,
  Status,
  Timestamp,
  shortId,
} from "../components/ui";
import { Evidence, PatchList } from "./patches";
import type { Intent } from "./commands";
import { transitionBlocked } from "./commands";
import { z } from "zod";

export function TaskList({
  tasks,
  agents,
  selectTask,
  compact = false,
}: {
  tasks: Task[];
  agents: Dashboard["agents"];
  selectTask: (id: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = tasks
    .filter(
      (task) =>
        (filter === "all" || task.status === filter) &&
        `${task.title} ${task.id} ${task.description ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      {!compact && (
        <div className="filter-bar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Filter task status"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {taskStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <span className="muted small">{visible.length} tasks</span>
        </div>
      )}
      {!visible.length ? (
        <Empty
          title={tasks.length ? "No matching tasks" : "Room for your next idea"}
        >
          {tasks.length
            ? "Try a different search or status."
            : "Create a task to get your team moving. Tasks will appear once the coordinator accepts them."}
        </Empty>
      ) : (
        <div className="task-table-wrap">
          <table className="task-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Revision</th>
                <th>
                  <span className="sr-only">Open task</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, compact ? 6 : visible.length).map((task) => (
                <tr key={task.id}>
                  <td>
                    <button
                      className="task-title"
                      onClick={() => selectTask(task.id)}
                    >
                      <span className="task-id mono">{shortId(task.id)}</span>
                      <strong>{task.title}</strong>
                    </button>
                  </td>
                  <td>
                    <Status status={task.status} />
                  </td>
                  <td className="owner-cell">
                    {task.ownerId ? (
                      <>
                        <span className="owner-initial">
                          {(agents.find((agent) => agent.id === task.ownerId)
                            ?.name ?? task.ownerId)[0]?.toUpperCase()}
                        </span>
                        {agents.find((agent) => agent.id === task.ownerId)
                          ?.name ?? shortId(task.ownerId)}
                      </>
                    ) : (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td className="mono small muted">r{task.revision}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Open ${task.title}`}
                      onClick={() => selectTask(task.id)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function NewTask({
  close,
  submit,
  unavailable,
}: {
  close: () => void;
  submit: (command: Command) => Promise<void>;
  unavailable?: string;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (attempted) return;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      await submit({
        type: "task.create",
        payload: {
          clientTaskId: crypto.randomUUID(),
          title: title.trim(),
          ...(description ? { description } : {}),
          ...(owner ? { ownerId: owner } : {}),
        },
      });
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Create a task" onClose={close}>
      <form onSubmit={send} className="form-stack">
        <p className="muted">
          Start with a clear goal. The local service will queue your proposal
          for the coordinator.
        </p>
        <label>
          Task title
          <input
            required
            data-initial-focus
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to happen?"
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={16384}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context, expected behavior, or acceptance criteria."
          />
        </label>
        <label>
          Owner ID <span className="muted">(optional)</span>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Agent or team member ID"
          />
        </label>
        {unavailable && <Notice>{unavailable}</Notice>}
        {error && (
          <Notice danger>
            {error} The original request is saved in Network & queue; retry it
            there with its existing key.
          </Notice>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || attempted || !!unavailable || !title.trim()}
          >
            {busy ? "Submitting…" : "Queue task"}
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskDetail({
  task,
  data,
  intents,
  close,
  submit,
  openPatch,
}: {
  task: Task;
  data: Dashboard & { refresh: () => Promise<void> };
  intents: Intent[];
  close: () => void;
  submit: (command: Command) => Promise<void>;
  openPatch: (patch: Patch) => void;
}) {
  const session = useBrowserSession();
  const [target, setTarget] = useState<TaskStatus | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run>();
  const [workspace, setWorkspace] = useState("");
  const [profile, setProfile] = useState("");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>();
  const [patches, setPatches] = useState(
    data.patches.filter((value) => value.taskId === task.id),
  );
  const [patchListUnavailable, setPatchListUnavailable] = useState(false);
  const blocked = transitionBlocked(
    task.id,
    data.pending,
    intents,
    task.revision,
  );
  const canWrite = data.mode === "local" && !!session.csrfToken;
  const canRun =
    data.capabilities?.features.execution &&
    session.canReview &&
    canWrite &&
    data.coordinator &&
    !data.stale;
  const allowed = transitions[task.status];
  useEffect(() => {
    const latest = [...data.events]
      .reverse()
      .find(
        (value) => value.type === "run_changed" && value.taskId === task.id,
      );
    const parsed = runSchema.safeParse(latest?.payload.run);
    if (parsed.success && parsed.data.taskId === task.id) setRun(parsed.data);
  }, [data.events, task.id]);
  useEffect(() => {
    if (!data.capabilities) {
      setPatches(data.patches.filter((value) => value.taskId === task.id));
      return;
    }
    const controller = new AbortController();
    request(`/api/tasks/${idPath(task.id)}/patches`, z.array(patchSchema), {
      signal: controller.signal,
    })
      .then((result) => {
        setPatches(result.value);
        setPatchListUnavailable(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setPatchListUnavailable(true);
          if (!(err instanceof Error && "status" in err && err.status === 404))
            setError(errorMessage(err));
        }
      });
    return () => controller.abort();
  }, [task.id, task.revision, data.capabilities, data.patches]);
  useEffect(() => {
    setTarget("");
  }, [task.revision]);
  useEffect(() => {
    if (!data.capabilities?.features.checkpointMetadata) return;
    const controller = new AbortController();
    request(
      `/api/tasks/${idPath(task.id)}/checkpoints`,
      z.array(checkpointSchema),
      { signal: controller.signal },
    )
      .then((result) => setCheckpoints(result.value))
      .catch((err) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [task.id, data.capabilities?.features.checkpointMetadata]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const controller = new AbortController();
    const timer = setInterval(
      () =>
        request(`/api/runs/${idPath(run.id)}`, runSchema, {
          signal: controller.signal,
        })
          .then((result) => setRun(result.value))
          .catch((err) => {
            if (!controller.signal.aborted) setError(errorMessage(err));
          }),
      2000,
    );
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [run?.id, run?.status]);
  async function transition(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await submit({
        type: "task.transition",
        taskId: task.id,
        baseRevision: task.revision,
        payload: { targetStatus: target, ...(reason ? { reason } : {}) },
      });
      setTarget("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function startRun() {
    setBusy(true);
    setError("");
    try {
      const result = await onlineRequest(
        `/api/tasks/${idPath(task.id)}/runs`,
        runSchema,
        {
          baseRevision: task.revision,
          workspaceId: workspace,
          testProfileId: profile,
          trigger: "manual",
        },
        data.local?.deviceId ?? "unavailable",
        202,
      );
      setRun(result.value);
      await data.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function cancelRun() {
    if (!run || !reason.trim()) return;
    setBusy(true);
    try {
      setRun(
        (
          await onlineRequest(
            `/api/runs/${idPath(run.id)}/cancel`,
            runSchema,
            { reason },
            data.local?.deviceId ?? "unavailable",
          )
        ).value,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Task detail" onClose={close} wide>
      <div className="detail-body">
        <div className="detail-heading">
          <span className="mono muted small">TASK / {task.id}</span>
          <Status status={task.status} />
        </div>
        <h1 className="detail-title">{task.title}</h1>
        {task.description && <p className="prewrap">{task.description}</p>}
        <div className="detail-facts">
          <div>
            <span>Canonical revision</span>
            <strong>r{task.revision}</strong>
          </div>
          <div>
            <span>Owner</span>
            <strong>{task.ownerId ?? "Unassigned"}</strong>
          </div>
          <div>
            <span>Updated</span>
            <Timestamp value={task.updatedAt} />
          </div>
        </div>
        {data.stale && (
          <Notice>
            This is a stale snapshot. A proposal uses revision {task.revision}{" "}
            and may conflict when delivered.
          </Notice>
        )}
        {task.status === "done" && (
          <Notice>
            Task status is done. Code application is unverified unless a
            separate application record includes a verified commit and passing
            test evidence.
          </Notice>
        )}
        <section className="detail-section">
          <h3>Propose a status change</h3>
          {!allowed.length ? (
            <p className="muted">
              This task has no manual transitions available. Completion requires
              verified application.
            </p>
          ) : (
            <form className="form-stack" onSubmit={transition}>
              <div className="form-grid">
                <label>
                  Target status
                  <select
                    value={target}
                    required
                    onChange={(event) =>
                      setTarget(event.target.value as TaskStatus)
                    }
                  >
                    <option value="">Choose a status</option>
                    {allowed.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason
                  <input
                    maxLength={2048}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="What changed?"
                  />
                </label>
              </div>
              {blocked && (
                <Notice>
                  A transition is awaiting acknowledgement, or a pending receipt
                  has no task association. Refresh receipts before proposing
                  another transition.
                </Notice>
              )}
              {!canWrite && (
                <p className="muted small">
                  Requires an authenticated local service session. This view
                  remains available for reading.
                </p>
              )}
              <button
                className="button primary"
                disabled={!canWrite || blocked || !target || busy}
              >
                Queue proposal · base r{task.revision}
              </button>
            </form>
          )}
        </section>
        <section className="detail-section">
          <h3>Execution & test evidence</h3>
          {!data.capabilities?.features.execution ? (
            <p className="muted">
              Run execution is unavailable on this backend.
            </p>
          ) : (
            <>
              <p className="muted small">
                Uses the bounded offline heuristic provider. Workspace and test
                profile IDs must already be registered by Backend A.
              </p>
              <div className="form-grid">
                <label>
                  Workspace ID
                  <input
                    value={workspace}
                    onChange={(event) => setWorkspace(event.target.value)}
                  />
                </label>
                <label>
                  Test profile ID
                  <input
                    value={profile}
                    onChange={(event) => setProfile(event.target.value)}
                  />
                </label>
              </div>
              <button
                className="button secondary"
                onClick={() => void startRun()}
                disabled={
                  !canRun ||
                  busy ||
                  !workspace ||
                  !profile ||
                  (!!run && ["queued", "running"].includes(run.status))
                }
              >
                Start run
              </button>
              {!canRun && (
                <p className="small muted">
                  Requires a fresh coordinator connection and authenticated
                  reviewer session.
                </p>
              )}
            </>
          )}
          {run && (
            <div className="run-record">
              <div className="row-between">
                <span className="mono">
                  {shortId(run.id)} / {run.stage}
                </span>
                <Status status={run.status} />
              </div>
              <p>
                {run.provider} · {run.attempts}/{run.maxAttempts} attempts
              </p>
              {run.cancellationRequested && (
                <Notice>
                  Cancellation requested. The worker has not yet confirmed it
                  has stopped.
                </Notice>
              )}
              {run.error && <Notice danger>{run.error.message}</Notice>}
              <Evidence evidence={run.evidence} />
              {["queued", "running"].includes(run.status) && (
                <>
                  <label>
                    Cancellation reason
                    <input
                      value={reason}
                      maxLength={2048}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={
                      !canRun ||
                      busy ||
                      !reason.trim() ||
                      run.cancellationRequested
                    }
                    onClick={() => void cancelRun()}
                  >
                    Request cancellation (reason required)
                  </button>
                </>
              )}
            </div>
          )}
        </section>
        <section className="detail-section">
          <h3>Task patches</h3>
          {patchListUnavailable && (
            <p className="muted small">
              The backend does not currently provide the task patch list.
            </p>
          )}
          <PatchList patches={patches} open={openPatch} />
        </section>
        <section className="detail-section">
          <h3>Checkpoints</h3>
          <p className="small muted">
            Metadata only. Cloud-to-local model recovery is a future capability.
          </p>
          {checkpoints?.length ? (
            checkpoints.map((item) => (
              <div key={item.id} className="checkpoint">
                <strong>{item.stage}</strong>
                <p>{item.summary}</p>
                <Timestamp value={item.createdAt} />
              </div>
            ))
          ) : (
            <p className="muted">
              {data.capabilities?.features.checkpointMetadata
                ? "No checkpoints recorded."
                : "Checkpoint metadata is unavailable."}
            </p>
          )}
        </section>
        {error && <Notice danger>{error}</Notice>}
      </div>
    </Modal>
  );
}
