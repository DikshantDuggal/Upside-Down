import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { request, ApiError, errorMessage, idPath } from "../api/client";
import {
  agentSchema,
  capabilitiesSchema,
  eventSchema,
  healthSchema,
  localStateSchema,
  patchSchema,
  taskSchema,
  type ActivityEvent,
  type Agent,
  type Capabilities,
  type Conflict,
  type LocalState,
  type Message,
  type Patch,
  type Receipt,
  type Task,
} from "../api/types";
import { mergeEvents, streamUrl, subscribeStream } from "../api/events";

export interface Dashboard {
  mode: "local" | "legacy" | "unavailable";
  loading: boolean;
  refreshing: boolean;
  tasks: Task[];
  agents: Agent[];
  events: ActivityEvent[];
  patches: Patch[];
  messages: Message[];
  conflicts: Conflict[];
  pending: Receipt[];
  local?: LocalState;
  capabilities?: Capabilities;
  cachedAt?: string;
  refreshedAt?: string;
  stale: boolean;
  coordinator: boolean | undefined;
  remoteStream: boolean;
  localStream: boolean;
  error?: string;
  localError?: string;
  capabilityError?: string;
  historyGap: boolean;
}
const empty: Dashboard = {
  mode: "unavailable",
  loading: true,
  refreshing: false,
  tasks: [],
  agents: [],
  events: [],
  patches: [],
  messages: [],
  conflicts: [],
  pending: [],
  stale: true,
  coordinator: undefined,
  remoteStream: false,
  localStream: false,
  historyGap: false,
};

export function useDashboard(enabled = true) {
  const [state, setState] = useState<Dashboard>(empty);
  const [generation, setGeneration] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const active = useRef<AbortController | undefined>(undefined);
  const refreshAgain = useRef(false);
  const refreshWaiter = useRef<
    { promise: Promise<void>; resolve: () => void } | undefined
  >(undefined);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (active.current) {
      refreshAgain.current = true;
      if (!refreshWaiter.current) {
        let resolve!: () => void;
        const promise = new Promise<void>((complete) => {
          resolve = complete;
        });
        refreshWaiter.current = { promise, resolve };
      }
      return refreshWaiter.current.promise;
    }
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    setState((value) => ({ ...value, refreshing: true }));
    try {
      let capabilities: Capabilities | undefined;
      let capabilityError: string | undefined;
      let localError: string | undefined;
      const capPromise = request("/api/capabilities", capabilitiesSchema, {
        signal,
      })
        .then((result) => {
          capabilities = result.value;
        })
        .catch((error) => {
          if (!(error instanceof ApiError && error.status === 404))
            capabilityError = errorMessage(error);
        });
      try {
        const result = await request("/local/state", localStateSchema, {
          signal,
        });
        await capPromise;
        if (signal.aborted) return;
        const local = result.value;
        setState((previous) => {
          const sameDevice = previous.local?.deviceId === local.deviceId;
          const sameEpoch =
            previous.events.at(-1)?.coordinatorEpoch ===
            local.events.at(-1)?.coordinatorEpoch;
          return {
            ...previous,
            mode: "local",
            loading: false,
            refreshing: false,
            local,
            tasks: local.tasks,
            agents: local.agents,
            patches: local.patches,
            messages: local.messages,
            conflicts: local.conflicts,
            pending: local.pending,
            events: mergeEvents(
              sameDevice && sameEpoch ? previous.events : [],
              local.events,
            ),
            stale: local.stale || result.stale,
            cachedAt: local.cachedAt ?? result.cachedAt,
            coordinator: local.health.coordinatorReachable,
            capabilities,
            capabilityError,
            localError: undefined,
            error: undefined,
            refreshedAt: new Date().toISOString(),
          };
        });
        return;
      } catch (error) {
        if (signal.aborted) return;
        localError = errorMessage(error);
      }
      const results = await Promise.allSettled([
        request("/api/tasks", z.array(taskSchema), {
          signal,
          versioned: false,
        }),
        request("/api/agents", z.array(agentSchema), {
          signal,
          versioned: false,
        }),
        request("/api/events?limit=200", z.array(eventSchema), {
          signal,
          versioned: false,
        }),
        request("/api/health", healthSchema, { signal, versioned: false }),
      ] as const);
      await capPromise;
      if (signal.aborted) return;
      const [tasks, agents, events, health] = results;
      const coreAvailable =
        tasks.status === "fulfilled" ||
        agents.status === "fulfilled" ||
        events.status === "fulfilled";
      const errors = results
        .filter((value) => value.status === "rejected")
        .map((value) => errorMessage(value.reason));
      const eventValues =
        events.status === "fulfilled" ? events.value.value : [];
      const patchIds = [
        ...new Set(
          eventValues
            .filter(
              (event) =>
                event.type === "patch_proposed" &&
                typeof event.payload.patchId === "string",
            )
            .map((event) => event.payload.patchId as string),
        ),
      ].slice(-30);
      const patches = await Promise.allSettled(
        patchIds.map((id) =>
          request(`/api/patches/${idPath(id)}`, patchSchema, {
            signal,
            versioned: false,
          }),
        ),
      );
      if (signal.aborted) return;
      const readResults = [tasks, agents, events];
      const allFresh = readResults.every(
        (value) => value.status === "fulfilled" && !value.value.stale,
      );
      const cached = readResults.find(
        (value) => value.status === "fulfilled" && value.value.cachedAt,
      );
      setState((previous) => ({
        ...previous,
        mode: coreAvailable ? "legacy" : "unavailable",
        loading: false,
        refreshing: false,
        local: undefined,
        localError,
        capabilities,
        capabilityError,
        tasks:
          tasks.status === "fulfilled" ? tasks.value.value : previous.tasks,
        agents:
          agents.status === "fulfilled" ? agents.value.value : previous.agents,
        events: mergeEvents(previous.events, eventValues),
        patches: [
          ...new Map(
            [
              ...previous.patches,
              ...patches.flatMap((value) =>
                value.status === "fulfilled" ? [value.value.value] : [],
              ),
            ].map((patch) => [patch.id, patch]),
          ).values(),
        ],
        stale: !allFresh,
        cachedAt:
          cached?.status === "fulfilled"
            ? cached.value.cachedAt
            : previous.cachedAt,
        coordinator: health.status === "fulfilled" && !health.value.stale,
        error: errors.length ? [...new Set(errors)].join(" ") : undefined,
        refreshedAt: allFresh ? new Date().toISOString() : previous.refreshedAt,
      }));
    } catch (error) {
      if (!signal.aborted)
        setState((previous) => ({
          ...previous,
          loading: false,
          refreshing: false,
          stale: true,
          error: errorMessage(error),
        }));
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        refreshWaiter.current?.resolve();
        refreshWaiter.current = undefined;
        if (refreshAgain.current && !signal.aborted) {
          refreshAgain.current = false;
          void refreshRef.current();
        }
      }
    }
  }, [enabled]);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => {
      clearInterval(timer);
      active.current?.abort();
      active.current = undefined;
      refreshAgain.current = false;
      refreshWaiter.current?.resolve();
      refreshWaiter.current = undefined;
    };
  }, [refresh, enabled]);
  const reset = useCallback(() => {
    setState((previous) => ({
      ...previous,
      stale: true,
      events: [],
      historyGap: true,
    }));
    // Refresh from B's persisted cache before reopening either source.
    void refresh().then(() => setGeneration((value) => value + 1));
  }, [refresh]);
  const hasLocal = state.mode === "local";
  const hasApi = state.mode !== "unavailable";
  const replay = state.capabilities?.features.sseReplay ?? false;
  const deviceId = state.local?.deviceId;
  useEffect(() => {
    if (!hasApi) return;
    let opened = false;
    return subscribeStream(
      // B's local stream/cache closes the bootstrap gap. Let native
      // Last-Event-ID resume remote SSE; a fixed `after` would override it.
      streamUrl("/api/events/stream", undefined, true),
      "remote",
      {
        status: (remoteStream) =>
          setState((previous) => ({ ...previous, remoteStream })),
        open: () => {
          if (opened && !replay)
            setState((previous) => ({ ...previous, historyGap: true }));
          opened = true;
          void refresh();
        },
        activity: (event) => {
          setState((previous) => ({
            ...previous,
            events: mergeEvents(previous.events, [event]),
          }));
          void refresh();
        },
        reset,
        invalid: () => {
          setState((previous) => ({
            ...previous,
            error:
              "An invalid activity event was ignored. Refreshing the snapshot.",
            historyGap: true,
          }));
          void refresh();
        },
      },
    );
  }, [hasApi, replay, generation, refresh, reset]);
  useEffect(() => {
    if (!hasLocal) return;
    return subscribeStream(
      streamUrl("/local/events/stream", stateRef.current.local?.localCursor),
      "local",
      {
        status: (localStream) =>
          setState((previous) => ({ ...previous, localStream })),
        change: () => void refresh(),
        reset,
        invalid: () => {
          setState((previous) => ({
            ...previous,
            error: "An invalid local notification was ignored.",
          }));
          void refresh();
        },
      },
    );
  }, [hasLocal, deviceId, generation, refresh, reset]);
  return { ...state, refresh };
}
