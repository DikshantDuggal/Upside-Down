import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Inbox, X } from "lucide-react";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "violet";
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Status({ status }: { status: string }) {
  const tone = [
    "done",
    "verified",
    "applied",
    "approved",
    "connected",
    "passed",
  ].includes(status)
    ? "green"
    : ["failed", "error", "rejected", "timeout"].includes(status)
      ? "red"
      : [
            "blocked",
            "conflict",
            "queued",
            "sending",
            "unknown",
            "stale",
          ].includes(status)
        ? "amber"
        : ["running", "review", "applying"].includes(status)
          ? "violet"
          : "neutral";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={23} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function SectionHead({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function PanelLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Timestamp({ value }: { value?: string }) {
  return value ? (
    <time dateTime={value} title={new Date(value).toLocaleString()}>
      {new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  ) : (
    <span>Not recorded</span>
  );
}
export function shortId(id?: string) {
  return id ? id.slice(0, 8) : "Unassigned";
}
export function Notice({
  children,
  danger = false,
}: {
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`notice ${danger ? "notice-danger" : ""}`}
      role={danger ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
