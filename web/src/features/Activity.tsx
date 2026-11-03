import {
  Activity,
  ArrowRight,
  GitPullRequest,
  MessageSquare,
  Play,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { ActivityEvent } from "../api/types";
import { Empty, Timestamp, shortId } from "../components/ui";

export function ActivityList({
  events,
  compact = false,
  selectTask,
}: {
  events: ActivityEvent[];
  compact?: boolean;
  selectTask: (id: string) => void;
}) {
  if (!events.length)
    return (
      <Empty title="A quiet workspace">
        Task updates, patch proposals, and team activity will appear here.
      </Empty>
    );
  return (
    <ol className={`activity-list ${compact ? "activity-compact" : ""}`}>
      {[...events]
        .reverse()
        .slice(0, compact ? 6 : 200)
        .map((event) => {
          const Icon = event.type.includes("patch")
            ? GitPullRequest
            : event.type.includes("message")
              ? MessageSquare
              : event.type.includes("test")
                ? ShieldCheck
                : event.type.includes("run")
                  ? Play
                  : event.type.includes("heartbeat")
                    ? Radio
                    : Activity;
          const title = event.type.replaceAll("_", " ").replaceAll(".", " ");
          return (
            <li key={event.id}>
              <div
                className={`event-symbol ${event.type.includes("failed") ? "event-failure" : ""}`}
              >
                <Icon size={16} />
              </div>
              <div className="event-content">
                <div className="event-heading">
                  <strong>{title}</strong>
                  <Timestamp value={event.timestamp} />
                </div>
                {typeof event.payload.title === "string" && (
                  <p>{event.payload.title}</p>
                )}
                {typeof event.payload.from === "string" &&
                  typeof event.payload.to === "string" && (
                    <p className="event-transition">
                      {event.payload.from}
                      <ArrowRight size={12} />
                      {event.payload.to}
                    </p>
                  )}
                <div className="event-meta">
                  <span>{event.source}</span>
                  {event.taskId && (
                    <button
                      className="inline-link"
                      onClick={() => selectTask(event.taskId!)}
                    >
                      Task {shortId(event.taskId)}
                    </button>
                  )}
                </div>
                {!compact && (
                  <details>
                    <summary>Event payload</summary>
                    <pre className="log">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          );
        })}
    </ol>
  );
}
