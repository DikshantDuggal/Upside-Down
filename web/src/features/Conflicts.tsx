import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { z } from "zod";
import {
  ApiError,
  errorMessage,
  idPath,
  onlineRequest,
  request,
} from "../api/client";
import {
  conflictSchema,
  taskSchema,
  transitions,
  type Conflict,
  type ResolveRequest,
  type Task,
  type TaskStatus,
} from "../api/types";
import { useBrowserSession } from "../api/session";
import type { Dashboard } from "../app/useDashboard";
import {
  Empty,
  Modal,
  Notice,
  Status,
  Timestamp,
  shortId,
} from "../components/ui";

export function ConflictList({
  conflicts,
  open,
}: {
  conflicts: Conflict[];
  open: (conflict: Conflict) => void;
}) {
  if (!conflicts.length)
    return (
      <Empty title="Everyone on the same page">
        Revision conflicts will appear here with the original proposal and the
        coordinator’s current state.
      </Empty>
    );
  return (
    <div className="conflict-list">
      {conflicts.map((conflict) => (
        <article className="conflict-card" key={conflict.id}>
          <div className="row-between">
            <span className="conflict-icon">
              <GitCompareArrows size={20} />
            </span>
            <Status
              status={conflict.status === "open" ? "conflict" : "resolved"}
            />
          </div>
          <h3>{conflict.currentTask.title}</h3>
          <p className="muted">
            A proposal based on r{conflict.baseRevision} met coordinator
            revision r{conflict.currentRevision}.
          </p>
          <div className="revision-comparison">
            <div>
              <span>Proposed</span>
              <strong>{conflict.proposed.payload.targetStatus}</strong>
              <small>base r{conflict.baseRevision}</small>
            </div>
            <ArrowRight size={16} />
            <div>
              <span>At detection</span>
              <strong>{conflict.currentTask.status}</strong>
              <small>r{conflict.currentRevision}</small>
            </div>
          </div>
          <footer>
            <span className="small muted">
              <Timestamp value={conflict.detectedAt} />
            </span>
            <button className="button secondary" onClick={() => open(conflict)}>
              Review conflict
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
export function ConflictDetail({
  conflict: initial,
  data,
  close,
}: {
  conflict: Conflict;
  data: Dashboard & { refresh: () => Promise<void> };
  close: () => void;
}) {
  const [conflict, setConflict] = useState(initial);
  const [liveTask, setLiveTask] = useState<Task>();
  const [error, setError] = useState("");
  const [resolution, setResolution] =
    useState<ResolveRequest["resolution"]>("keep_authoritative");
  const [target, setTarget] = useState<TaskStatus | "">("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const session = useBrowserSession();
  const authorized =
    session.canReview &&
    !!session.csrfToken &&
    data.mode === "local" &&
    data.coordinator &&
    !data.stale &&
    data.capabilities?.features.sync;
  async function refreshConflict(signal?: AbortSignal) {
    setConfirmed(false);
    setLiveTask(undefined);
    const task = await request(
      `/api/tasks/${idPath(conflict.taskId)}`,
      taskSchema,
      { signal, versioned: false },
    );
    if (task.stale)
      throw new ApiError(
        "Current task data is cached. Connect to the coordinator before resolving a conflict.",
        503,
      );
    setLiveTask(task.value);
    const page = await request(
      "/api/sync/conflicts?status=open",
      z.object({
        items: z.array(conflictSchema),
        hasMore: z.boolean(),
        nextCursor: z.string().optional(),
      }),
      { signal },
    );
    const current = page.value.items.find((item) => item.id === conflict.id);
    if (current) setConflict(current);
    else {
      setLiveTask(undefined);
      throw new ApiError(
        "This conflict is not in the current open page. Refresh the list before resolving it.",
        409,
      );
    }
  }
  useEffect(() => {
    if (!data.capabilities?.features.sync) return;
    const controller = new AbortController();
    void refreshConflict(controller.signal).catch((err) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    });
    return () => controller.abort();
  }, [conflict.id, data.capabilities?.features.sync]);
  async function resolve(event: FormEvent) {
    event.preventDefault();
    if (!liveTask || !confirmed) return;
    setBusy(true);
    setError("");
    const body: ResolveRequest = {
      resolution,
      expectedConflictRevision: conflict.resolutionRevision,
      expectedTaskRevision: liveTask.revision,
      reason,
      ...(resolution === "custom_transition" && target
        ? { transition: { targetStatus: target, reason } }
        : {}),
    };
    try {
      setConflict(
        (
          await onlineRequest(
            `/api/sync/conflicts/${idPath(conflict.id)}/resolve`,
            conflictSchema,
            body,
            data.local!.deviceId,
          )
        ).value,
      );
      setConfirmed(false);
      await data.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmed(false);
      if (err instanceof ApiError && err.status === 409) {
        await data.refresh();
        await refreshConflict().catch((refreshError) =>
          setError(`${errorMessage(err)} ${errorMessage(refreshError)}`),
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Resolve revision conflict" onClose={close} wide>
      <div className="detail-body">
        <div className="row-between">
          <span className="mono muted small">
            CONFLICT / {shortId(conflict.id)}
          </span>
          <Status status={conflict.status} />
        </div>
        <h2>{conflict.currentTask.title}</h2>
        <div className="conflict-evidence">
          <article>
            <span className="eyebrow">Original proposal</span>
            <h3>{conflict.proposed.payload.targetStatus}</h3>
            <p>Based on revision {conflict.baseRevision}</p>
            <p className="small muted">Device {shortId(conflict.deviceId)}</p>
            <p className="prewrap">
              {conflict.proposed.payload.reason ?? "No reason supplied"}
            </p>
          </article>
          <article>
            <span className="eyebrow">Detection snapshot</span>
            <h3>{conflict.currentTask.status}</h3>
            <p>Revision {conflict.currentRevision}</p>
          </article>
          <article>
            <span className="eyebrow">Fresh coordinator read</span>
            <h3>{liveTask?.status ?? "Unavailable"}</h3>
            <p>Revision {liveTask?.revision ?? "?"}</p>
          </article>
        </div>
        {conflict.status === "resolved" ? (
          <Notice>
            Resolved: {conflict.resolution?.replaceAll("_", " ")}. Resulting
            task revision: {conflict.resultingTaskRevision ?? "unchanged"}.
          </Notice>
        ) : (
          <form className="form-stack" onSubmit={resolve}>
            <label>
              Resolution
              <select
                value={resolution}
                onChange={(event) => {
                  setResolution(
                    event.target.value as ResolveRequest["resolution"],
                  );
                  setConfirmed(false);
                }}
              >
                <option value="keep_authoritative">
                  Keep coordinator state
                </option>
                <option value="retry_proposal">
                  Revalidate original proposal
                </option>
                <option value="custom_transition">
                  Choose a new transition
                </option>
              </select>
            </label>
            {resolution === "custom_transition" && (
              <label>
                New target status
                <select
                  required
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value as TaskStatus);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose a valid transition</option>
                  {liveTask &&
                    transitions[liveTask.status].map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Reason
              <textarea
                required
                rows={3}
                maxLength={2048}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I reviewed this resolution against task revision{" "}
              {liveTask?.revision ?? "?"} and conflict revision{" "}
              {conflict.resolutionRevision}.
            </label>
            <Notice>
              Resolution revalidates the coordinator state machine. It cannot
              force an invalid transition or merge conflicting code.
            </Notice>
            {!authorized && (
              <p className="muted small">
                Requires a fresh connection, sync capability, and authenticated
                reviewer session.
              </p>
            )}
            <div className="action-row">
              <button
                className="button primary"
                disabled={
                  !authorized ||
                  !liveTask ||
                  !confirmed ||
                  !reason.trim() ||
                  busy ||
                  (resolution === "custom_transition" && !target)
                }
              >
                Resolve conflict
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void refreshConflict().catch((err) =>
                    setError(errorMessage(err)),
                  )
                }
              >
                Refresh current values
              </button>
            </div>
          </form>
        )}
        {error && (
          <Notice danger>
            {error} Review refreshed values before trying again.
          </Notice>
        )}
      </div>
    </Modal>
  );
}
