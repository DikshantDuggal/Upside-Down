import {
  Cloud,
  Database,
  HardDrive,
  Radio,
  RotateCw,
  Server,
  Wifi,
} from "lucide-react";
import type { Dashboard } from "../app/useDashboard";
import type { Intent } from "./commands";
import { Empty, Notice, Status, Timestamp, shortId } from "../components/ui";

export function Network({
  data,
  intents,
  storageError,
  retry,
}: {
  data: Dashboard;
  intents: Intent[];
  storageError?: string;
  retry: (intent: Intent) => void;
}) {
  const receipts = [
    ...new Map(
      [
        ...intents.flatMap((intent) =>
          intent.receipt ? [intent.receipt] : [],
        ),
        ...data.pending,
      ].map((receipt) => [receipt.eventId, receipt]),
    ).values(),
  ];
  const local = data.mode === "local";
  const dimensions = [
    {
      Icon: HardDrive,
      label: "Local service",
      value: local ? "Reachable" : "Unavailable",
      detail: "Durable queue and device cache",
      ok: local,
    },
    {
      Icon: Server,
      label: "Coordinator",
      value:
        data.coordinator === true
          ? "Reachable"
          : data.coordinator === false
            ? "Unreachable"
            : "Unknown",
      detail: "Authoritative tasks and revisions",
      ok: data.coordinator === true,
    },
    {
      Icon: Wifi,
      label: "LAN route",
      value: data.coordinator ? "Coordinator reachable" : "Unconfirmed",
      detail: "A failed request does not prove LAN failure",
      ok: data.coordinator === true,
    },
    {
      Icon: Cloud,
      label: "Internet",
      value:
        data.local?.health.internetReachable === true
          ? "Reachable"
          : data.local?.health.internetReachable === false
            ? "Unreachable"
            : "Unknown",
      detail: "Internet is not required for LAN sync",
      ok: data.local?.health.internetReachable === true,
    },
  ];
  return (
    <>
      <div className="network-grid">
        {dimensions.map(({ Icon, label, value, detail, ok }) => (
          <article className="network-card" key={label}>
            <Icon size={21} />
            <span className="eyebrow">{label}</span>
            <h3 className={ok ? "text-green" : ""}>{value}</h3>
            <p>{detail}</p>
          </article>
        ))}
      </div>
      <div className="network-details panel">
        <div>
          <Database size={18} />
          <span>Device identity</span>
          <code>{data.local?.deviceId ?? "Not available"}</code>
        </div>
        <div>
          <RotateCw size={18} />
          <span>Last sync</span>
          <Timestamp value={data.local?.health.lastSyncAt} />
        </div>
        <div>
          <Radio size={18} />
          <span>Event streams</span>
          <span>
            Local {data.localStream ? "connected" : "disconnected"} · Remote{" "}
            {data.remoteStream ? "connected" : "disconnected"}
          </span>
        </div>
        <div>
          <Database size={18} />
          <span>Cache freshness</span>
          <span>
            {data.stale ? "Stale" : "Fresh"} ·{" "}
            <Timestamp value={data.cachedAt ?? data.refreshedAt} />
          </span>
        </div>
      </div>
      {data.localError && <Notice>Local service: {data.localError}</Notice>}
      {data.capabilityError && (
        <Notice>
          Capabilities could not be confirmed: {data.capabilityError} Proposed
          controls remain unavailable.
        </Notice>
      )}
      {data.local?.health.lastError && (
        <Notice danger>{data.local.health.lastError.message}</Notice>
      )}
      {storageError && (
        <Notice danger>
          {storageError} Browser request records are unavailable. New commands
          are disabled so ambiguous requests cannot lose their retry keys.
        </Notice>
      )}
      <div className="section-head">
        <div>
          <div className="eyebrow">Delivery you can trace</div>
          <h2>Command queue</h2>
        </div>
        <span className="small muted">
          {data.local?.health.pendingCount ?? "Unknown"} service-pending
        </span>
      </div>
      <p className="muted small">
        A queued receipt confirms local SQLite acceptance. Applied means
        coordinator acceptance; conflict and rejected are separate terminal
        outcomes. Browser records below are unsent drafts or retry records,
        never a replacement for the durable queue.
      </p>
      {!receipts.length && !intents.length ? (
        <Empty title="No commands waiting">
          Accepted commands and their acknowledgements will appear here.
        </Empty>
      ) : (
        <div className="queue-list">
          {intents.map((intent) => (
            <article className="queue-row" key={intent.key}>
              <div>
                <strong>{intent.command.type}</strong>
                <span className="mono small muted">
                  Request {shortId(intent.key)} ·{" "}
                  <Timestamp value={intent.createdAt} />
                </span>
                {intent.error && (
                  <p className="small text-red">{intent.error}</p>
                )}
              </div>
              <Status status={intent.receipt?.state ?? intent.delivery} />
              {intent.delivery !== "queued" && (
                <button
                  className="button secondary"
                  disabled={!local || !!storageError}
                  onClick={() => retry(intent)}
                >
                  Retry original request
                </button>
              )}
            </article>
          ))}
          {receipts
            .filter(
              (receipt) =>
                !intents.some(
                  (intent) => intent.receipt?.eventId === receipt.eventId,
                ),
            )
            .map((receipt) => (
              <article className="queue-row" key={receipt.eventId}>
                <div>
                  <strong>Service command {shortId(receipt.eventId)}</strong>
                  <span className="small muted">
                    Sequence {receipt.sequence} · {receipt.attempts} attempts
                  </span>
                </div>
                <Status status={receipt.state} />
              </article>
            ))}
        </div>
      )}
    </>
  );
}
