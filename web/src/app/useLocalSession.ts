import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ApiError, errorMessage, request } from "../api/client";
import {
  configureBrowserSession,
  SESSION_EXPIRED,
  useBrowserSession,
} from "../api/session";
import { CONTRACT } from "../api/types";

// Additive handshake accepted by A, B and frontend on the team board.
const sessionSchema = z.object({
  contractVersion: z.literal(CONTRACT),
  csrfToken: z.string().min(32),
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
      if (err instanceof ApiError && err.status === 401) {
        configureBrowserSession({ canReview: false });
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
