import type {
  DeliveryAssignment,
  FinancialTransaction,
  ProviderNotification,
  ProviderOrder,
  ProviderProduct,
  ProviderProfile,
  ProviderQuote,
  QuoteRequest,
  SettlementRequest,
  SupportTicket,
} from "./provider-types";
import {
  financialTransactionsMock,
  notificationsMock,
  providerDeliveriesMock,
  providerOrdersMock,
  providerProductsMock,
  providerProfileMock,
  providerQuoteRequestsMock,
  providerQuotesMock,
  settlementsMock,
  supportTicketsMock,
} from "./provider-data";

export const providerStorageKeys = {
  profile: "bunya-provider-profile",
  products: "bunya-provider-products",
  quoteRequests: "bunya-provider-quote-requests",
  quotes: "bunya-provider-quotes",
  orders: "bunya-provider-orders",
  deliveries: "bunya-provider-deliveries",
  transactions: "bunya-provider-financial-transactions",
  settlements: "bunya-provider-settlements",
  notifications: "bunya-provider-notifications",
  supportTickets: "bunya-provider-support-tickets",
  sidebar: "bunya-provider-sidebar-state",
} as const;

export type ProviderCollectionKey = Exclude<keyof typeof providerStorageKeys, "profile" | "sidebar">;

const defaults = {
  products: providerProductsMock,
  quoteRequests: providerQuoteRequestsMock,
  quotes: providerQuotesMock,
  orders: providerOrdersMock,
  deliveries: providerDeliveriesMock,
  transactions: financialTransactionsMock,
  settlements: settlementsMock,
  notifications: notificationsMock,
  supportTickets: supportTicketsMock,
} satisfies Record<ProviderCollectionKey, unknown[]>;

export function readProviderProfile(): ProviderProfile {
  return readValue(providerStorageKeys.profile, providerProfileMock);
}

export function writeProviderProfile(profile: ProviderProfile) {
  writeValue(providerStorageKeys.profile, profile);
}

export function readProviderCollection<Key extends ProviderCollectionKey>(key: Key): ProviderCollectionMap[Key] {
  return readValue(providerStorageKeys[key], defaults[key]) as ProviderCollectionMap[Key];
}

export function writeProviderCollection<Key extends ProviderCollectionKey>(key: Key, value: ProviderCollectionMap[Key]) {
  writeValue(providerStorageKeys[key], value);
  window.dispatchEvent(new CustomEvent("bunya-provider-data", { detail: key }));
}

export function createProviderId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}`;
}

export async function createDeliveryProof(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bunya-delivery:${code}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readValue<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return structuredClone(fallback);
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function writeValue<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

type ProviderCollectionMap = {
  products: ProviderProduct[];
  quoteRequests: QuoteRequest[];
  quotes: ProviderQuote[];
  orders: ProviderOrder[];
  deliveries: DeliveryAssignment[];
  transactions: FinancialTransaction[];
  settlements: SettlementRequest[];
  notifications: ProviderNotification[];
  supportTickets: SupportTicket[];
};
