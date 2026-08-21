"use client";

import type { ReactNode } from "react";
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
}) {
  const completed = Boolean(successMessage);

  return createPortal(
    <div className="admin-modal-backdrop">
      <section className="admin-modal admin-decision-modal" role="dialog" aria-modal="true" aria-busy={busy}>
        <h3>{title}</h3>
        <p>{description}</p>
        {requiresReason && !completed ? (
          <label>
            <span>السبب أو التعديل المطلوب</span>
            <textarea
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={4}
              placeholder="اكتب توضيحًا واضحًا لمقدم الطلب..."
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
            disabled={busy || completed || (requiresReason && reason.trim().length < 5)}
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
