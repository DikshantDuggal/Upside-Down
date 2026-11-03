import { eventSchema, type ActivityEvent, CONTRACT } from "./types";

export function mergeEvents(
  current: ActivityEvent[],
  incoming: ActivityEvent[],
  limit = 200,
) {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming)
    if (!byId.has(event.id)) byId.set(event.id, event);
  // Insertion order preserves canonical journal order, including timestamp ties.
  return [...byId.values()].slice(-limit);
}
export interface StreamCallbacks {
  activity?: (event: ActivityEvent) => void;
  change?: () => void;
  reset: () => void;
  status: (connected: boolean) => void;
  invalid: () => void;
  open?: () => void;
}
export function subscribeStream(
  path: string,
  mode: "remote" | "local",
  callbacks: StreamCallbacks,
  factory: (url: string) => EventSource = (url) =>
    new EventSource(url, { withCredentials: true }),
) {
  const source = factory(path);
  const onOpen = () => {
    callbacks.status(true);
    callbacks.open?.();
  };
  const onError = () => callbacks.status(false);
  const onReset = () => {
    source.close();
    callbacks.status(false);
    callbacks.reset();
  };
  const onActivity = (event: Event) => {
    try {
      const value = eventSchema.parse(JSON.parse((event as MessageEvent).data));
      callbacks.activity?.(value);
    } catch {
      callbacks.invalid();
    }
  };
  const onChange = (event: Event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as Record<
        string,
        unknown
      >;
      if (
        typeof data.localCursor !== "string" ||
        !["queued", "ack", "pull", "health"].includes(String(data.reason))
      )
        throw new Error("Invalid local event");
      callbacks.change?.();
    } catch {
      callbacks.invalid();
    }
  };
  const listeners: [string, EventListener][] = [
    ["open", onOpen],
    ["error", onError],
    ["reset", onReset],
    [
      mode === "local" ? "local_change" : "activity",
      mode === "local" ? onChange : onActivity,
    ],
  ];
  for (const [name, listener] of listeners)
    source.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of listeners)
      source.removeEventListener(name, listener);
    source.close();
    callbacks.status(false);
  };
}
export function streamUrl(path: string, after?: string, versioned = true) {
  const params = new URLSearchParams();
  if (versioned) params.set("contractVersion", CONTRACT);
  if (after !== undefined) params.set("after", after);
  return `${path}${params.size ? `?${params}` : ""}`;
}
