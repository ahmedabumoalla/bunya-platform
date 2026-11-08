import type { PriceQuotationItem } from "./price-quotation-types";

export type InvoiceSeller = { name: string; vat_number: string; commercial_registration: string; address: string };
export type InvoiceBuyer = { name: string; phone: string; address: string; vat_number: string };
export type PriceInvoiceInput = { invoice_type: "standard" | "simplified"; buyer: InvoiceBuyer; supply_date: string };
export type PriceInvoice = PriceInvoiceInput & {
  id: string;
  status: "draft" | "issued";
  invoice_number: string;
  issued_at: string;
  quotation_id: string;
  quotation_code: string;
  seller: InvoiceSeller;
  items: PriceQuotationItem[];
  subtotal: number;
  delivery_fee: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: "SAR";
  qr_payload: string;
};
export type PriceInvoiceSettings = { phase: "unconfigured" | "phase1" | "phase2"; verified_at: string | null; seller: InvoiceSeller };
