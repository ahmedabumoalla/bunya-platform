import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/quotes/pending-draft.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date });
const normalize = exports.normalizePendingStorefrontQuote;
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = { productId: id(1), quantity: 2, unit: "unit", measurementId: id(3), measurementLabel: "size", selectedVariants: [{ id: id(4), name: "option", attributes: [] }] };
const draft = (patch = {}) => ({ version: 1, idempotencyKey: "rfq-test-idempotency", items: [{ ...item, ...patch }], details: {} });

test("offered option IDs survive normalization; legacy unit-less-ID callers remain valid", () => {
  assert.equal(normalize(draft({ unitId: id(2) })).items[0].unitId, id(2));
  assert.equal(normalize(draft()).items[0].unitId, "");
  assert.equal(normalize(draft({ unitId: id(2), unit: "Translated unit", measurementLabel: "Translated size" })).items[0].measurementLabel, "Translated size");
});

test("valid quantities keep the database numeric(14,3) precision and API limit", () => {
  for (const quantity of [0.001, 1.125, 1000000, "2", " 2.125 ", "1e3"]) {
    assert.equal(normalize(draft({ quantity })).items[0].quantity, Number(quantity));
  }
});

test("malformed, nonfinite, out-of-range or excess-precision quantities are rejected", () => {
  for (const quantity of [0, -1, 1000001, 0.0001, 1.00001, NaN, Infinity, -Infinity, "NaN", "Infinity", "", " ", "0x10", true, null, {}, [2]]) {
    assert.equal(normalize(draft({ quantity })), null, String(quantity));
  }
});

test("invalid supplied option IDs are rejected instead of silently discarded", () => {
  for (const field of ["productId", "unitId", "measurementId"]) {
    assert.equal(normalize(draft({ [field]: "invalid-id" })), null, field);
    assert.equal(normalize(draft({ [field]: 123 })), null, field);
  }
});

test("duplicate, malformed and oversized variant selections are rejected", () => {
  const variant = { id: "abcdef12-abcd-4abc-8abc-abcdef123456", name: "option", attributes: [] };
  assert.equal(normalize(draft({ selectedVariants: [variant, { ...variant, id: variant.id.toUpperCase() }] })), null);
  assert.equal(normalize(draft({ selectedVariants: Array.from({ length: 21 }, (_, index) => ({ ...variant, id: id(index + 10) })) })), null);
  assert.equal(normalize(draft({ selectedVariants: {} })), null);
  assert.equal(normalize(draft({ selectedVariants: [{ ...variant, id: "invalid" }] })), null);
  assert.equal(normalize(draft({ selectedVariants: undefined })).items[0].selectedVariants.length, 0);
});
