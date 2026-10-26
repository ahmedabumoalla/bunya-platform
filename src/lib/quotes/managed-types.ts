export type ManagedQuoteItem = {
  id: string;
  product_id: string;
  product_name: string;
  category: string;
  quantity: number;
  unit: string;
  sku: string;
  attributes: { label: string; value: string }[];
  image_url: string;
  notes: string;
};

export type ManagedQuotePricing = {
  item_id: string;
  unit_price: number;
  unit?: string;
  offer_type: "sale" | "rental";
  rental_duration_value: number | null;
  rental_duration_unit: string;
  warranty: string;
  delivery_duration: string;
  notes: string;
  line_total?: number;
};

export type ManagedQuote = {
  id: string;
  request_code: string;
  customer_id: string;
  status: "submitted" | "offered" | "accepted" | "rejected" | "delivered" | "cancelled";
  details: Record<string, unknown>;
  items: ManagedQuoteItem[];
  pricing: ManagedQuotePricing[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  delivery_fee: number;
  total: number;
  valid_until: string | null;
  expected_delivery_at: string | null;
  terms: string;
  assigned_admin_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  delivered_at: string | null;
};
