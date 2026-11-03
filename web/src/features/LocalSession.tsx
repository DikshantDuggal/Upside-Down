import { useState, type FormEvent } from "react";
import { KeyRound, Link2, Sparkles } from "lucide-react";
import { errorMessage } from "../api/client";
import type { useLocalSession } from "../app/useLocalSession";
import { Badge, Modal, Notice } from "../components/ui";
import { useBrowserSession } from "../api/session";

export function LocalSessionCard({
  session,
  open,
}: {
  session: ReturnType<typeof useLocalSession>;
  open: () => void;
}) {
  const browser = useBrowserSession();
  return (
    <section className="panel session-card">
      <div className="session-icon">
        <Link2 size={22} />
      </div>
      <div>
        <div className="row-between">
          <h3>Browser connection</h3>
          <Badge tone={session.status === "paired" ? "green" : "amber"}>
            {session.status === "paired"
              ? "Paired"
              : session.status === "required"
                ? "Pairing required"
                : session.status}
          </Badge>
        </div>
        <p>
          {session.status === "paired"
            ? browser.canReview
              ? "This browser is paired. Reviewer authority was verified with the coordinator."
              : "This browser is paired. Reviewer actions require a separately verified credential."
            : "Pair with your own local service to read its durable cache and queue commands. Device bearer tokens stay outside the browser."}
        </p>
        {session.error && <p className="small text-red">{session.error}</p>}
      </div>
      {session.status !== "paired" && (
        <div className="action-row">
          <button
            className="button secondary"
            onClick={() => void session.restore()}
          >
            Check session
          </button>
          {typeof session.pairDev === "function" && (
            <button
              className="button secondary"
              onClick={() => void session.pairDev()}
            >
              <Sparkles size={14} />
              Auto-pair (Dev)
            </button>
          )}
          <button className="button primary" onClick={open}>
            <KeyRound size={15} />
            Pair browser
          </button>
        </div>
      )}
    </section>
  );
}
export function PairBrowser({
  pair,
  close,
}: {
  pair: (key: string) => Promise<void>;
  close: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const value = key.trim();
    setKey(""); // Never persist a pairing credential or add it to command records.
    try {
      await pair(value);
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoPair() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/dev-pairing-key");
      if (!res.ok) throw new Error("Local dev key not available from dev server");
      const data = await res.json();
      if (typeof data.pairingKey === "string" && data.pairingKey.length >= 32) {
        await pair(data.pairingKey);
        close();
      } else {
        throw new Error("Invalid pairing key received");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Pair this browser" onClose={close}>
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">
          Use the pairing key created by the local service on this computer. It
          is stored in the private <code>.session.json</code> file beside the
          device database.
        </p>
        <label>
          Local pairing key
          <input
            type="password"
            data-initial-focus
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            minLength={32}
            required
            placeholder="Paste your local pairing key"
          />
        </label>
        <Notice>
          The key is sent only to this computer’s configured local service and
          is not saved in browser storage. A device bearer token belongs in the
          local service configuration.
        </Notice>
        {error && (
          <Notice danger>
            {error} If a response was interrupted, check the existing session
            before pairing again.
          </Notice>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={handleAutoPair}
          >
            <Sparkles size={14} />
            Auto-Pair (Local Dev)
          </button>
          <button
            className="button primary"
            disabled={busy || key.trim().length < 32}
          >
            {busy ? "Pairing…" : "Pair browser"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
