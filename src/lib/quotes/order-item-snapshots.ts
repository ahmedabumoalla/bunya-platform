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

// Accepted orders copy these fields from quote lines but retain no source-line FK.
// Never assign distinct options by array order when otherwise identical lines are ambiguous.
export function matchOrderItemSnapshots(items: Line[], quoteItems: QuoteLineSnapshot[]) {
  const sources = new Map<string, QuoteLineSnapshot[]>();
  for (const item of quoteItems) {
    const signature = lineSignature(item);
    if (signature) sources.set(signature, [...(sources.get(signature) ?? []), item]);
  }
  const snapshots = new Map<string, unknown>();
  for (const item of items) {
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
