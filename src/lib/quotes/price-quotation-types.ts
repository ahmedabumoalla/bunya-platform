export type PriceQuotationItem = {
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  attributes: { label: string; value: string }[];
  notes: string;
};

export type PriceQuotation = {
  id: string;
  quotation_code: string;
  source_request_id: string | null;
  source_request_code: string | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_tax_number: string;
  delivery_city: string;
  delivery_window: string;
  policy_version: string;
  items: PriceQuotationItem[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  delivery_fee: number;
  total: number;
  valid_until: string | null;
  terms: string;
  created_at: string;
  send_status: "draft" | "sending" | "submitted" | "failed" | "uncertain";
  sent_at: string | null;
  send_error: string | null;
};

export type PriceQuotationDraftItem = {
  product_id: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price: number;
  notes?: string;
  source_item_id?: string;
  measurement_id?: string;
  variant_ids?: string[];
};
export type PriceQuotationDraft = {
  idempotency_key: string;
  source_request_id?: string | null;
  customer_name?: string;
  customer_phone: string;
  customer_address?: string;
  customer_tax_number?: string;
  delivery_city?: string;
  delivery_window?: string;
  items: PriceQuotationDraftItem[];
  vat_rate: number;
  delivery_fee: number;
  valid_until?: string | null;
  terms?: string;
};

export type PriceQuotationCatalogProduct = {
  id: string;
  name: string;
  category: string;
  units: string[];
  variants: { id?: string; sku: string; attributes: { label: string; value: string }[] }[];
  measurements?: { id: string; label: string; unit: string }[];
  image_url: string;
};
