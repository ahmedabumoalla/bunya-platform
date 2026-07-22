const legacyAuthKeys = [
  "bunya-local-session",
  "bunya-driver-sessions",
  "bunya-driver-password-change",
  "bunya-password-reset-requests",
  "bunya-local-password-reset",
  "bunya-demo-seed-version",
];

const collectionsThatMayContainLegacyPasswords = [
  "bunya-customer-registrations",
  "bunya-provider-applications",
  "bunya-contractor-applications",
  "bunya-provider-drivers",
  "bunya-admin-users",
];

export function clearLegacyAuthStorage() {
  if (typeof window === "undefined") return;

  legacyAuthKeys.forEach((key) => window.localStorage.removeItem(key));
  collectionsThatMayContainLegacyPasswords.forEach(stripLegacyPasswordFields);
}

function stripLegacyPasswordFields(key: string) {
  const raw = window.localStorage.getItem(key);
  if (!raw) return;

  try {
    const parsed: unknown = JSON.parse(raw);
    const sanitized = sanitize(parsed);
    window.localStorage.setItem(key, JSON.stringify(sanitized));
  } catch {
    // Operational data is preserved if an old value is not valid JSON.
  }
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "passwordProof" && key !== "password")
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}
