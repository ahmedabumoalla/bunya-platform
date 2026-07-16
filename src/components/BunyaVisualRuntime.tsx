"use client";

import {useEffect} from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleDialogs() {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']"))
    .filter((dialog) => dialog.getClientRects().length > 0);
}

function focusables(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

function closeDialog(dialog: HTMLElement) {
  const explicit = dialog.querySelector<HTMLButtonElement>(
    "[data-dialog-close],button[aria-label*='إغلاق'],.provider-modal-close,.store-close-button",
  );
  if (explicit) return explicit.click();

  const semantic = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => ["×", "إلغاء", "تراجع", "إغلاق"].includes(button.textContent?.trim() ?? ""));
  semantic?.click();
}

/** Accessibility behaviour shared by existing presentation dialogs only. */
export function BunyaVisualRuntime() {
  useEffect(() => {
    const previousFocus = new WeakMap<HTMLElement, HTMLElement>();

    const prepare = (dialog: HTMLElement) => {
      if (dialog.dataset.bunyaDialogReady === "true") return;
      dialog.dataset.bunyaDialogReady = "true";
      dialog.tabIndex = -1;
      const active = document.activeElement;
      if (active instanceof HTMLElement) previousFocus.set(dialog, active);
      dialog.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        if (button.textContent?.trim() === "×" && !button.getAttribute("aria-label")) {
          button.setAttribute("aria-label", "إغلاق النافذة");
        }
      });
      window.requestAnimationFrame(() => (focusables(dialog)[0] ?? dialog).focus());
    };

    visibleDialogs().forEach(prepare);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[role='dialog'][aria-modal='true']")) prepare(node);
          node.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']").forEach(prepare);
        });
        record.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const removed = node.matches("[role='dialog']") ? node : node.querySelector<HTMLElement>("[role='dialog']");
          const previous = removed ? previousFocus.get(removed) : undefined;
          if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus());
        });
      });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = visibleDialogs().at(-1);
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(dialog);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    observer.observe(document.body, {childList: true, subtree: true});
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
