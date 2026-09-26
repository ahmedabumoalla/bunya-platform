"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function AdminHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="admin-page-header"><div><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>{action}</header>;
}

export function AdminStatus({ value }: { value: string }) {
  return <span className="admin-status">{value}</span>;
}

export function AdminEmpty({ text }: { text: string }) {
  return <section className="admin-empty"><p>{text}</p></section>;
}

export function AdminToast({ message }: { message: string }) {
  return message ? <p className="admin-toast" role="status">{message}</p> : null;
}

export function AdminDecisionDialog({
  title,
  description,
  reason,
  onReason,
  onCancel,
  onConfirm,
  requiresReason = true,
  confirmLabel = "تأكيد",
  busy = false,
  successMessage = "",
  errorMessage = "",
  reasonLabel = "السبب أو التعديل المطلوب",
  minimumReasonLength = 5,
}: {
  title: string;
  description: string;
  reason: string;
  onReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  requiresReason?: boolean;
  confirmLabel?: string;
  busy?: boolean;
  successMessage?: string;
  errorMessage?: string;
  reasonLabel?: string;
  minimumReasonLength?: number;
}) {
  const completed = Boolean(successMessage);
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);

  return createPortal(
    <div className="admin-modal-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="admin-modal admin-decision-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onKeyDown={event => {
        if (event.key === "Escape" && !busy && !completed) { event.stopPropagation(); onCancel(); }
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), a[href]")];
        const first = items[0], last = items[items.length - 1];
        if (!items.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
        <h3 id={titleId}>{title}</h3>
        <p>{description}</p>
        {requiresReason && !completed ? (
          <label>
            <span>{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={4}
              placeholder={reasonLabel}
              autoFocus
              disabled={busy}
            />
          </label>
        ) : null}
        {errorMessage ? <p className="admin-decision-feedback admin-decision-error" role="alert">{errorMessage}</p> : null}
        {successMessage ? (
          <p className="admin-decision-feedback admin-decision-success" role="status">
            <span aria-hidden="true">✓</span>
            {successMessage}
          </p>
        ) : null}
        <footer>
          <button type="button" className="admin-action-button admin-action-neutral" onClick={onCancel} disabled={busy || completed}>إلغاء</button>
          <button
            type="button"
            className="admin-action-button admin-action-approve"
            onClick={() => void onConfirm()}
            disabled={busy || completed || (requiresReason && reason.trim().length < minimumReasonLength)}
          >
            {completed ? (
              <><span className="admin-action-check" aria-hidden="true">✓</span> تمت العملية</>
            ) : busy ? (
              <><span className="admin-action-spinner" aria-hidden="true" /> جاري التنفيذ...</>
            ) : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
