import type { QuoteRequestItem } from "@/lib/bunya-types";

export type StorefrontQuoteDetails = {
  city: string;
  locationHint: string;
  mapsUrl: string;
  desiredReceiptAt: string;
  deliveryMode: "delivery" | "pickup";
  projectName: string;
  recipientName: string;
  recipientMobile: string;
  notes: string;
};

export type PendingStorefrontQuote = {
  version: 1;
  idempotencyKey: string;
  items: QuoteRequestItem[];
  details: StorefrontQuoteDetails;
  savedAt: string;
};

export const emptyStorefrontQuoteDetails: StorefrontQuoteDetails = {
  city: "",
  locationHint: "",
  mapsUrl: "",
  desiredReceiptAt: "",
  deliveryMode: "delivery",
  projectName: "",
  recipientName: "",
  recipientMobile: "",
  notes: "",
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizePendingStorefrontQuote(value: unknown): PendingStorefrontQuote | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 50) return null;
  const idempotencyKey = text(raw.idempotencyKey, 120);
  if (idempotencyKey.length < 8) return null;

  const items: QuoteRequestItem[] = [];
  for (const candidate of raw.items) {
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as Record<string, unknown>;
    const productId = text(item.productId, 40);
    const measurementId = text(item.measurementId, 40);
    const quantity = Number(item.quantity);
    if (!isUuid(productId) || (measurementId && !isUuid(measurementId)) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null;
    items.push({
      id: text(item.id, 100) || `${productId}-${items.length}`,
      productId,
      productName: text(item.productName, 160),
      quantity,
      unit: text(item.unit, 80),
      measurementId,
      measurementLabel: text(item.measurementLabel, 160),
      desiredReceiptDate: text(item.desiredReceiptDate, 20),
      mapsUrl: text(item.mapsUrl, 1000),
      notes: text(item.notes, 1000) || undefined,
      createdAt: text(item.createdAt, 40) || new Date().toISOString(),
    });
  }

  const source = raw.details && typeof raw.details === "object" ? raw.details as Record<string, unknown> : {};
  return {
    version: 1,
    idempotencyKey,
    items,
    details: {
      city: text(source.city, 120),
      locationHint: text(source.locationHint, 300),
      mapsUrl: text(source.mapsUrl, 1000),
      desiredReceiptAt: text(source.desiredReceiptAt, 40),
      deliveryMode: source.deliveryMode === "pickup" ? "pickup" : "delivery",
      projectName: text(source.projectName, 160),
      recipientName: text(source.recipientName, 160),
      recipientMobile: text(source.recipientMobile, 30),
      notes: text(source.notes, 1500),
    },
    savedAt: text(raw.savedAt, 40) || new Date().toISOString(),
  };
}
