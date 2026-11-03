import { useSyncExternalStore } from "react";

export interface BrowserSession {
  csrfToken?: string;
  canReview: boolean;
}
declare global {
  interface Window {
    upsideDownSession?: { update: typeof configureBrowserSession };
  }
}
let current: BrowserSession = { canReview: false };
const listeners = new Set<() => void>();
export const SESSION_EXPIRED = "upside-down:session-expired";
export function expireBrowserSession() {
  configureBrowserSession({ canReview: false });
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SESSION_EXPIRED));
}

// Integration hook for B's authenticated same-origin host. This is a UI hint;
// authorization always belongs to A/B. Never accepts a device bearer token.
export function configureBrowserSession(session: BrowserSession) {
  current = {
    csrfToken: session.csrfToken,
    canReview: session.canReview === true,
  };
  for (const listener of listeners) listener();
}
export function getBrowserSession() {
  return current;
}
export function useBrowserSession() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getBrowserSession);
}
