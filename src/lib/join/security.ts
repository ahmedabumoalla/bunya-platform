import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

const MAX_BODY_BYTES = 30 * 1024 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

export const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) throw new PublicJoinError("الطلب غير مسموح من هذا المصدر.", 403);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new PublicJoinError("حجم الطلب أكبر من الحد المسموح.", 413);
}

export function enforceRateLimit(request: NextRequest, fingerprint: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const key = createHash("sha256").update(`${ip}:${fingerprint}`).digest("hex");
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) return attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  if (current.count >= MAX_REQUESTS) throw new PublicJoinError("تجاوزت عدد المحاولات المسموح. حاول لاحقًا.", 429);
  current.count += 1;
}

export async function verifyTurnstile(token: string | null, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token) throw new PublicJoinError("تعذر التحقق من الحماية الآلية.", 400);
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, cache: "no-store" });
  const result = (await response.json()) as { success?: boolean };
  if (!response.ok || !result.success) throw new PublicJoinError("تعذر التحقق من الحماية الآلية.", 400);
}

export function normalizeEmail(value: FormDataEntryValue | null) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new PublicJoinError("أدخل بريدًا إلكترونيًا صحيحًا.", 400);
  return email;
}

export function normalizeMobile(value: FormDataEntryValue | null) {
  let mobile = String(value || "").replace(/[\s()-]/g, "");
  if (mobile.startsWith("05")) mobile = `+966${mobile.slice(1)}`;
  else if (mobile.startsWith("5")) mobile = `+966${mobile}`;
  else if (mobile.startsWith("966")) mobile = `+${mobile}`;
  if (!/^\+9665\d{8}$/.test(mobile)) throw new PublicJoinError("أدخل رقم جوال سعوديًا صحيحًا.", 400);
  return mobile;
}

export function requiredText(data: FormData, key: string, min: number, max: number) {
  const value = String(data.get(key) || "").trim();
  if (value.length < min || value.length > max) throw new PublicJoinError("بعض البيانات المطلوبة غير مكتملة أو غير صالحة.", 400);
  return value;
}

export function stringArray(data: FormData, key: string, maxItems = 30) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(data.get(key) || "[]")); } catch { throw new PublicJoinError("صيغة البيانات غير صالحة.", 400); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > maxItems) throw new PublicJoinError("اختر عنصرًا واحدًا على الأقل.", 400);
  const values = [...new Set(parsed.map(String).map((v) => v.trim()).filter((v) => v.length >= 2 && v.length <= 100))];
  if (!values.length) throw new PublicJoinError("اختر عنصرًا واحدًا على الأقل.", 400);
  return values;
}

export function validateFiles(data: FormData) {
  const files = data.getAll("documents").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length > 5) throw new PublicJoinError("الحد الأقصى خمسة مستندات.", 400);
  for (const file of files) {
    if (!allowedMimeTypes.has(file.type) || file.size > 10 * 1024 * 1024) throw new PublicJoinError("يُسمح بملفات PDF أو JPEG أو PNG أو WebP بحد 10 ميجابايت للملف.", 400);
  }
  return files;
}

export function randomObjectName() { return randomBytes(24).toString("hex"); }

export class PublicJoinError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
