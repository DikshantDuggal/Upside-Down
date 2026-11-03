import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import type { Command, Message } from "../api/types";
import { errorMessage } from "../api/client";
import { Empty, Notice, Timestamp, shortId } from "../components/ui";

export function Messages({
  messages,
  submit,
  unavailable,
}: {
  messages: Message[];
  submit: (command: Command) => Promise<void>;
  unavailable?: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (error) return;
    setBusy(true);
    setError("");
    try {
      await submit({
        type: "message.send",
        payload: { messageId: crypto.randomUUID(), text },
      });
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="messages-layout">
      <div className="message-list">
        {messages.length ? (
          [...messages]
            .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
            .map((message) => (
              <article className="message" key={message.id}>
                <header>
                  <span className="owner-initial">
                    {message.senderDeviceId.slice(0, 1).toUpperCase()}
                  </span>
                  <strong>Device {shortId(message.senderDeviceId)}</strong>
                  <Timestamp value={message.createdAt} />
                </header>
                <p className="prewrap">{message.text}</p>
                <span className="small muted">
                  {message.recipientDeviceId
                    ? `To device ${shortId(message.recipientDeviceId)}`
                    : "Team broadcast"}
                </span>
              </article>
            ))
        ) : (
          <Empty title="Keep the team in the loop">
            Messages travel over LAN through the durable local queue.
          </Empty>
        )}
      </div>
      <form className="message-composer form-stack" onSubmit={send}>
        <label>
          Message your team
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Share an update or ask for a review…"
            required
          />
        </label>
        <div className="row-between">
          <span className="muted small">
            {new TextEncoder().encode(text).length}/4096 bytes
          </span>
          <button
            className="button primary"
            disabled={
              busy ||
              !!error ||
              !!unavailable ||
              !text.trim() ||
              new TextEncoder().encode(text).length > 4096
            }
          >
            <Send size={15} />
            Queue message
          </button>
        </div>
        {unavailable && <Notice>{unavailable}</Notice>}
        {error && (
          <Notice danger>
            {error} Retry the saved original request in Network & queue.
          </Notice>
        )}
      </form>
    </div>
  );
}
