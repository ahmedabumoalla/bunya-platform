import type { QuoteRequestItem, QuoteVariantSelection } from "@/lib/bunya-types";

export type StorefrontQuoteDetails = {
  locationHint: string;
  mapsUrl: string;
  desiredReceiptAt: string;
  deliveryMode: "delivery" | "pickup";
  projectName: string;
  recipientName: string;
  recipientMobile: string;
  siteResponsibleName: string;
  siteResponsibleMobile: string;
  contractorName: string;
  contractorMobile: string;
  siteHoursStart: string;
  siteHoursEnd: string;
  workingHours: string;
  loadingOption: string;
  unloadingOption: string;
  roadAccess: string;
  accessInstructions: string;
  driverDepartureLiabilityAccepted: boolean;
  dataAccuracyAccepted: boolean;
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
  locationHint: "",
  mapsUrl: "",
  desiredReceiptAt: "",
  deliveryMode: "delivery",
  projectName: "",
  recipientName: "",
  recipientMobile: "",
  siteResponsibleName: "",
  siteResponsibleMobile: "",
  contractorName: "",
  contractorMobile: "",
  siteHoursStart: "07:00",
  siteHoursEnd: "16:00",
  workingHours: "من 07:00 إلى 16:00",
  loadingOption: "",
  unloadingOption: "",
  roadAccess: "",
  accessInstructions: "",
  driverDepartureLiabilityAccepted: false,
  dataAccuracyAccepted: false,
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
    const selectedVariants: QuoteVariantSelection[] = [];
    if (Array.isArray(item.selectedVariants)) {
      for (const candidateVariant of item.selectedVariants.slice(0, 20)) {
        if (!candidateVariant || typeof candidateVariant !== "object") return null;
        const variant = candidateVariant as Record<string, unknown>;
        const id = text(variant.id, 40);
        if (!isUuid(id) || !Array.isArray(variant.attributes)) return null;
        selectedVariants.push({
          id,
          name: text(variant.name, 160),
          attributes: variant.attributes.slice(0, 20).map((candidateAttribute) => {
            const attribute = candidateAttribute && typeof candidateAttribute === "object"
              ? candidateAttribute as Record<string, unknown>
              : {};
            return {
              label: text(attribute.label, 80),
              value: text(attribute.value, 160),
            };
          }).filter((attribute) => attribute.label && attribute.value),
        });
      }
    }
    items.push({
      id: text(item.id, 100) || `${productId}-${items.length}`,
      productId,
      productName: text(item.productName, 160),
      quantity,
      unit: text(item.unit, 80),
      measurementId,
      measurementLabel: text(item.measurementLabel, 160),
      selectedVariants,
      desiredReceiptDate: text(item.desiredReceiptDate, 20),
      mapsUrl: text(item.mapsUrl, 1000),
      notes: text(item.notes, 1000) || undefined,
      createdAt: text(item.createdAt, 40) || new Date().toISOString(),
    });
  }

  const source = raw.details && typeof raw.details === "object" ? raw.details as Record<string, unknown> : {};
  const siteHoursStart = text(source.siteHoursStart, 5) || "07:00";
  const siteHoursEnd = text(source.siteHoursEnd, 5) || "16:00";
  return {
    version: 1,
    idempotencyKey,
    items,
    details: {
      locationHint: text(source.locationHint, 300),
      mapsUrl: text(source.mapsUrl, 1000),
      desiredReceiptAt: text(source.desiredReceiptAt, 40),
      deliveryMode: source.deliveryMode === "pickup" ? "pickup" : "delivery",
      projectName: text(source.projectName, 160),
      recipientName: text(source.recipientName, 160),
      recipientMobile: text(source.recipientMobile, 30),
      siteResponsibleName: text(source.siteResponsibleName, 160),
      siteResponsibleMobile: text(source.siteResponsibleMobile, 30),
      contractorName: text(source.contractorName, 160),
      contractorMobile: text(source.contractorMobile, 30),
      siteHoursStart,
      siteHoursEnd,
      workingHours: text(source.workingHours, 300) || `من ${siteHoursStart} إلى ${siteHoursEnd}`,
      loadingOption: text(source.loadingOption, 160),
      unloadingOption: text(source.unloadingOption, 160),
      roadAccess: text(source.roadAccess, 160),
      accessInstructions: text(source.accessInstructions, 500),
      driverDepartureLiabilityAccepted: source.driverDepartureLiabilityAccepted === true,
      dataAccuracyAccepted: source.dataAccuracyAccepted === true,
      notes: text(source.notes, 1500),
    },
    savedAt: text(raw.savedAt, 40) || new Date().toISOString(),
  };
}
