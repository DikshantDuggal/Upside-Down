import { Bot, Cpu, CornerDownRight } from "lucide-react";
import type { Agent } from "../api/types";
import { Empty, Status, Timestamp, shortId } from "../components/ui";

export function AgentCards({
  agents,
  selectTask,
}: {
  agents: Agent[];
  selectTask: (id: string) => void;
}) {
  if (!agents.length)
    return (
      <Empty title="Your agents will meet here">
        Registered agents appear when the coordinator reports them. No agent
        activity has been recorded.
      </Empty>
    );
  return (
    <div className="agent-grid">
      {agents.map((agent, index) => (
        <article className="agent-card" key={agent.id}>
          <div className="agent-top">
            <span className={`agent-avatar avatar-${index % 3}`}>
              <Bot size={23} />
            </span>
            <Status status={agent.status} />
          </div>
          <h3>{agent.name}</h3>
          <div className="mono muted small">{agent.id}</div>
          <div className="agent-facts">
            <span>
              <Cpu size={13} />
              Runtime {agent.runtimeAvailable ? "available" : "unavailable"}
            </span>
            <span>LLM execution unverified</span>
          </div>
          <footer>
            {agent.currentTaskId ? (
              <button
                className="inline-link"
                onClick={() => selectTask(agent.currentTaskId!)}
              >
                <CornerDownRight size={14} />
                Task {shortId(agent.currentTaskId)}
              </button>
            ) : (
              <span className="muted">No current task</span>
            )}
            <span className="small muted">
              Seen <Timestamp value={agent.lastSeenAt} />
            </span>
          </footer>
        </article>
      ))}
    </div>
  );
}
