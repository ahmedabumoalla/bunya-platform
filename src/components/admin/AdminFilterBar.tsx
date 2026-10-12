"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { AdminIcon } from "./AdminIcon";
import { useDialogFocus } from "./useDialogFocus";
import styles from "./AdminFilterBar.module.css";

export type AdminFilterOption = {
  key: string;
  label: string;
  value: string;
  defaultValue: string;
  options: { value: string; label: string }[];
};

type Props = {
  query?: string;
  onQueryChange?: (value: string) => void;
  searchLabel?: string;
  placeholder?: string;
  resultText?: ReactNode;
  filters: AdminFilterOption[];
  onApply: (values: Record<string, string>) => void;
};

function FilterDialog({ filters, onApply, onClose }: Pick<Props, "filters" | "onApply"> & { onClose: () => void }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(filters.map(filter => [filter.key, filter.value])));
  const dialogRef = useDialogFocus();
  const titleId = useId();
  useEffect(() => {
    const unlock = lockBodyScroll();
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", dismiss);
    return () => { unlock(); document.removeEventListener("keydown", dismiss); };
  }, [onClose]);

  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} dir="rtl">
      <header className={styles.heading}><div><AdminIcon name="settings"/><h2 id={titleId}>تصفية النتائج</h2></div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="إغلاق التصفية"><AdminIcon name="close"/></button></header>
      <form onSubmit={event => { event.preventDefault(); onApply(draft); onClose(); }}>
        <div className={styles.fields}>{filters.map(filter => <label key={filter.key}><span>{filter.label}</span><select value={draft[filter.key]} onChange={event => setDraft(current => ({ ...current, [filter.key]: event.target.value }))}>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div>
        <footer className={styles.footer}><button type="button" className={styles.reset} onClick={() => setDraft(Object.fromEntries(filters.map(filter => [filter.key, filter.defaultValue])))}>إعادة الضبط</button><button type="submit" className={styles.apply}>تطبيق الفلاتر</button></footer>
      </form>
    </section>
  </div>, document.body);
}

export function AdminFilterBar({ query = "", onQueryChange, searchLabel = "البحث", placeholder = "ابحث…", resultText, filters, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const activeCount = filters.filter(filter => filter.value !== filter.defaultValue).length;
  return <div className={styles.bar}>
    <div className={styles.controls}>
      {onQueryChange && <label className={styles.search}><AdminIcon name="search" size={18}/><input type="search" value={query} onChange={event => onQueryChange(event.target.value)} aria-label={searchLabel} placeholder={placeholder}/>{query && <button type="button" onClick={() => onQueryChange("")} aria-label="مسح البحث"><AdminIcon name="close" size={16}/></button>}</label>}
      {filters.length > 0 && <button type="button" className={styles.trigger} data-active={activeCount > 0} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={activeCount ? `تصفية، ${activeCount} فلاتر مفعلة` : "تصفية النتائج"}><AdminIcon name="settings" size={18}/><span>تصفية</span>{activeCount > 0 && <b>{activeCount}</b>}</button>}
    </div>
    {resultText != null && <div className={styles.result} role="status">{resultText}</div>}
    {open && <FilterDialog filters={filters} onApply={onApply} onClose={close}/>}
  </div>;
}
