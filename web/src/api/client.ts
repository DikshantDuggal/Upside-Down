import { z } from "zod";
import { CONTRACT } from "./types";
import { getBrowserSession } from "./session";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = "NETWORK_ERROR",
    readonly details?: Record<string, unknown>,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export interface ApiResult<T> {
  value: T;
  stale: boolean;
  cachedAt?: string;
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
    method?: string;
    versioned?: boolean;
    expectedStatus?: number;
  } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.versioned !== false) headers["X-UD-Contract"] = CONTRACT;
  if (options.body !== undefined) {
    const session = getBrowserSession();
    if (!session.csrfToken) {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      throw new ApiError(
        "An authenticated local session is required. Session integration is not available yet.",
        401,
        "LOCAL_SESSION_REQUIRED",
      );
    }
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = session.csrfToken;
  }
  if (options.key) headers["Idempotency-Key"] = options.key;
  try {
    const response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const record =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      const message =
        typeof record.message === "string"
          ? record.message
          : `Request failed (${response.status} ${response.statusText || "HTTP error"}).`;
      const retry = response.headers.get("Retry-After");
      const seconds = retry === null ? NaN : Number(retry);
      const retryAfterMs =
        retry === null
          ? undefined
          : Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Math.max(0, Date.parse(retry) - Date.now());
      throw new ApiError(
        message,
        response.status,
        typeof record.code === "string"
          ? record.code
          : `HTTP_${response.status}`,
        record.details && typeof record.details === "object"
          ? (record.details as Record<string, unknown>)
          : record,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }
    if (options.expectedStatus && response.status !== options.expectedStatus)
      throw new ApiError(
        `Expected HTTP ${options.expectedStatus}; received ${response.status}. Delivery outcome needs verification.`,
        0,
        "UNEXPECTED_STATUS",
      );
    if (
      options.versioned !== false &&
      response.headers.get("X-UD-Contract") !== CONTRACT
    )
      throw new ApiError(
        "The service did not confirm UD-IC/1.0. Check its contract configuration.",
        426,
        "CONTRACT_MISMATCH",
      );
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new ApiError(
        "The service returned an unexpected response format. Refresh or check the shared contract.",
        0,
        "INVALID_RESPONSE",
      );
    return {
      value: parsed.data,
      stale: response.headers.get("X-UD-Stale") === "true",
      cachedAt: response.headers.get("X-UD-Cached-At") ?? undefined,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError(
        "Request cancelled or timed out. A submitted command may still have been accepted.",
        0,
        "REQUEST_ABORTED",
      );
    throw new ApiError(
      "Cannot reach the service. Check that the local service and coordinator are running.",
      0,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export const idPath = (id: string) => encodeURIComponent(id);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "An unexpected error occurred.";

// Online-only actions never enter the device outbox. Keep their exact key/body
// across ambiguous failures, including a page reload; never auto-retry them.
export async function onlineRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
  scope: string,
  expectedStatus?: number,
) {
  const storageKey = `upside-down:online:v1:${encodeURIComponent(scope)}:${path}`;
  const serialized = JSON.stringify(body);
  const raw = localStorage.getItem(storageKey);
  let key = crypto.randomUUID();
  if (raw) {
    const previous = JSON.parse(raw) as { key?: unknown; body?: unknown };
    if (typeof previous.key !== "string" || previous.body !== serialized)
      throw new ApiError(
        "A previous online action has an unknown outcome. Retry its original values or reconcile the server result before changing them.",
        0,
        "AMBIGUOUS_ACTION",
      );
    key = previous.key as `${string}-${string}-${string}-${string}-${string}`;
  }
  localStorage.setItem(storageKey, JSON.stringify({ key, body: serialized }));
  try {
    const result = await request(path, schema, { body, key, expectedStatus });
    localStorage.removeItem(storageKey);
    return result;
  } catch (error) {
    if (
      error instanceof ApiError &&
      !raw &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 429].includes(error.status)
    )
      localStorage.removeItem(storageKey);
    throw error;
  }
}
