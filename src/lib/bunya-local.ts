import type {
  ContractorApplication,
  CustomerRegistration,
  ParsedMapLocation,
  ProviderApplication,
} from "./bunya-types";

export const localStorageKeys = {
  customers: "bunya-customer-registrations",
  providers: "bunya-provider-applications",
  contractors: "bunya-contractor-applications",
  resetRequests: "bunya-password-reset-requests",
} as const;

export function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readLocalCollection<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export function appendLocalRecord<T>(key: string, record: T) {
  const records = readLocalCollection<T>(key);
  window.localStorage.setItem(key, JSON.stringify([record, ...records]));
}

export async function createPasswordProof(password: string) {
  const bytes = new TextEncoder().encode(`bunya-local-mock:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validatePassword(password: string) {
  if (password.length < 8) return "يجب ألا تقل كلمة المرور عن 8 أحرف.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "يجب أن تحتوي كلمة المرور على حرف ورقم على الأقل.";
  }
  return "";
}

export function normalizeValue(value: string) {
  return value.trim().toLocaleLowerCase("ar");
}

function validCoordinate(latitude: number, longitude: number) {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function parseGoogleMapsLink(value: string): ParsedMapLocation {
  const trimmed = value.trim();
  if (!trimmed) return { url: "", kind: "invalid", message: "أدخل رابط Google Maps." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { url: trimmed, kind: "invalid", message: "صيغة الرابط غير صحيحة." };
  }

  const host = url.hostname.toLowerCase();
  const isShort = host === "maps.app.goo.gl" || host === "goo.gl" && url.pathname.startsWith("/maps");
  const isGoogleHost = host === "google.com" || host.startsWith("www.google.") || host.startsWith("maps.google.");
  const isGoogleMaps = isShort || isGoogleHost && url.pathname.includes("/maps");
  if (!isGoogleMaps) {
    return { url: trimmed, kind: "invalid", message: "استخدم رابطًا صادرًا من Google Maps." };
  }
  if (isShort) {
    return {
      url: trimmed,
      kind: "short-link",
      message: "سيتم استخراج الإحداثيات تلقائيًا عند ربط خدمة الخادم.",
    };
  }

  const decoded = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`);
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validCoordinate(latitude, longitude)) {
      return { url: trimmed, kind: "coordinates", latitude, longitude, message: "تم استخراج الإحداثيات محليًا بنجاح." };
    }
  }

  return { url: trimmed, kind: "maps-link", message: "الرابط صالح، لكنه لا يحتوي على إحداثيات صريحة." };
}

export type LocalRecord = CustomerRegistration | ProviderApplication | ContractorApplication;
