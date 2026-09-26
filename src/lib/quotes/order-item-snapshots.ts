type Line = {
  id: string;
  product_id: unknown;
  product_name_snapshot: unknown;
  quantity: unknown;
  unit_name_snapshot?: unknown;
  unit_snapshot?: unknown;
  measurement_snapshot: unknown;
  unit_price: unknown;
  line_total: unknown;
  bunya_customer_quote_item_id?: string | null;
};

export type QuoteLineSnapshot = Line & { quote_request_items: unknown };

function lineSignature(item: Line) {
  const numbers = [item.quantity, item.unit_price, item.line_total];
  if (!item.product_id || numbers.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) return null;
  return JSON.stringify([
    item.product_id,
    item.product_name_snapshot,
    item.unit_name_snapshot ?? item.unit_snapshot ?? "",
    item.measurement_snapshot ?? "",
    ...numbers.map(Number),
  ]);
}

// New orders retain the exact quote-line link. Historical orders use a conservative
// signature match; never assign distinct options by array order to ambiguous lines.
export function matchOrderItemSnapshots(items: Line[], quoteItems: QuoteLineSnapshot[]) {
  const sourcesById = new Map(quoteItems.map((item) => [item.id, item]));
  const sources = new Map<string, QuoteLineSnapshot[]>();
  for (const item of quoteItems) {
    const signature = lineSignature(item);
    if (signature) sources.set(signature, [...(sources.get(signature) ?? []), item]);
  }
  const snapshots = new Map<string, unknown>();
  for (const item of items) {
    if (item.bunya_customer_quote_item_id) {
      const source = sourcesById.get(item.bunya_customer_quote_item_id);
      if (source) snapshots.set(item.id, source.quote_request_items);
      continue;
    }
    const signature = lineSignature(item);
    const candidates = signature ? sources.get(signature) : undefined;
    if (!candidates?.length) continue;
    const snapshot = JSON.stringify(candidates[0].quote_request_items);
    if (candidates.length === 1 || candidates.every((candidate) => JSON.stringify(candidate.quote_request_items) === snapshot)) {
      snapshots.set(item.id, candidates[0].quote_request_items);
    }
  }
  return snapshots;
}
