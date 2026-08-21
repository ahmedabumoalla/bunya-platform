export function normalizeJoinUsername(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, "_").slice(0, 40);
}

export function isValidJoinUsername(value: string) {
  return value.length >= 4 && value.length <= 40 && !/\s/u.test(value);
}
