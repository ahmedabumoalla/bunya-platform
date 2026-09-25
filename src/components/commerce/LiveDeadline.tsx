"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./LiveDeadline.module.css";

const formatter = new Intl.DateTimeFormat("ar-SA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

function duration(target: string, now: number) {
  const remaining = Math.max(0, new Date(target).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days ? `${days} يوم · ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function useLiveNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function pricingWindowState(
  opensAt: string,
  startsAt: string,
  deadlineAt: string,
  now: number,
) {
  const opens = new Date(opensAt).getTime();
  const starts = new Date(startsAt).getTime();
  const deadline = new Date(deadlineAt).getTime();
  if (now < opens)
    return {
      kind: "locked" as const,
      canSubmit: false,
      target: opensAt,
      label: "يفتح التسعير بعد",
    };
  if (now < starts)
    return {
      kind: "preview" as const,
      canSubmit: true,
      target: startsAt,
      label: "يبدأ عداد 3 ساعات بعد",
    };
  if (now < deadline)
    return {
      kind: "active" as const,
      canSubmit: true,
      target: deadlineAt,
      label: "الوقت المتبقي للتسعير",
    };
  return {
    kind: "closed" as const,
    canSubmit: false,
    target: deadlineAt,
    label: "انتهت مهلة التسعير",
  };
}

export function LiveDeadline({
  target,
  label,
  expiredLabel = "انتهت الصلاحية",
  tone = "neutral",
  compact = false,
}: {
  target: string;
  label: string;
  expiredLabel?: string;
  tone?: "neutral" | "success" | "warning";
  compact?: boolean;
}) {
  const now = useLiveNow();
  const expired = new Date(target).getTime() <= now;
  const value = useMemo(() => duration(target, now), [target, now]);
  return (
    <div
      className={`${styles.deadline} ${styles[tone]} ${expired ? styles.expired : ""} ${compact ? styles.compact : ""}`}
    >
      <span>{expired ? expiredLabel : label}</span>
      <strong dir="ltr">{expired ? "00:00:00" : value}</strong>
      {!compact ? (
        <small>{formatter.format(new Date(target))} بتوقيت الرياض</small>
      ) : null}
    </div>
  );
}

export function PricingWindow({
  opensAt,
  startsAt,
  deadlineAt,
  compact = false,
}: {
  opensAt: string;
  startsAt: string;
  deadlineAt: string;
  compact?: boolean;
}) {
  const now = useLiveNow();
  const state = pricingWindowState(opensAt, startsAt, deadlineAt, now);
  const tone =
    state.kind === "active"
      ? "success"
      : state.kind === "closed"
        ? "warning"
        : "neutral";
  return (
    <LiveDeadline
      target={state.target}
      label={state.label}
      expiredLabel={state.label}
      tone={tone}
      compact={compact}
    />
  );
}
