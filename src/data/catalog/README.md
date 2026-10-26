# Public platform catalog

One-time import of the public Arabic BRKZ catalog requested by the platform owner on 2026-10-27: 598 products, 12 categories, 52 subcategories, 6,946 SKU variants and 566 unique images. No supplier accounts or transactional database rows are created. The current catalog is display-only; existing supplier products keep their original RFQ behavior.

`imported.json` contains the searchable summary and source retrieval timestamp. `provenance.json` records source IDs and image URLs. Complete SKU specifications are in `public/catalog/products/` with content hashes in filenames. Decoded, optimized local WebP images are in `public/catalog/images/`. Public rendering never calls BRKZ. There are 44 SKUs without published attribute paths; those remain explicitly unknown. Prices, inventory, warranty and delivery are not inferred. Descriptions are newly composed from factual classification/unit fields, not copied marketing prose.

Reproduction (Node 24): `node scripts/import-public-catalog.mjs`, then `node scripts/prepare-public-catalog.mjs`. The collector resumes the same snapshot from `tmp/brkz-import/`; an intentional new source capture requires a new/empty cache. Source JSON is untrusted, rendered as plain React text. Image downloads are allowlisted, decoded and size constrained. No credentials are needed for extraction.

Checks: `node tests/platform-catalog.mjs`, `node tests/platform-product-dialog.mjs`, `node tests/storefront-redesign.mjs`, `node tests/platform-catalog-http.mjs <base-url>`. The import's known counts describe this snapshot, not a future source refresh. A refresh requires reviewing totals, orphan assets and source differences before publication.
