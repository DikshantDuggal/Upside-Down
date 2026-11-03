import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ApiError, errorMessage, request } from "../api/client";
import {
  configureBrowserSession,
  getBrowserSession,
  SESSION_EXPIRED,
  useBrowserSession,
} from "../api/session";
import { CONTRACT } from "../api/types";

// Additive handshake accepted by A, B and frontend on the team board.
const sessionSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  csrfToken: z.string().min(32),
});
const authorizationSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  authorization: z.object({
    role: z.enum(["device", "reviewer", "admin"]),
    canReview: z.boolean(),
  }),
});
export function useLocalSession() {
  const session = useBrowserSession();
  const [status, setStatus] = useState<
    "checking" | "required" | "paired" | "unavailable" | "unsupported"
  >("checking");
  const [error, setError] = useState("");
  const restore = useCallback(async (signal?: AbortSignal) => {
    setStatus("checking");
    setError("");
    try {
      const result = await request("/local/session", sessionSchema, { signal });
      if (signal?.aborted) return;
      configureBrowserSession({
        csrfToken: result.value.csrfToken,
        canReview: false,
      });
      setStatus("paired");
    } catch (err) {
      if (signal?.aborted) return;
      configureBrowserSession({ canReview: false });
      if (err instanceof ApiError && err.status === 401) {
        setStatus("required");
      } else {
        setStatus(
          err instanceof ApiError && err.status === 404
            ? "unsupported"
            : "unavailable",
        );
        setError(errorMessage(err));
      }
    }
  }, []);
  useEffect(() => {
    const csrfToken = session.csrfToken;
    if (!csrfToken) return;
    const controller = new AbortController();
    let checking = false;
    const verify = async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      let canReview = false;
      try {
        const result = await request(
          "/local/authorization",
          authorizationSchema,
          {
            signal: controller.signal,
          },
        );
        canReview =
          !result.stale &&
          result.value.authorization.canReview &&
          ["reviewer", "admin"].includes(result.value.authorization.role);
      } catch {
        /* Older/unreachable services and revoked credentials stay unprivileged. */
      } finally {
        checking = false;
      }
      // A response for an expired/replaced session must never resurrect it.
      if (
        !controller.signal.aborted &&
        getBrowserSession().csrfToken === csrfToken
      )
        configureBrowserSession({ csrfToken, canReview });
    };
    void verify();
    const timer = window.setInterval(() => void verify(), 30_000);
    const focused = () => void verify();
    window.addEventListener("focus", focused);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", focused);
    };
  }, [session.csrfToken]);
  const pair = useCallback(async (pairingKey: string) => {
    const result = await request("/local/session", sessionSchema, {
      body: { pairingKey },
      sessionBootstrap: true,
    });
    configureBrowserSession({
      csrfToken: result.value.csrfToken,
      canReview: false,
    });
    setStatus("paired");
    setError("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void restore(controller.signal);
    const expired = () => {
      setStatus("required");
      setError(
        "The local session expired or the service restarted. Pair this browser again; saved commands retain their original keys.",
      );
    };
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_EXPIRED, expired);
    };
  }, [restore]);
  return {
    status: session.csrfToken ? ("paired" as const) : status,
    error,
    restore,
    pair,
  };
}
