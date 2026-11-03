import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  ShieldCheck,
} from "lucide-react";
import type { Dashboard } from "../app/useDashboard";
import {
  ApiError,
  errorMessage,
  idPath,
  onlineRequest,
  request,
} from "../api/client";
import {
  applicationSchema,
  patchSchema,
  type Application,
  type Patch,
  type TestEvidence,
} from "../api/types";
import { useBrowserSession } from "../api/session";
import {
  Badge,
  Empty,
  Modal,
  Notice,
  Status,
  Timestamp,
  shortId,
} from "../components/ui";

export function evidencePassed(evidence: TestEvidence) {
  return (
    evidence.passed &&
    evidence.exitCode === 0 &&
    !evidence.timedOut &&
    !!evidence.treeHash
  );
}
export function verifiedApplication(application?: Application) {
  return (
    application?.status === "verified" &&
    !!application.commit &&
    application.evidence.length > 0 &&
    application.evidence.every(evidencePassed)
  );
}
export function Evidence({ evidence }: { evidence?: TestEvidence[] }) {
  if (!evidence?.length)
    return <p className="muted small">No structured test evidence recorded.</p>;
  return (
    <div className="evidence-list">
      {evidence.map((item) => (
        <details className="evidence" key={item.id}>
          <summary>
            <ShieldCheck size={16} />
            <strong>{item.commandProfileId}</strong>
            <Status
              status={
                evidencePassed(item)
                  ? "passed"
                  : item.timedOut
                    ? "timeout"
                    : "failed"
              }
            />
          </summary>
          <div className="evidence-details">
            <dl>
              <dt>Exit code</dt>
              <dd>{item.exitCode ?? "No exit code"}</dd>
              <dt>Tested tree</dt>
              <dd className="mono">{item.treeHash || "Not recorded"}</dd>
              <dt>Tested commit</dt>
              <dd className="mono">{item.testedCommit ?? "Not recorded"}</dd>
              <dt>Started</dt>
              <dd>{new Date(item.startedAt).toLocaleString()}</dd>
              <dt>Ended</dt>
              <dd>{new Date(item.endedAt).toLocaleString()}</dd>
            </dl>
            {item.truncated && (
              <Notice>Output was truncated by the test runner.</Notice>
            )}
            <h4>Standard output</h4>
            <pre className="log">{item.stdout || "(empty)"}</pre>
            <h4>Standard error</h4>
            <pre className="log">{item.stderr || "(empty)"}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}
export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.slice(0, 65536).split("\n");
  const files = [...new Set(diff.match(/^\+\+\+ .+$/gm) ?? [])];
  function download() {
    const url = URL.createObjectURL(
      new Blob([diff], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "proposed.patch";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="diff-view">
      <header>
        <span>
          <FileCode2 size={15} />
          {files.length} changed {files.length === 1 ? "file" : "files"}
        </span>
        <button className="text-button" onClick={download}>
          <Download size={14} />
          Download patch
        </button>
      </header>
      {files.length > 0 && (
        <div className="changed-paths">
          {files.map((file) => (
            <code key={file}>{file.slice(4)}</code>
          ))}
        </div>
      )}
      <pre className="diff" tabIndex={0} aria-label="Proposed code diff">
        {lines.map((line, index) => (
          <span
            key={index}
            className={`diff-line ${line.startsWith("@@") ? "diff-hunk" : line.startsWith("+") && !line.startsWith("+++") ? "diff-added" : line.startsWith("-") && !line.startsWith("---") ? "diff-removed" : ""}`}
          >
            <span className="line-number" aria-hidden="true">
              {index + 1}
            </span>
            {line || " "}
            <br />
          </span>
        ))}
      </pre>
      {diff.length > 65536 && (
        <Notice>
          Preview limited to 64 KiB. Download the full patch to inspect all
          changes.
        </Notice>
      )}
    </div>
  );
}
export function PatchList({
  patches,
  open,
}: {
  patches: Patch[];
  open: (patch: Patch) => void;
}) {
  if (!patches.length)
    return (
      <Empty title="Nothing waiting for review">
        Real patch proposals will appear here when an agent submits one.
        Approval and application are tracked separately.
      </Empty>
    );
  return (
    <div className="review-list">
      {[...patches]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((patch) => (
          <button
            className="review-row"
            key={patch.id}
            onClick={() => open(patch)}
          >
            <span className="review-icon">
              <GitPullRequest size={20} />
            </span>
            <div>
              <strong>Patch {shortId(patch.id)}</strong>
              <span className="muted small">
                Task {shortId(patch.taskId)} ·{" "}
                <Timestamp value={patch.createdAt} />
              </span>
            </div>
            <div className="review-status">
              <span className="small muted">Decision</span>
              <Status status={patch.status} />
            </div>
            <div className="review-status">
              <span className="small muted">Application</span>
              <Status status={patch.applicationStatus ?? "unverified"} />
            </div>
            <ChevronRight size={17} />
          </button>
        ))}
    </div>
  );
}
export function PatchDetail({
  patch: initialPatch,
  data,
  close,
}: {
  patch: Patch;
  data: Dashboard & { refresh: () => Promise<void> };
  close: () => void;
}) {
  const [patch, setPatch] = useState(initialPatch);
  const [application, setApplication] = useState<Application>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [profile, setProfile] = useState("");
  const [reviewChanged, setReviewChanged] = useState(false);
  const session = useBrowserSession();
  const verifiedMode =
    data.capabilities?.patchCompletionMode === "verified_application";
  const task = data.tasks.find((item) => item.id === patch.taskId);
  const online =
    data.mode === "local" &&
    data.coordinator === true &&
    !data.stale &&
    !!session.csrfToken &&
    session.canReview;
  const safe = patch.review?.safe === true;
  const canDecide =
    online &&
    patch.status === "pending" &&
    !reviewChanged &&
    patch.review?.safe !== false &&
    (!verifiedMode ||
      (safe && !!patch.diffHash && patch.taskRevision === task?.revision));
  const canApply =
    online &&
    !reviewChanged &&
    verifiedMode &&
    data.capabilities?.features.patchApply &&
    patch.status === "approved" &&
    safe &&
    !!patch.baseCommit &&
    !!patch.diffHash &&
    patch.taskRevision === task?.revision &&
    !!workspace &&
    !!profile &&
    !["queued", "applying", "verified"].includes(
      application?.status ?? patch.applicationStatus ?? "",
    );
  async function reload() {
    const result = await request(
      `/api/patches/${idPath(patch.id)}`,
      patchSchema,
      { versioned: false },
    );
    setPatch(result.value);
    await data.refresh();
  }
  useEffect(() => {
    if (!patch.applicationId || !data.capabilities?.features.patchApply) return;
    const controller = new AbortController();
    const read = () =>
      request(
        `/api/applications/${idPath(patch.applicationId!)}`,
        applicationSchema,
        { signal: controller.signal },
      )
        .then((result) => setApplication(result.value))
        .catch((err) => {
          if (!controller.signal.aborted) setError(errorMessage(err));
        });
    void read();
    const timer = setInterval(() => void read(), 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [patch.applicationId, data.capabilities?.features.patchApply]);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const body = {
        ...(decision === "reject" ? { reason } : {}),
        ...(verifiedMode
          ? {
              expectedTaskRevision: task?.revision,
              expectedDiffHash: patch.diffHash,
            }
          : {}),
      };
      setPatch(
        (
          await onlineRequest(
            `/api/patches/${idPath(patch.id)}/${decision}`,
            patchSchema,
            body,
            data.local!.deviceId,
          )
        ).value,
      );
      await data.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) {
        setReviewChanged(true);
        await reload().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const result = await onlineRequest(
        `/api/patches/${idPath(patch.id)}/apply`,
        applicationSchema,
        {
          expectedTaskRevision: task!.revision,
          expectedBaseCommit: patch.baseCommit,
          expectedDiffHash: patch.diffHash,
          targetWorkspaceId: workspace,
          testProfileId: profile,
        },
        data.local!.deviceId,
        202,
      );
      setApplication(result.value);
      setPatch((value) => ({
        ...value,
        applicationId: result.value.id,
        applicationStatus: result.value.status,
      }));
      await data.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) {
        setReviewChanged(true);
        await reload().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Review patch ${shortId(patch.id)}`} onClose={close} wide>
      <div className="detail-body">
        <div className="patch-state-grid">
          <div>
            <span className="eyebrow">Human decision</span>
            <Status status={patch.status} />
          </div>
          <div>
            <span className="eyebrow">Code application</span>
            <Status
              status={
                application?.status ?? patch.applicationStatus ?? "unverified"
              }
            />
          </div>
          <div>
            <span className="eyebrow">Verified commit</span>
            <strong className="mono">
              {verifiedApplication(application)
                ? shortId(application?.commit)
                : "Unverified"}
            </strong>
          </div>
        </div>
        <Notice>
          {verifiedMode
            ? "Approval records your decision. Applying is a separate operation that must verify the code and tests."
            : "Legacy mode: approval is a decision only. A legacy done task does not prove that code was applied or tests passed."}
        </Notice>
        <div className="detail-facts">
          <div>
            <span>Base commit</span>
            <code>{patch.baseCommit ?? "Not recorded"}</code>
          </div>
          <div>
            <span>Patch revision / current task</span>
            <strong>
              {patch.taskRevision ?? "?"} / {task?.revision ?? "?"}
            </strong>
          </div>
          <div>
            <span>Diff hash</span>
            <code>{patch.diffHash ?? "Not recorded"}</code>
          </div>
        </div>
        <DiffViewer diff={patch.diffContent} />
        <section className="detail-section">
          <div className="row-between">
            <h3>Safety review</h3>
            <Badge tone={safe ? "green" : patch.review ? "red" : "neutral"}>
              {safe
                ? "Review reports safe"
                : patch.review
                  ? "Unsafe"
                  : "No verdict"}
            </Badge>
          </div>
          {patch.review?.reasons.map((value, index) => (
            <p className="small muted" key={index}>
              {value}
            </p>
          ))}
          {patch.review && (
            <p className="small muted">
              Automated review is supporting evidence; it does not guarantee
              safety.
            </p>
          )}
        </section>
        <section className="detail-section">
          <h3>Test evidence</h3>
          <Evidence evidence={application?.evidence ?? patch.evidence} />
          {patch.testOutput && (
            <details>
              <summary>Legacy test output · unverified text</summary>
              <pre className="log">{patch.testOutput}</pre>
            </details>
          )}
          {application?.commit && (
            <p className="mono commit-line">
              <GitCommitHorizontal size={16} />
              {application.commit}
            </p>
          )}
          {application?.status === "verified" &&
            !verifiedApplication(application) && (
              <Notice>
                Server reports verified, but complete passing evidence and a
                commit are unavailable. Verification remains unconfirmed.
              </Notice>
            )}
          {application?.error && (
            <Notice danger>{application.error.message}</Notice>
          )}
        </section>
        <section className="detail-section">
          <h3>Record a decision</h3>
          {!online && (
            <p className="muted small">
              Requires an authenticated reviewer session, a reachable
              coordinator, and fresh data.
            </p>
          )}
          <label>
            Review reason
            <input
              maxLength={2048}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Required when rejecting"
            />
          </label>
          <div className="action-row">
            <button
              className="button primary"
              disabled={!canDecide || busy}
              onClick={() => void decide("approve")}
            >
              <Check size={16} />
              Approve decision
            </button>
            <button
              className="button secondary"
              disabled={
                !online ||
                patch.status !== "pending" ||
                !reason.trim() ||
                busy ||
                reviewChanged
              }
              onClick={() => void decide("reject")}
            >
              Reject patch
            </button>
          </div>
        </section>
        <section className="detail-section">
          <h3>Apply & verify</h3>
          {!verifiedMode || !data.capabilities?.features.patchApply ? (
            <p className="muted">
              Verified code application is unavailable on this backend.
            </p>
          ) : (
            <>
              <p className="small muted">
                Choose registered server-side IDs. Changed base commits or
                unsafe patches must be reproposed and reviewed.
              </p>
              <div className="form-grid">
                <label>
                  Target workspace ID
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
                className="button primary"
                disabled={!canApply || busy}
                onClick={() => void apply()}
              >
                Apply approved patch
              </button>
            </>
          )}
        </section>
        {reviewChanged && (
          <Notice>
            The server rejected stale values. Review the refreshed revision,
            base, and hash above;{" "}
            <button
              className="inline-link"
              onClick={() => setReviewChanged(false)}
            >
              I have reviewed the updated values
            </button>
            .
          </Notice>
        )}
        {error && <Notice danger>{error}</Notice>}
      </div>
    </Modal>
  );
}
