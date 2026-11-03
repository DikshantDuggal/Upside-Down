import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentCards } from "../src/features/Agents";
import {
  DiffViewer,
  Evidence,
  PatchDetail,
  verifiedApplication,
} from "../src/features/patches";
import { NewTask, TaskList } from "../src/features/Tasks";
import { configureBrowserSession } from "../src/api/session";
import { Network } from "../src/features/Network";
import type { Dashboard } from "../src/app/useDashboard";
import { evidence, event, localState, patch, task } from "./fixtures";

export const dashboard: Dashboard = {
  mode: "legacy",
  loading: false,
  refreshing: false,
  tasks: [task],
  agents: localState.agents,
  events: [event],
  patches: [patch],
  messages: [],
  conflicts: [],
  pending: [],
  stale: false,
  coordinator: true,
  remoteStream: false,
  localStream: false,
  historyGap: false,
};
beforeEach(() => configureBrowserSession({ canReview: false }));
describe("truthful and accessible presentation", () => {
  it("escapes script-like diff content instead of interpreting HTML", () => {
    const { container } = render(<DiffViewer diff={patch.diffContent} />);
    expect(screen.getByText(/window.TEST_XSS/)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
  it("does not call text output certified test evidence", () => {
    render(
      <PatchDetail
        patch={patch}
        data={{ ...dashboard, refresh: vi.fn() }}
        close={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Legacy mode: approval is a decision only/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Legacy test output · unverified text"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No structured test evidence recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Approve decision/ }),
    ).toBeDisabled();
  });
  it("requires actual passing evidence, successful exit, no timeout and a commit", () => {
    const application = {
      id: "app-1",
      patchId: patch.id,
      taskId: task.id,
      status: "verified" as const,
      expectedBaseCommit: "base",
      targetWorkspaceId: "test",
      diffHash: "hash",
      requestedBy: "reviewer",
      requestedAt: task.createdAt,
      commit: "actual-commit",
      evidence: [evidence],
    };
    expect(verifiedApplication(application)).toBe(true);
    expect(verifiedApplication({ ...application, evidence: [] })).toBe(false);
    expect(
      verifiedApplication({
        ...application,
        evidence: [{ ...evidence, exitCode: 1 }],
      }),
    ).toBe(false);
    render(<Evidence evidence={[{ ...evidence, timedOut: true }]} />);
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.queryByText("passed")).not.toBeInTheDocument();
  });
  it("does not present runtime availability as LLM execution", () => {
    render(<AgentCards agents={localState.agents} selectTask={vi.fn()} />);
    expect(screen.getByText("LLM execution unverified")).toBeInTheDocument();
    expect(screen.getByText("Runtime available")).toBeInTheDocument();
  });
  it("supports keyboard-accessible task filters with an honest empty state", async () => {
    const user = userEvent.setup();
    render(<TaskList tasks={[task]} agents={[]} selectTask={vi.fn()} />);
    await user.type(
      screen.getByRole("textbox", { name: "Search tasks" }),
      "no such task",
    );
    expect(screen.getByText("No matching tasks")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search tasks" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter task status" }),
      "failed",
    );
    expect(screen.getByText("0 tasks")).toBeInTheDocument();
  });
  it("shows stale freshness, independent internet status and unsent records", () => {
    render(
      <Network
        data={{
          ...dashboard,
          mode: "local",
          local: { ...localState, stale: true },
          stale: true,
        }}
        intents={[
          {
            key: crypto.randomUUID(),
            command: {
              type: "task.create",
              payload: { clientTaskId: crypto.randomUUID(), title: "fixture" },
            },
            createdAt: task.createdAt,
            delivery: "unknown",
          },
        ]}
        retry={vi.fn()}
      />,
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Stale/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry original request" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("queued")).not.toBeInTheDocument();
  });
  it("prevents a fresh submission after an ambiguous task-create failure", async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockRejectedValue(new Error("Lost response"));
    render(<NewTask close={vi.fn()} submit={submit} />);
    await user.type(
      screen.getByRole("textbox", { name: "Task title" }),
      "Test task",
    );
    await user.click(screen.getByRole("button", { name: /Queue task/ }));
    await user.click(screen.getByRole("button", { name: /Queue task/ }));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("original request");
  });
});
