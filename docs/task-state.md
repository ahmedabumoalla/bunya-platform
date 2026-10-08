# Current task — Bunya platform

Updated: 2026-10-08 12:36 Asia/Riyadh. Base: 4ada103; local uncommitted changes.

Latest task: admin/provider brand → `/`; signed-in public header → circular profile entry with primary-role destination. `PublicAccountLink.tsx`, `PublicAccountHeader.module.css`, `HomeStorefrontUi.tsx`, `public-account.ts`, AdminShell/ProviderShell and admin-experience.css changed. Existing contractor home link preserved. Public join links now guest-only. No backend change/deployment.

Fresh checks 2026-10-08 ~12:34–12:35 +03:00 (same runtime below): `node tests/public-account-navigation.mjs` PASS (SSR for five roles, mobile/guest/password states, initials/icon fallbacks, role routes and admin/provider home links); `npx tsc --noEmit` PASS; `npx eslint src/lib/auth/public-account.ts src/components/home/PublicAccountLink.tsx src/components/home/HomeStorefrontUi.tsx src/components/admin/AdminShell.tsx src/components/provider/ProviderShell.tsx` PASS; `git diff --check` PASS. `Invoke-WebRequest http://localhost:3000` returned 200 with guest login link. No browser/build/authenticated live-session check. Source review confirms compact mobile control, 44px target, focus and reduced motion. Inputs are base 4ada103 plus the current scoped working diff/new component and test; no dependencies or configuration changed. Reassess identity/header tests when any of these inputs change. Prior product checks below remain applicable only to their unchanged scope; the newer whole-project typecheck supersedes the earlier run.

Admin product hide/show is implemented in AdminProductReview.tsx and its CSS. Existing is_published, reviews.manage RLS and 091 mutation guard provide the persistence/authorization boundary. Public catalog and customer product queries already filter is_published. No schema change. No production release requested/performed.

Checks run 2026-10-08 approximately 12:25–12:26 Asia/Riyadh, Windows / Node 20.20.2 / installed Next 16.3.4:

- `node tests/admin-product-visibility.mjs`: PASS after fixing a recursion bug in the new test harness. Exercises actual component handlers, persistence response, hide/show, concurrent click prevention, stale revision filters, failure recovery and visibility filters.
- `node tests/provider-product-correction-sql.mjs`: PASS, 28 PGlite SQL scenarios; added admin hide/show, public exclusion, provider/foreign-user denial and preserved product fields. Uses existing schema/policies/091 guard with fixture auth helpers; does not verify live remote permissions.
- `npx tsc --noEmit`: PASS; `npx eslint src/components/admin/AdminProductReview.tsx`: PASS; `git diff --check`: PASS (line-ending notices only).
- Source review: mobile action stacking, wrapping, 44px controls, visible focus, Arabic labels, loading/disabled/error states. Browser/build/live product mutations not run: existing source/unit/SQL boundaries suffice for this scoped control.

Post-check identity snapshot at 12:27 (+03:00), no implementation changes after checks; SHA256:

- AdminProductReview.tsx: 79189D8C8C75F71842B986BA6F1AF4C4451352AB32A7B3925CBBFA6F54AF7E08
- AdminProductReview.module.css: 9BB070BE227D39BB3BF300261E70126EB35F57B9EBFFC42E3CA72EC85CBE6E98
- tests/admin-product-visibility.mjs: 26E9DBDC26F5E05A266E297F3C060310ABB7F80CB2FCF8340AD26762157FA72C
- tests/provider-product-correction-sql.mjs: 749E463D574DAE739C0C08C6631055CDACBEFE54EAD32D5154417CF14932497D
- package-lock.json: 5EF182D42061A1FB3B0469B7BC044BC76419FA231F58E11CDD2993E0C5DCEEB4
- tsconfig.json: 5C51DF4C59F4510D8C7DADF07A5C32132228826A3B331DA5E286207B4DF7EF9C

Before reusing checks, match the above files plus imported dependencies, migration fixtures, runtime/configuration and full relevant working diff. Private runtime configuration and live permissions require independent revalidation. Earlier server startup and historical work remain in PROJECT_REFERENCE.md.
