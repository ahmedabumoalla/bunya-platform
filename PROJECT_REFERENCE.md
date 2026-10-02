# Bunya Platform — Project Reference

## 2026-10-02 — Provider catalog without upfront pricing

- Web provider create/change forms and native editor no longer collect product unit price or VAT inclusion. Provider/admin catalog details show pricing at the RFQ stage; public product details no longer claim a tax basis before a quote. Retained offer type, quantities, rental periods, availability and delivery configuration. Removed obsolete catalog VAT properties/queries from public web/native product models. RFQ bidding, accepted quotes and invoice calculations are unchanged.
- APIs accept price-free draft/review submissions and change requests, ignore obsolete pricing fields, and create a NULL catalog price rather than zero. Forward090 applied after linked dry-run (only090) and transaction/rollback rehearsal: invoker product trigger normalizes new provider-product prices and preserves historical price/VAT values on updates; submit/review RPCs omit catalog pricing, including older pending approvals. Existing before-snapshots and financial records remain intact; no history backfill or real product/notification was created.
- Fresh checks:18 mocked API groups (~0.5s),21 actual090/073 PGlite regressions, existing additive RFQ/quote/invoice regressions (~1.2s), TypeScript (~6.2s), affected ESLint, SQL static validation and immutable90-migration hash guard passed. Native2 repository contract and4 widget/layout tests, affected Dart analysis and format passed; no mobile artifact build. Web source review preserved other form fields and two-column/stacked layouts. No browser. Live read-only verification (~4.3s) confirmed090, nullable price, enabled invoker trigger, unchanged product policies/RLS and denied anonymous RPC execution (`tmp/provider-catalog-live-verification.sql`). Release evidence follows.

## 2026-10-02 — Refined provider web workspace

- Redesigned the actual merchant portal rendered by RoleDatabasePortal (merchant layout intentionally ignores route children): all eleven sidebar destinations, profile, products/create/change/details, pricing requests/responses, orders/fulfillment, drivers/create, finance, notifications, policies and support now share forest navigation, quiet opaque surfaces and clearer typography. New provider-scoped styles override legacy glass rules without changing other role shells. Shared policy presentation also improves contractor policy reading.
- Profile now has saved-data summary, section navigation and identity/contact/legal/address/document groups. AST comparison preserved all25 named fields, types and required flags; save/upload API contracts remain unchanged. Fixed asynchronous upload-form reset and clear success/error feedback. Product dialog uses existing focus/scroll utilities; mobile sidebar adds Escape, focus containment/return, background inertness, scroll lock and44px controls. No backend/schema, credentials or message changes.
- Fresh final checks: whole-project TypeScript (~4.7s), nine affected TSX ESLint (~4.2s), foreground-color guard (~0.35s), diff review and CSS/module references passed. Non-browser SSR check (~0.3s) verified all11 active sidebar routes plus a nested product route, no client queries during render, seven stylesheet parses, new global-style isolation and five text pairs >=4.5:1 (`tmp/provider-ui-check.cjs`). Initial palette/contrast checks found a borderline green and muted text; corrected before final passes. Source responsive/a11y review covered collapsed/mobile navigation, RTL, field groups, table overflow, feedback, focus and reduced motion. No browser or native build; deployment evidence follows.
- Release b7c0c1b built/deployed successfully: https://vercel.com/ahmedabumoallas-projects/bunya-platform/8WMvdWwCYmV7aD6kxvbVgaYviLeV. Fresh production HTTP smoke (~3s) confirmed all11 merchant destinations still redirect anonymous visitors307 to login and login200 (`tmp/provider-workspace-production-check.mjs`). No authenticated visual/browser inspection or data mutation. This evidence addition is documentation only; matching implementation checks remain valid.

## 2026-10-02 — Eight-digit, 24-hour provider/contractor temporary passwords

- Approval and resend now use a dedicated cryptographic eight-digit numeric generator. The existing mixed18-character driver generator remains unchanged. WhatsApp/email credential text explicitly states24-hour validity; no credential is logged or returned from reviewer API. Resend updates Auth, renews the mandatory-change metadata and only then sends credentials; failed renewal does not send a misleading credential.
- Applied forward089 after dry-run and linked transaction/rollback rehearsal. A scoped profile trigger enforces issue+24h for provider/contractor finalization and reissue; existing pending deadlines are capped without changing their passwords or extending validity. Direct client temporary-credential metadata changes are denied. A service-only/RLS-protected one-way fingerprint of the Auth password hash lets completion require an actual password change; no plaintext or bcrypt hash is duplicated. Driver behavior remains unchanged.
- Enabled the previously unset Supabase custom access-token hook through Management API (`scripts/configure-onboarding-auth.mjs`). It rejects expired provider/contractor temporary credentials across login/refresh and caps issued JWT expiry at the credential deadline; other accounts pass through. Auth-only execution and minimal profile-column grants are enforced. Existing Auth numeric-password compatibility was verified without changing global strength settings. Official contract reviewed: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook.
- Fresh checks:16 actual PostgreSQL/PGlite cases (~1.1s) cover both real approval finalizers, deadline normalization/backfill, resend snapshots, completion/metadata bypass denial, driver compatibility, hook role grants and expiry; generator/message/resend tests (~0.8s) cover500 generated samples, both recipients/channels and failure ordering. TypeScript, focused ESLint, SQL static validation and hash guard89 passed. First live role-switch rehearsal was refused by hosted SQL role-membership restrictions; rerun under normal migration credentials passed, and actual Auth-service execution was independently verified below. No browser or mobile build.
- Live isolated Auth fixture (~14s): numeric login succeeded for provider and contractor; unchanged-password completion/client metadata mutation were refused; actual permanent-password change/completion and normal refresh succeeded; shortened synthetic deadline denied subsequent login and refresh. Synthetic Auth account/profile/fingerprint were removed; no application or WhatsApp message was created (`tmp/onboarding-auth-live-check.mjs`). Live security advisors returned66 existing warnings, none referencing new fingerprint/metadata/hook objects (`tmp/onboarding-password-advisors.json`). Deployment evidence follows after release.
- Release02886ad built/deployed successfully: https://vercel.com/ahmedabumoallas-projects/bunya-platform/Dkxa3sZDQcYqcFLmub4jDkXsiLSa. Final linked verification (~3s) confirmed089, fingerprint RLS/client denial, Auth-only hook execution, zero pending windows over24h and zero synthetic Auth accounts. Production HTTP check confirmed login200 and anonymous provider/contractor resend401 without messaging (`tmp/onboarding-production-check.mjs`). This evidence addition is documentation only; implementation checks remain applicable.

## 2026-10-01 — Company and individual contractor onboarding

- Web new/revision and Flutter join forms now distinguish company/individual, collect Arabic/English names with spaces, optional username falling back to the full English name, optional company contact, Enter-added service cities and existing specialty chips. Company requires four typed legal documents and allows an optional company profile; individual requires national ID plus1–20 previous-work images/MP4/MOV/WebM files. Admin requests and permission-filtered user dossiers display the submitted details and immutable policy consent snapshot.
- Reused private signed TUS6MiB uploads, compression/fallback and streaming from provider onboarding; contractor submission/revision carries only bounded128KiB metadata and a bound upload capability. Image/PDF optimization remains opportunistic; video bytes remain original. No application file-size cap; the previously verified global Storage500GiB ceiling still applies. Added video MIME types through Storage API, preserving private bucket and null bucket cap. No file bytes enter Postgres.
- Applied forward migrations087 and088 to linked production after individual dry-runs and transaction/rollback rehearsals. Submission/revision and upload commitment are atomic; required documents and policy are enforced at submission and approval. Direct client application/onboarding-document mutations are blocked; existing read RLS and separate profile-document uploads remain. Application document history is retained, with current-only UI and private authorized300s download redirects for reviewer, revision, dossier and contractor owner. Owner download independently verifies application ownership.
- Approval retains/creates active customer and contractor roles; active approved existing contractors were backfilled without activating suspended accounts or deleting role history. Web portal guard and navigation now permit the ready contractor's customer workspace. Flutter already exposes its customer catalog/basket. Existing phone verification and mandatory-password-change gates remain.
- Contractor notifications use the provider's authorized-reviewer flow, prioritizing the designated admin, deduplicating known submissions and isolating failures. Live read-only verification confirmed one active authorized designated reviewer and WhatsApp enabled/configured/HTTP200/authorized. No test message, real application or credentials delivery was sent.
- Added editable `contractor-join` policy draft under admin policies. It remains unpublished; submission stays disabled until the owner publishes the policy. This is a material activation dependency, not a completed real-user submission test.
- Fresh checks: actual087+088 PGlite49 regression checks (~1.2s), contractor server16 groups (~0.6s), shared upload19 groups (~0.6s), web field8 groups (~0.5s), client7 upload scenarios (~0.5s), provider submission24 regression groups (~0.6s), authorization/username, reviewer-notification and private download tests passed. Whole-project TypeScript (~3.2s), affected ESLint, diff review, SQL static validation and migration checksum guard88 passed. Flutter13 focused tests (~5.8s), affected analysis/format passed; no mobile binary/browser/device-codec test. Source UI review covered mobile/desktop layout, labels/errors, keyboard cities, disabled/loading states and policy-dialog focus handling.
- Live Storage transfer checks accepted all three video MIME types via signed TUS, verified private access and bounded206 reads, then removed every synthetic object (`tmp/contractor-video-storage-check.mjs`). Live schema check confirmed087, new fields, RLS, service-only commit permission, unpublished policy and zero active approved contractors missing customer role (`tmp/contractor-live-verification.sql`). Deployment and final088 production evidence follow after release.
- Final088 live read-only verification (~4.3s) confirmed both enabled mutation guards, invoker security, denied client execute, approval completeness enforcement and zero remaining synthetic Storage objects (`tmp/contractor-088-live-verification.sql`). Release `e93e384` built/deployed successfully: https://vercel.com/ahmedabumoallas-projects/bunya-platform/Hjn5YeY2Am2uBjrQn324mTn1yikE. Fresh production HTTP checks (~8.1s) confirmed contractor form200/new fields/no10MiB copy, policy endpoint200 withholding draft, invalid init400, foreign origin403, oversized metadata413, anonymous owner/reviewer downloads401 without signed redirects, invalid revision410 (`tmp/contractor-production-check.mjs`). No submitted application or real notification. This last evidence addition is documentation only; earlier matching source/test evidence remains valid.

## 2026-10-01 — Large provider attachments, direct resumable Storage and compression

- Removed provider attachment10MiB checks from web/new/revision/native and database submission. File bytes now upload directly to private Supabase Storage using signed TUS6MiB chunks, bounded retries and progress; application requests carry only metadata/capabilities, bypassing Vercel's request-body limit. Files remain outside Postgres. Contractor attachment rules are unchanged.
- Web compression runs sequentially in a worker: WebP images2400px/quality72–80, lossless PDF object-stream repacking. Keep original unless smaller; signed/encrypted/XFA PDFs remain untouched. A32MiB/20s optimization budget skips expensive processing without rejecting uploads. Native streams file-backed documents, optionally compresses images conservatively; native PDFs are preserved. No claim of identical savings for every file, guaranteed minimum size or device-tested native codec.
- Applied forward migration086; upload batches are service-only/RLS-denied to public clients, identity/idempotency/revision-bound, expire after24h and commit atomically with application/files. Metadata bodies capped while streaming, server verifies actual Storage size/MIME and a bounded12-byte signature. Storage signing forbids overwrite. Cleanup cron `/api/cron/provider-uploads` removes abandoned objects via Storage API after a27h safety window, preserves referenced files and drops committed batch metadata after7days. No bytes/chunks/base64 stored in database.
- Removed bucket-specific size limit via Storage API; bucket remains private with PDF/JPEG/PNG/WebP types. Raised project global Storage limit from52,428,800 to536,870,912,000bytes (500GiB) using Management API, verified GET and successful1GiB TUS reservation (terminated without payload). This is a finite hosting limit, not unlimited capacity or free storage. Operational script: `scripts/configure-provider-upload-storage.mjs`; credentials stay server-side.
- Fresh verification: SQL/PGlite25 checks incl3GiB metadata, atomic retry/binding/expiry/client denial; submission validation24 groups; upload lifecycle/security12 groups; client TUS mocked large-file/retry/metadata tests; PDF/image optimization12 groups. Focused TypeScript/ESLint passed. Native targeted analyze and8 tests passed (13MiB range streams, HEAD recovery, cross-origin refusal, widgets). Existing dependency audit reports Next16.3.4 advisory (fix16.3.8), no introduced compression/TUS advisory; framework upgrade outside this task.
- Live Storage test uploaded13MiB using3chunks, verified size/MIME/private access and HTTP206 twelve-byte read, then removed synthetic object. Separate test proved signed-token overwrite blocked409 and original unchanged, then cleaned it. Live DB check confirmed RLS, public/client privilege denial, service commit grant and scoped provider file-size exception. Initial plain TUS endpoint failed; official signed-upload example requires `/upload/resumable/sign`, now used. No real application, notification, browser or mobile artifact created. Evidence: `tmp/provider-upload-live-check.mjs`, `tmp/provider-tus-immutability.mjs`, `tmp/provider-tus-probe.mjs`. Deployment recorded below after release.
- Supabase security advisors returned66 warnings on unchanged definer functions/auth password protection; none reference upload batches or changed submission/commit functions (`tmp/provider-upload-security-advisors.json`). This was a scoped upload security check, not a claim of a clean whole-project audit.
- Web release4d906b2 built/deployed successfully: https://vercel.com/ahmedabumoallas-projects/bunya-platform/Ghq2jy182FbjpeahRfxLAhJywZQU. Production HTTP check (~5s) confirmed form200/new large-file copy/no10MiB label, invalid upload-init400, foreign-origin403 and unauthenticated cleanup401 (`tmp/provider-upload-production-check.mjs`). Live read-only query found zero synthetic test objects after cleanup. Follow-up direct document downloads are recorded after their deployment.
- Download follow-up: provider reviewer/revision/user-dossier document routes now redirect to private five-minute signed Storage URLs only after existing authorization, exact application/path and scan-status checks. Avoids buffering large files through the application server. Non-provider paths retained. Focused four-group download tests passed (~0.45s), TypeScript (~4s), scoped ESLint (~2s) and diff review passed; includes denied/expired/wrong-owner/path-escape/quarantine cases.
- Final0329901 build/deployment succeeded: https://vercel.com/ahmedabumoallas-projects/bunya-platform/8Tn2smm5K6zZxk52DQJmVzjwm5wB. Fresh non-browser production checks (~3s) returned401 for anonymous reviewer/dossier download and410 for invalid revision token, issuing no signed Location. Earlier source/test evidence remains valid for unchanged upload inputs. This final release note is documentation only.

## 2026-09-30 — Optional provider username with English-company fallback

- Provider web/native new forms and web revision now label username optional. Explicit names are preserved after whitespace normalization; omitted/blank names use the complete English company name, including spaces (2–160 characters). Approval no longer silently substitutes a suffixed name on conflict. Profile editing accepts the same full length.
- Applied forward migration085 to linked production after dry-run showed only085. A database trigger supplies the fallback atomically and records whether the name was explicitly chosen; revision keeps automatic names tied to the submitted English name. Provider profile constraints accept full spaced names while other account length rules remain unchanged. Existing requests keep their explicitly supplied names. No policy publication or messaging action.
- Fresh checks on 2026-09-30: TypeScript and focused ESLint passed (~6s); actual084+085 PGlite20 regression checks passed (~1s), including explicit/blank names, revision and approval of spaced, two-character and long names. Submission mocks24 groups passed (~0.6s). Targeted Dart format/analyze and4 widget tests passed (~9s), with blank username included in the submission test. SQL static validation85 and checksum guard85 passed; source/diff review covers optional labels, fallback and unchanged authorization boundaries. No browser or mobile build.
- Released c134df5 to origin/main; exact-commit Vercel build/deployment succeeded: https://vercel.com/ahmedabumoallas-projects/bunya-platform/GLHhyohSftssw65fKChKvWay6aVk. Non-browser production GET (~2s) verified HTTP200, optional username label and English-company fallback hint (`tmp/verify-optional-provider-username.mjs`); no real submission or message sent. Live schema check (~4s) confirmed fallback trigger/source flag, RLS enabled and unchanged server-only submission permission. This final evidence update is documentation only.

## 2026-09-30 — Provider application details, documents and policy consent

- Provider new/revision forms now capture Arabic/English company names with normalized spaces, optional contact, Enter-added service cities independent of delivery regions, four separately typed required documents, and explicit acceptance of the currently published `provider-join` policy. Removed provider application discount input/storage (customer order discounts remain). Admin request detail and permission-filtered user dossiers display the same fields and current typed private documents.
- Applied forward migration084 to linked production; dry-run identified only084 and a rollback rehearsal passed. Submission/revision uses a service-only transactional RPC; missing documents/consent or stale policy rolls back all DB changes, failed uploads are cleaned via Storage API. Replacements preserve previous document versions privately. DB stamps immutable policy text/title/version/time; approval propagates English name/cities and uses company name if contact is absent. Existing RLS/Storage grants retained, bucket stays private.
- Added policy-manager destination “سياسة انضمام مزود الخدمات أو المورد” and saved an unpublished editable draft. No policy was published on the owner's behalf; provider submission deliberately remains unavailable until the owner reviews/publishes it. Frontend reloads policy and resets consent on409. Draft body is operational text, not a newly imposed fee or commission.
- Verified designated mobile belongs to an active super-admin. Provider notifications prioritize that authorized WhatsApp recipient, deduplicate destinations and already-submitted keys, isolate failures and record sanitized outcomes; revised applications have distinct notification keys. Live WhatsApp readiness returned authorized/enabled (HTTP200); no test message or real application was sent. Concurrent cross-instance exactly-once sending is not claimed.
- Updated Flutter source to the same contract (file_selector added for native PDF/image selection), including policy modal, typed files, cities and409 reset. No mobile binary/store upload.
- Fresh verification: TypeScript and focused ESLint passed; actual084 PGlite regression15/15 (~1s), validation/submission mocks21 groups (~0.5s), reviewer messaging mocks passed, Flutter targeted analyze and4 widget tests passed. CSS/source responsive/accessibility review passed. SQL static validation84 and migration hash guard84 passed. The staged084 checksum initially differed because Git normalized CRLF to LF; the follow-up pins084 to LF and corrects its manifest (SQL content unchanged). Live post-migration checks confirmed columns/nullability, no discount column, preserved RLS/private bucket, anonymous/authenticated RPC denial and service-role grant; evidence `tmp/provider-join-live-verification.json`. No browser or broad suite. Web release status recorded below after deployment.
- Web release: implementation `cc87657` and checksum follow-up `14dc238` pushed to origin/main. Exact14dc238 GitHub/Vercel status reached success / Deployment has completed: https://vercel.com/ahmedabumoallas-projects/bunya-platform/E1kuZTZiKFmFXYZkotcJN375JfFM. Fresh non-browser production HTTP checks (~4s) confirmed `/providers/join`200 with bilingual names/four document labels/no provider discount, policy endpoint200 withholding the draft, and a missing-consent POST400 before any application/files/messages were created. This documentation-only note does not change deployed source. Policy remains unpublished awaiting owner content review.

## 2026-09-30 — Authorized removal of seven selected platform accounts

- Removed the seven unique accounts explicitly named by the owner, their 325 related public rows across 73 tables, associated Auth records/sessions, and one owned product image through the Storage API. The duplicate email in the request was counted once. This affects platform accounts only.
- Inspected live foreign keys and UUID/email references, including nested audit/outbox data. A rollback-only rehearsal initially exposed an application-source check constraint; child-first deletion resolved it. The successful rehearsal (~7s) was rolled back and all seven accounts were confirmed present before the real operation.
- Production transaction (~9s) checked the reviewed scope fingerprint, kept FK constraints active, temporarily suspended application triggers under table locks and restored their original states. Before/after fingerprints confirmed every public row outside the approved scope was unchanged; the five other Auth accounts were preserved. No RLS, permissions, schema or application source changes.
- Fresh post-commit verification (~5s) scanned all 194 tables in public/auth/storage against the captured account/entity identifiers: zero residual matches, five Auth accounts/five profiles remaining, and the three unrelated Storage files retained. Target sessions and refresh tokens were absent. No browser, deployment, build or application suite was needed for this operational deletion.
- Local evidence: `tmp/account-purge-plan.json`, `tmp/account-purge-dry-run-result.json`, `tmp/account-purge-execute-result.json`, `tmp/account-purge-verify-result.json`; executed with `npx supabase db query --linked --file ... --output json`. Records contain identifiers/counts only, not credentials or account payloads. No deletion claim is made about provider-managed backups or external email/messaging history.

## 2026-09-28 — User account dossier and super-admin maintenance access

- User names now open an accessible responsive account card: account/business/professional/driver/admin details, role history and login state, permission-filtered private documents, 14 paginated operational/address datasets and persisted audit activity. Private downloads validate both account relationships and object path namespaces; no auth secrets or audit snapshots are returned. Activity is recorded operations, not historical click tracking.
- Added super-admin-only maintenance entry inside the card with an 8–500-character reason and 15-minute window. Active confirmed non-admin accounts only; mandatory-password-reset accounts and nested maintenance are denied. Original admin session stays intact. Target access token is encrypted in a Secure (production), HttpOnly, SameSite=Strict cookie; refresh tokens are not persisted. Browser Data/Storage/user calls proxy through the server, and server requests use the target JWT/RLS. Every request rechecks original authentication/session and live role/target authorization. Account credentials and admin endpoints are unavailable in maintenance; normal platform mutations execute as the user. A persistent banner and logout return to admin; expiry fails closed until explicit exit. Native device registration is suppressed during maintenance.
- Applied forward migration083 to linked production after dry-run showed only083: RLS-protected service-only session metadata, immutable authorization and lifecycle events, target action attribution with original super-admin provenance, and supplemental audit triggers for previously unaudited INSERT/UPDATE/DELETE events. No real user's account was impersonated and no business action/email was executed during verification. Existing application RLS/Storage access rules are retained.
- Fresh verification on27–28September: TypeScript and focused ESLint passed; detail CSS parsed2/2; source responsive/focus/scroll review completed. Production detail query shapes29/29 (limit0), post083 metadata/unknown-grant/anonymous-denial checks5/5, local unauthorized/tampered/CSRF API checks passed. Isolated actual083 PostgreSQL regression40/40 (~1s), focused encrypted-cookie/identity-transport/CSRF/proxy tests passed (~0.4s), SQL static validation83 and migration hash guard83 passed. PGlite0.3.16 added as dev-only dependency for reproducible isolated tests. Shell Node20 required explicit ws transport for read-only checks; new server token clients also support that transport; project production engine remainsNode>=22. No browser, full build, native build or store upload.
- Pushed source commit e314e9c to origin/main. First exact-commit GitHub status returned Vercel success / Deployment has completed: https://vercel.com/ahmedabumoallas-projects/bunya-platform/DHZQ448XZKcdd9dDkZo2kUXGFuNt. This documentation-only follow-up records that result; no post-start application tests, browser checks or further deployment polling. Staged credential-pattern scan had no hits; staged083 checksum matched its manifest.

## 2026-09-27 — Complete source delivery to GitHub and Vercel

- User authorized delivery of all updates. Staged platform fixes, accumulated Flutter source/configuration/fonts/tests, signing/build helpers, existing historical APK downloads and project/store handoffs. Added DELIVERY_HANDOFF.md and current-state pointers to six historical reports. No new mobile binary or store upload; old APKs/AAB do not represent current source.
- Fresh pre-push checks: npx tsc --noEmit passed; flutter analyze passed with no issues (13.4s). Reused matching focused scroll-lock, TSX/CSS and branding checks above. Staged credential-pattern scan found no hits; no forbidden credential/cache files or >95MB files in staged additions. Removed tracked generated test results and Supabase CLI metadata from Git only; local files retained and ignored. No application build or broad test suite.
- Pushed source commit 8cde1a60c85267d60570fae5571d764ae128ffcc to origin/main. First exact-commit GitHub status observation returned Vercel success / Deployment has completed at https://vercel.com/ahmedabumoallas-projects/bunya-platform/YVxt1LK1cePAFADCY9Qkp9A7yRVq. Direct Vercel API session returned HTTP 403; authenticated GitHub status supplied live deployment evidence. No post-start application tests, browser checks or additional deployment polling. This documentation-only follow-up records the verified release; no source changes after verification. Local .codex and frontend-ui-standards-skill tool bundles remain outside the application delivery. Latest live store evidence remains 26 September; no store-account check/upload today.

## 2026-09-27 — Restore admin page scrolling after nested dialogs

- Diagnosed independent body overflow save/restore in AdminJoinRequests and nested AdminDecisionDialog: effect cleanup/re-entry or out-of-order closing could restore hidden after all overlays closed. Replaced the four admin overlay locks (join requests, decisions, product reviews, sidebar drawer) with shared token-based lockBodyScroll, restoring original inline overflow/priority only when the final lock releases. Refresh the already affected page once to clear its old inline lock.
- Focused Node/TypeScript regression check passed for both nested close orders, effect re-entry, duplicate cleanup and original overflow/priority restoration; changed TSX syntax passed. No browser test, build, deployment or broad test suite.

## 2026-09-27 — Provider/product/settlement action readability

- Source-reviewed provider join requests and shared confirmation dialogs, product creation/change requests and admin product reviews, provider payout submission/listing and contractor settlement actions. Shared admin tokens now reach portaled dialogs. Neutral, revision and rejection actions have explicit readable colors; disabled controls retain dark text on a muted solid background instead of fading via opacity.
- Fixed light-red remove-image text, preserved readable disabled product-review/provider-payout buttons and keyboard focus, and differentiated positive vs destructive contractor settlement actions. Confirmation dialogs explain the existing minimum text length needed to enable confirmation. No permissions, amounts, status transitions, RPCs or disabled predicates changed; no financial actions performed.
- Verification: targeted PostCSS parsing of the seven edited stylesheets and TypeScript syntax transpilation of AdminUI/AdminSettlements passed. Final opacity specificity adjustment source-reviewed. Responsive/source review only; no browser interaction, build, full tests or deployment. Provider settlement admin listing continues to use AdminRecords; no new payout action was introduced.

## 2026-09-27 — Local server readiness

- Reused the running platform dev server on http://localhost:3001 (listener PID 33628). Fresh HTTP GET returned 200 and Bunya page content. No restart, browser check, tests or production build needed.

## 2026-09-27 — Join request detail dialog redesign

- Reworked AdminJoinRequests detail dialog for contractor/provider applications with a 960px desktop layout, fixed header/footer grid rows and a single scrollable body. Removed negative sticky margins and excessive nested borders; added explicit portal-safe colors, readable approval/revision/rejection actions, separate contractor regions/specialties, document type markers with wrapped filenames, and a useful pending-review message.
- Dedicated component CSS covers narrow screens, safe-area footer padding, 44px controls, keyboard focus and long names. Existing focus trap, document retrieval, authorization and decision callbacks retained. No dependencies, API/database changes or deployment.
- Verification on 27 September: targeted ESLint for src/components/admin/AdminJoinRequests.tsx completed without findings; PostCSS parsing of join-request-dialog.css passed. Source-based responsive/accessibility review completed. No browser tests, full suite or build run.

## 2026-09-26 — Join request approval button contrast

- Fixed the approval button in portaled join-request dialogs: admin color variables are scoped to .admin-app and unavailable outside it, invalidating the gradient while leaving white text. Added explicit dark-green background/white text with a readable disabled state in admin-polish.css. No action or authorization changes. Targeted source review only; no tests, builds or browser checks for this CSS fix.

## 2026-09-26 — Clear, transparent Flutter branding

- Replaced boxed app-icon artwork in the app wordmark, role workspace header and sign-in with shared BunyaBrandLogo using the existing transparent bunya-mark.png. Removed white backgrounds and internal padding; enlarged visible artwork to 152×44, 112×40 and 220×72 logical-pixel containers respectively. Rendering trims only empty source canvas using measured alpha bounds with a safety margin; original asset and full tagline preserved.
- Verification: dart format lib/src/brand_logo.dart unchanged; flutter analyze lib/src/brand_logo.dart lib/src/app.dart lib/src/workspace.dart passed with no issues on 26 September. Source review only, no browser visual test or release build. Restarted the Flutter web preview on 8090 to load the change; log tmp/app-logo-preview-20260926.log.

## 2026-09-26 — Launch Flutter app web preview

- User clarified that the requested web version means the Flutter APP at http://127.0.0.1:8090, not the Next.js platform. Confirmed port 8090 is listening and opened it in a browser tab retained for the user. The earlier interpretation was incorrect: started Next.js dev on http://localhost:3001; startup log confirms Ready in 2.7s. Logs: tmp/web-preview-20260926-123122.log and matching .err.log. Process 31344. Opened the web URL in Chrome. No code changes, production build, tests, deployment or store upload.
- Flutter preview was also started earlier at http://127.0.0.1:8090 using tool/run.ps1 -Target web; its log confirms lib/main.dart is served. No Android device connected. Logs: tmp/app-preview-20260926-122728.log and matching .err.log.

## 2026-09-26 — Live Apple and Google publishing status

- Apple membership is now active for DAFAF ALEBDA TRADING COMPANY, TeamASCYRZ5R5G; renewal25September2027. User completed expired login. User then accepted App Store Connect Terms of Service. Fresh live inspection of the organization Apps page showed No Apps / You haven’t added any apps yet; no Apple app record or uploaded build exists in this account. Next release work is create app identifier/listing, configure iOS signing and build/upload a current IPA; no app was created or uploaded during this status-only task.
- Google Play account 6804780615083834898: final live check on 26 September confirmed identity approval and "Phone number verified" for BOTH the contact and public developer phones. Account setup is complete; the user has opened the accessible Create App form at https://play.google.com/console/u/2/developers/6804780615083834898/create-new-app. Its name/package fields are empty and declarations unchecked; creation is pending, not blocked by identity anymore. No app was created or uploaded by the agent. Apple status above is reused from the earlier direct check today; the App Store Connect tab has since closed. Next: create store listings, prepare current signed releases, and upload them. Details in STORE_ENROLLMENT_STATUS.md.
- Local artifactmetadata only: September7 AAB exists(version1.0.2+3,56,747,865bytes), predates pendingSeptember24nativechanges; no known IPA directory. No builds/tests/uploads/account changes/messages.

## 2026-09-26 — Add provider-specific profit above accepted supplier prices

- Applied forward migration082_additive_provider_markup_pricing.sql to the linked production database; dry-run showed only082. New quotes use round(supplier unit price × (1 + provider platform_commission_rate /100),2), preserving each bid's VAT basis and delivery fees. Inclusive10 at10% becomes11; supplier receives10. Gross uplift1 contains incremental VAT0.13 under the existing15% model; financial profit records net0.87. Existing issued quotes and paid financial history stay unchanged. Zero-VAT pricing is not supported by the existing provider bid schema and was not introduced.
- Private RLS-protected, finance-only immutable per-line snapshots freeze supplier costs/rates/customer amounts. New supplier ledger credits full supplier cost without a commission debit. Finance summary aggregates net margin from paid additive fulfillments plus historical commission entries. Existing legacy offers retain the legacy ledger path. Existing refund processing does not reverse supplier financial history; unchanged by this task.
- Stable quote-line FK on new order items prevents duplicate invoice associations when products/quantities repeat. VAT-basis flags staynull on historical rows. Customer quote/order views label inclusive/exclusive unit prices and resolve exact variant snapshots from linked quote lines. Admin finance wording now explains the added percentage and issued-price stability; no client-side price authority or secret exposure. Payment intention still uses owner-scoped persisted order/invoice/payment totals. No native source changes.
- Fresh verification: TypeScript4.0s, targeted ESLint2.4s,3 focused order snapshot cases0.4s and82-migration hash guard passed. Reused matching final agent SQL validation82 and isolated PGlite financial regressions~1s (actual082, end-to-end pricing/accept/invoice/payment/fulfillment/ledger functions; mixed rates/VAT, fractional0%, immutability, idempotency, permissions and translation refresh). Only082 line endings normalizedLF after tests; no SQL semantic edits. Source responsive review confirms existing wrapping for longer tax labels. Post-migration production read-only limit0 query-shape checks3/3 passed; anonymous private snapshot access denied. No browser, full build, real business test payments or notification sends. Committed/pushed7111faa to origin/main. First exact-commit Vercel observation already reported production READY (~24s build): https://bunya-platform-qzgl80xg3-ahmedabumoallas-projects.vercel.app. Stopped immediately with no post-start tests, browser or extra deployment polling; custom-domain activation not independently rechecked. Canonical staged082 checksum and staged whitespace checks passed.

## 2026-09-26 — Supplier-authoritative RFQ product selections

- Diagnosed customer RFQ as loading only product id/name/base_unit and posting free-form unit/measurement with empty option IDs. Replaced these inputs with actual supplier product_units/product_measurements/active product_variants; single values are read-only and multiple values are required offered choices. Product changes reset dependent options, quantities start at the supplier minimum, and technical specifications/manufacturer are shown as recorded. Actual screenshot product was checked anonymously: حبة, fixed سابك, exactly three offered measurements. No brands/options inferred from free text. Provider create/change-request option types now include brand/manufacturer for genuinely available alternatives. Storefront quantity controls also honor the product minimum.
- Applied forward migration081_canonical_rfq_catalog_selections.sql to the linked production database using Supabase CLI; dry-run confirmed only081 pending. Protected submit_customer_rfq and direct permitted draft writes; canonical product/unit/measurement/active variant IDs, matching units, grouped choices and numeric/minimum constraints are enforced in the database. Valid legacy/localized callers and idempotent retries retained; API forwards optional unitId and returns useful Arabic errors. Internal helpers revoked; existing owner RLS/authorization retained. RFQ FKs remain RESTRICT, confirmed by local PostgreSQL cases. No native source/build changes.
- New product_specifications_snapshot stores actual fixed supplier specifications at request time. Provider RFQ views/notification templates and customer request/quote/order details show canonical specs and selected options separately from notes. Historical requests were not backfilled with current specs. Order records lack source-line FK: metadata is displayed only for an unambiguous existing quote-line match or identical candidate metadata; otherwise link to original quote, no guessed brand assignment. No live requests or notification sends executed during this task.
- Fresh verification: TypeScript and targeted ESLint passed; changed CSS parsed; actual public product/choice/mismatch/active-brand assertions passed; production limit-0 checks passed4/4 for new snapshot relationships after migration. Reused agents' valid focused results:5 draft normalization cases and ephemeral PGlite PostgreSQL regression suite (50 cases plus additional FK protection cases), SQL static validation81, order-line ambiguity checks. Migration hash guard81 passed; no browser/full local build. Committed/pushed `1a57f23` to origin/main. First exact-commit Vercel observation reported production BUILDING at `https://bunya-platform-4852l5tw4-ahmedabumoallas-projects.vercel.app`; stopped immediately per user instruction, no post-start tests/polling. Staged whitespace/checksum checks passed after normalizing only081 line endings to LF and recording its canonical Git hash; SQL semantics unchanged.

## 2026-09-26 — Complete customer workspace and responsive product imagery

- Redesigned all 14 customer navigation destinations (including direct delivery tracking) and their RFQ, quote, project/proposal and order details. Opaque forest/white workspace, grouped SVG navigation, safe persisted collapse, mobile drawer focus/escape/inert handling, skip link and account navigation. Removed duplicate generic customer database fetches. Keyed detail routes prevent stale records/actions when navigating between IDs.
- Customer RFQ now has four numbered sections, product photos, grouped delivery/contact fields and review summary; all 20 fields and existing submission/quote/payment/acknowledgment flows retained. Real product imagery also appears in list previews, RFQ detail, quote detail and new named order detail. Images load in batches through the existing session/RLS and Storage signing flow, use contain sizing and responsive desktop/mobile bounds with an honest missing-image state. Added contain option without changing other callers' default crop behavior.
- Dashboard/list pages have real summaries, searchable paginated records, readable statuses/dates/currency and actionable empty states. Address/profile forms retain existing RPCs. Dedicated project/proposal UI adds readable context and inline decisions; policy reader shows published customer policies only. Notifications have owner-scoped filters/read actions and safe links. Dedicated support preserves ticket/reply/reopen APIs, excludes internal messages/attachments from customer queries, signs attachments on demand and supports failed-upload retries without duplicating messages. Payment layout refreshed; payment server authorization unchanged.
- Shared presentation helpers preserve valid data, flag corrupted question-mark text without inventing replacements, and restrict displayed map destinations. No schema, RLS, Storage-policy or native app changes. Existing support attachment/Storage read policies check ticket access without additionally excluding internal-message attachments; UI avoids requesting these, but backend policy remediation remains outside this UI change.
- Fresh verification: TypeScript passed after final TS changes; focused ESLint passed across changed files (initial shell ref warning corrected). All 9 customer CSS sheets parsed, then only 6 changed responsive sheets rechecked; sidebar route-file coverage 14/14. Read-only production PostgREST query-shape checks passed 11/11 using limit 0, retrieving no personal rows. Agent focused checks passed preserved RFQ fields/unchanged other-role exports, currency edge cases, safe URLs, corrupted text and CSS class binding. Source-based responsive/accessibility review included sidebar width in tablet breakpoints. No browser, full local build, live mutations or post-deployment checks. Committed and pushed `4c1a3bb` to `origin/main`. First metadata-filtered Vercel observation for that exact commit already reported production READY (28-second build): `https://bunya-platform-r39tt5wxz-ahmedabumoallas-projects.vercel.app`. Stopped immediately; no post-push tests/browser or extra deployment polls, custom-domain alias not independently rechecked. Staged diff whitespace passed after removing an extra trailing blank line.

## 2026-09-26 — Second admin experience pass across all 36 navigation entries

- Pushed `e13428c` to `origin/main`. First Vercel deployment listing already reported the new production deployment READY (23-second build): `https://bunya-platform-1xewamy2w-ahmedabumoallas-projects.vercel.app`. No additional deployment polling, browser or post-push tests; custom-domain alias not independently rechecked.

- Replaced storefront glass/background interference with scoped opaque admin surfaces, forest-green navigation, consistent SVG icons, readable tables/forms and responsive layouts. Added searchable workspace directory, real review queues/counts, section navigation, skip link, mobile drawer focus handling and working account navigation.
- Extended curated named records to drivers, admins, alerts, contractor documents/reviews/comments, provider settlements, audit and category details. Audit uses actual `entity_table`/`occurred_at`; portfolio uses actual `profile_id` relationship. Added sorting within the displayed page and explicit filter counts/reset. Existing 14 operational sections inherit the same presentation and navigation. Sensitive settings values and audit payloads remain excluded; no schema/RLS/Storage policy changes.
- Operations now has Arabic event descriptions, filtered retry queue, loading/error feedback and retry busy state. Notifications have unread filtering, safe destinations, read feedback and sidebar count refresh. Contractor settlements have Arabic table data, masked bank suffixes, only valid workflow actions and explicit decision/reference dialog using the unchanged authorized RPC. Support has ticket search/status filters, readable actions and original request context. Service/portfolio review has contractor names, search and decision busy states. Policy editor supports unsaved text preview. Product/onboarding dialogs retain focus; improved user/finance/product loading labels and contrast. Native apps untouched.
- Fresh verification on changed source: TypeScript passed; targeted ESLint passed after moving new list state updates into asynchronous result callbacks. CSS parsing passed 7 changed/new sheets; deterministic navigation coverage 36/36, no raw ID columns, and zero-money formatting passed. Live read-only query-shape checks (limit 0, no personal records) passed for 12 added/changed selections; initial anonymous checks could not invoke protected contractor ownership helpers, so only affected queries were rechecked using the existing server credential. Corrected portfolio foreign-key name before success. Source-based desktop/mobile/accessibility review and diff whitespace passed. No browser, full local build, live mutations or native checks. Deployment should stop at build start as requested.

## 2026-09-26 — Clear operational pages, catalog and connected policies

- Catalog redesign pushed in `76f0209`: dedicated responsive component with category SVGs, real counts, search/status filters and calmer opaque surfaces. Targeted ESLint/CSS parse/diff checks passed; no browser.
- Pushed `fd54dc1`: 14 admin sections now use curated fields and related customer/provider/driver/project names with Arabic statuses, Gregorian Riyadh dates and two-decimal SAR amounts. Corrected actual sourcing/project/proposal column names. Lists have pagination, per-page search/status filters; details group context, finances and dates with related-record links. Existing sourcing assembly RPC retained. Confirmation page describes completed confirmations without exposing secret delivery codes; settings page explains an empty store and links to policy/role management. No schema or RLS change.
- Product review defaults to all statuses; empty filtered results explicitly state existing catalog count and provide reset. Corrupt question-mark/replacement-character content is flagged as unreadable; historical stored text was not invented or rewritten.
- Policy editor now selects a destination and previews placement. Published policies feed matching terms/privacy/deletion pages, the public policy center, provider/customer/contractor policy pages and links in enrollment/payment/driver views. Drafts remain excluded; existing static legal pages remain fallback until a corresponding policy is published. Existing RLS/session clients retained; no policy was authored/published by the agent.
- Fresh checks before push: TypeScript, targeted ESLint, CSS parse and diff whitespace passed. Formatting/audience assertions passed. Live read-only PostgREST shape checks passed 14/14 with limit 0 (no personal rows retrieved). Initial test harness failures were Windows stdin encoding and local Node 20 WebSocket availability; corrected harness used ASCII assertions and REST. No browser or full local build. Per user instruction stop at Vercel build start, not final deployment verification.

## 2026-09-26 — Readable administrator accounts

- `/admin/admins` now reads related profile names/contact details and Arabic role names/descriptions through the existing session-bound Supabase client and RLS. Replaces UUID columns with name, email, mobile, role and explicit enabled/suspended status; labels last activity in Arabic and uses readable Gregorian dates. Detail view omits internal UUID and shows the role description. No schema, access policy or write behavior changed.
- Targeted ESLint and diff whitespace check passed; committed and pushed `5b56546`. User requested stopping once Vercel starts; no browser or post-start tests.

## 2026-09-26 — Join-request tables and smaller web typography

- Converted provider/contractor join-request cards to semantic tables with contact, status, submission time, attachment count and existing detail/actions dialog. Reused admin table styling, horizontal scroll and keyboard-accessible controls. Reduced web font increase from 1.5px to 1px (minus 0.5px everywhere).
- Targeted component ESLint and diff whitespace check passed before push. Commit `6eec7a9` pushed to `origin/main`; Git-triggered production deployment `bunya-platform-71v5melea-ahmedabumoallas-projects.vercel.app` observed BUILDING. Stopped at build start as explicitly requested; completion/domain activation not checked, no browser or further tests.

## 2026-09-26 — Web platform synced to GitHub and production

- Pushed web source, required assets/configuration and existing migration history to `origin/main` in `7135db8`; excluded pending Flutter/native changes and local artifacts. Fixed Turbopack's relative PostCSS plugin resolution with a project-root absolute path in `a949992`, also pushed. Initial Git-triggered build failed on that path; replacement deployment `dpl_6sReh1Ft3K92kzcjQbheYrnDoFuc` reached READY. Slow manual upload was stopped in favor of Git integration.
- Both `www.buniahksa.com` and `buniahksa.com` now point to `https://bunya-platform-8n7uelgkv-ahmedabumoallas-projects.vercel.app`. Fresh HTTP 200 and fetched production CSS confirm the 1.5px web font increase. Production build succeeded; source ESLint, staged whitespace/secret-pattern checks, SQL static validation and 80 migration hashes passed. Read-only remote migration listing matched 001–080; no database migration applied. Localization check reports 200 missing translations, left unresolved; no browser or native build performed.

## 2026-09-26 — Web font sizes increased by 1.5px

- Added a PostCSS font-size adjustment after Tailwind, controlled by `--bunya-web-font-increase: 1.5px` on non-native HTML. Covers authored styles, CSS modules, responsive sizes and generated utilities without changing root rem spacing. Preserves zero-size hidden text and inherited sizes; relative em/% sizes compensate for the parent's increase. Flutter files unchanged; native web shells use the zero fallback.
- Fresh verification: all 27 source CSS files parsed/transformed (655 declarations); Tailwind/global CSS compilation and generated text utility assertion passed; responsive clamp, inheritance, zero-size preservation and idempotence checks passed. Next.js loaded both configured plugins. Targeted ESLint and diff whitespace checks passed. No browser, full build or deployment performed.

## 2026-09-24 — Correct blurry web logo image sizing

- Diagnosed BunyaLogo's default responsive sizes as 40px/52px despite the full header logo displaying around 112–125px. Corrected header sizes, provider sidebar size (144px), and shared full-logo defaults while retaining 48px for mark-only usage. Original 4525×3394 PNG unchanged; responsive image selection now accounts for the actual display width and device pixel density.
- Targeted ESLint/diff whitespace checks passed. Local HTTP confirmed header sizes and a successfully served 256px optimized logo. No browser visual inspection, deployment or native app changes; defect is specific to Next.js image sizing.

## 2026-09-24 — Softer storefront search hint

- Reduced the web catalog search placeholder to regular weight and 70% opacity per the user's screenshot. Entered search text and accessible label remain unchanged. Source and targeted diff whitespace review only; no browser or build required for this CSS-only adjustment.

## 2026-09-24 — Construction-oriented typography replaces Seet fonts

- User rejected the Seet type style. Replaced active Greta/Lifta typography with self-hosted IBM Plex Sans Arabic (400/500/600/700) for web body and headings and the Flutter Arabic theme. Other locale choices and mobile language-icon placement remain intact. Source fonts come from the existing local Seet font assets, converted to OpenType for Flutter without modifying glyphs.
- Fresh checks: targeted layout ESLint and diff whitespace checks passed; Next.js page and all four generated font resources returned HTTP 200; dart format unchanged; flutter analyze lib/src/theme.dart passed; localization/catalog tests passed (8). Restarted Flutter preview to load updated font assets. No browser visual inspection, production deploy or mobile release build.

## 2026-09-24 — Mobile header language icon only

- Reduced the mobile storefront language selector to a 44px square showing only the language icon. The transparent native select covers the full control, retaining the existing language choices, accessible name, keyboard focus and touch picker without visible text or arrow. Desktop/other selectors unchanged. Source review and targeted diff whitespace check passed; no browser check or deployment.

## 2026-09-24 — Mobile web language selector in storefront header

- Moved the visible language control into the storefront header beside the quote icon at widths up to 760px, using the existing locale selector and state. The floating instance is hidden only when that header is present at mobile width; desktop and other routes retain the existing control. Added a 44px control, keyboard focus outline, constrained select width and shrinkable logo column; preserved RTL/LTR ordering and native web-shell column positions. User explicitly scoped this change to mobile web.
- Targeted ESLint and diff whitespace checks passed. Local Next.js HTTP 200 confirmed the language control is rendered inside the header immediately before the quote button. Source-reviewed responsive rules; no browser visual check or production deployment.

## 2026-09-24 — Seet typography applied locally

- User requested the type style of `https://9eetksa.com`. Its live stylesheet `/_nuxt/entry.D18CP3hL.css` specifies Greta Arabic for body copy and Lifta Black for display typography. Copied matching WOFF2 assets from the existing local Seet project and verified byte identity against the live site's font URLs. Bunya Next.js now self-hosts both through next/font/local; body/forms use Greta, h1–h3 use Lifta with Greta fallback. Existing responsive sizing and colors remain intact.
- Flutter Arabic theme uses bundled Greta for text and Lifta for display/headline styles with Greta fallback for Latin characters. Converted the same WOFF2 font data to uncompressed OpenType assets; retained other locales' existing font choices. No new Android/iOS release artifacts.
- Verification run: ESLint on src/app/layout.tsx passed; flutter analyze lib/src/theme.dart passed; flutter test test/src/localization_test.dart test/src/catalog_layout_test.dart passed (8 tests); dart format theme.dart unchanged after formatting; targeted diff whitespace check passed. Next.js local HTTP 200 and both generated font resources HTTP 200 (48,180 and 26,408 bytes). An initial HTTP asset probe used the page URL rather than the stylesheet URL and returned 404; correcting relative URL resolution confirmed successful font serving.
- Restarted Flutter web preview on 8090 to include new bundled fonts; Next.js on 3001 compiled the changes. Source-based typography review only, no visual browser inspection, production deployment or full build.


> **آخر حالة Google — 24 سبتمبر 2026 بعد إكمال المالك التحقق:** تحقق مباشر من Play Console أكد ظهور «تعمل Google على إثبات هويتك» و«تم تحميل المستندات». المراجعة لدى Google وقد تستغرق بضعة أيام، وسيصل بريد إلى صاحب الحساب عند اكتمالها. تأكيد الهواتف ينتظر موافقة Google، وزر إنشاء التطبيق ما زال معطلًا. الخطوة التالية: انتظار نتيجة المراجعة ثم تأكيد الهواتف وإنشاء التطبيق ورفع الإصدار المناسب؛ لم يُرفع ملف تطبيق بعد. هذا التحديث يستبدل حالة انتظار الإكمال على الجوال السابقة.



> **Google Play — تحقق مباشر 24 سبتمبر 2026:** الحساب الصحيح `cto.buniah@gmail.com` / `6804780615083834898` مفتوح. إنشاء أول تطبيق معطل حتى إثبات الهوية والمؤسسة؛ تأكيد الهواتف ينتظر موافقة Google على المستندات. فُتح مسار إثبات الهوية، وعرض Google نجاح ربط جهاز المالك الجوّال وطلب إكمال الخطوات المتبقية عليه مع إبقاء نافذة الكمبيوتر مفتوحة. الجلسة محفوظة للاستئناف؛ لم يتأكد إرسال مستندات أو اكتمال التحقق، ولم يُرفع AAB.



> **آخر تحديث 24 سبتمبر 2026 — تأكيد محاولة Apple الجديدة واستئناف Google:** أكد المالك إتمام الدفع مجددًا وقدم صورة صفحة `Thank You` بتاريخ 24 سبتمبر لعضوية Apple Developer لمدة سنة بمبلغ US$99 والتسجيل `NWS2937468`. الصفحة تؤكد استلام الطلب ومعالجته خلال ما يصل إلى يومَي عمل ثم إرسال بريد التفعيل؛ لا تُعد إثباتًا لتحصيل نهائي أو تفعيل العضوية. هذه محاولة أحدث من مشكلة الطلب `D005252689`؛ لم يظهر رقم طلب شراء جديد في الصورة. لا تحفظ بيانات البطاقة أو الفوترة. طلب المالك الآن إكمال موضوع رفع Google Play؛ هذا يستبدل تأجيل Google ومنع رفعه التاريخيين، مع بقاء جاهزية الحساب والإصدار والتحقق الفعلي شروطًا للإكمال. حالة Google الحالية قيد الفحص.


> **متابعة 24 سبتمبر 2026 — إعادة محاولة الدفع بطلب المالك:** فُتح التسجيل الحالي `NWS2937468` ثم `Continue to payment` ووصل المتصفح إلى نموذج Apple الرسمي `https://developer.apple.com/programservices/manualpurchase/?selectedProductIds=ad19` لعضوية سنة بمبلغ US$99. تُرك النموذج فارغًا ومفتوحًا للمالك؛ لم تُدخل بيانات بطاقة ولم يُرسل طلب شراء جديد. طلب المالك الحالي يسمح بمحاولة الدفع مجددًا، ويتقدم على تعليمات عدم تكرار الدفع التاريخية؛ لا توجد نتيجة دفع جديدة مؤكدة.


> **تحديث مباشر 24 سبتمبر 2026 — مشكلة دفع Apple:** بوابة `https://developer.apple.com/account/` تعرض الشركة `(Pending)` وتنبيه شراء العضوية. أحدث رسالة ظاهرة في Lark من `noreply@email.apple.com` بعنوان `Action Required: Order D005252689` بتاريخ أمس (23 سبتمبر)، الساعة 16:14 بحسب عرض البريد، تفيد بتعذر معالجة الدفع للطلب المؤرخ 20 سبتمبر. توجد رسالة مماثلة بتاريخ 21 سبتمبر. تطلب Apple مراجعة جهة إصدار البطاقة، ثم التواصل عبر صفحة المطور لإعادة المحاولة أو تغيير معلومات الدفع؛ وتذكر إلغاء الطلب إذا تعذرت المعالجة بعد 4 أيام، دون تأكيد أن الإلغاء وقع. بريد استفسارات الدفع المذكور: `devpayment@apple.com`. هذا يصحح تفسير السجل السابق: تأكيد استلام طلب الشراء لا يثبت نجاح التحصيل. رقم طلب الشراء `D005252689` مختلف عن رقم التسجيل `NWS2937468`. لم تُرسل رسالة أو تُكرر عملية دفع أو تُغيّر بيانات البطاقة؛ التفعيل غير مكتمل. يتقدم هذا التحديث على الحالات التاريخية أدناه.


## 2026-09-24 — Store readiness and local previews

- Apple activation and Google verification were not checked in authenticated consoles today. Latest recorded checks remain September 21 and September 12 respectively; those are historical account states.
- Existing Android AAB SHA256 verified with Get-FileHash: `5BB490249A800372EAF9C3233FA8585625456E4005B020CDAEFD5FA8D55FE01B`, matching the signed September 7 artifact (`1.0.2+3`). No new mobile build/upload or fresh functional certification.
- Android/iOS native Firebase configuration files remain absent. Existing release handoff still lists iOS signing/IPA/TestFlight, native push, device/payment return/account lifecycle checks, store materials and disclosures. ADB reported no connected devices. Local Node is still v20.20.2.
- Started Flutter web preview with `apps/bunya_app/tool/run.ps1 -Target web`: HTTP 200 at http://127.0.0.1:8090, using production API. Started Next.js with `npm run dev -- --port 3001`: HTTP 200 and Bunya title at http://localhost:3001. Port 3000 belongs to another project. Logs are `tmp/app-preview-20260924.log`, `tmp/web-preview-20260924.log` and matching `.err.log` files.
- Invoke-WebRequest confirmed production `/privacy` and `/account-deletion` return HTTP 200; no deletion flow was exercised. No browser inspection, new suites, migrations or deployment. An OS request to open preview URLs was blocked by execution policy; links remain available to open manually.

> **تحديث 21 سبتمبر 2026 — Apple:** قبلت Apple تسجيل المنظمة في رسالة 15 سبتمبر. أكمل المالك الدفع لعضوية سنة بمبلغ **99 دولارًا** للطلب `NWS2937468`، وقدم صورة صفحة `Thank You` التي تؤكد استلام طلب الشراء وقيد المعالجة. تحقق مباشر من Lark أكد وصول `Order Acknowledgement` و`Agreement signed: Apple Developer Program License Agreement`. بوابة الحساب ما زالت تعرض الشركة `(Pending)` وتنبيه أن معالجة الشراء قد تستغرق 48 ساعة؛ تأكيد الطلب يذكر يومَي عمل. **التسجيل والاتفاقية وإرسال طلب الشراء مكتملة؛ تفعيل العضوية ما زال بانتظار Apple. لا تكرر الدفع.** لم تُرصد رسالة تفعيل في صندوق الوارد عند الفحص، ولا توجد متابعة تلقائية مجدولة. لا تحفظ بيانات البطاقة. لا رفع للتطبيق ولا متابعة Google ضمن هذه المهمة. هذا التحديث يتقدم على الحالات التاريخية أدناه.

> حُفظت بيانات التسجيل وخطوات الجلسة ونقطة الاستئناف بطلب المالك في 12 سبتمبر 2026 في [سجل المتاجر المجمع](docs/STORE_ENROLLMENT_HANDOFF_2026-09-12.md). هذا السجل هو المرجع الأحدث عند تعارضه مع الحالات التاريخية أدناه، ويحتوي معرفات الطلبات والحسابات وبيانات الشركة والإنجازات والمتبقي دون أسرار دخول.

> **نقطة الاستئناف الحالية:** Apple ينتظر معالجة شراء العضوية للطلب `NWS2937468` ثم بريد التفعيل؛ لا تعِد التسجيل أو الدفع. بقية تحقق Google Play مؤجلة بطلب المالك، ويظل عدم رفع أي تطبيق نافذًا. تحديث 21 سبتمبر أعلاه هو الحالة المعتمدة؛ الفقرات التالية توثق جلسة 12 سبتمبر.

### سجل تاريخي — 12 سبتمبر 2026

> **التوجيه الحالي للمالك:** تجهيز حسابَي Apple وGoogle Play فقط؛ لا ترفع أي ملف تطبيق أو ترسله للمراجعة الآن. أبل قبل D‑U‑N‑S `986471359` وأُرسل تسجيل المنظمة برقم **NWS2937468**، وحالته `Your enrollment is being processed` بانتظار التحقق من صلاحية التوقيع. أكد المالك أنه المالك/المؤسس ولديه صلاحية التوقيع. Google مدفوع حسب تأكيد المالك، وتأكد إنشاء حساب المنظمة **6804780615083834898**. أُثبت الموقع في Search Console ثم Google Play بنجاح؛ بقي رفع مستند تسجيل الشركة والتحقق من الممثل ثم تأكيد الهواتف بعد موافقة Google. لا حساب جاهز للنشر بالكامل بعد، ولا IPA أو رفع تطبيق جديد. المتطلبات في `docs/STORE_UPLOAD_REQUIREMENTS_2026-09-12.md`؛ الفقرات التالية سجل سابق في اليوم نفسه.

> استؤنف العمل بطلب المالك يوم 12 سبتمبر 2026 مساءً: إكمال التسجيل ورفع بُنية إلى Apple وGoogle Play. رقم D‑U‑N‑S **986471359** باسم `DAFAF ALEBDA TRADING COMPANY`. قَبِل Google الرقم وطابق الشركة وأنشأ ملف الدفع وأُثبت بريد الدعم؛ وصل لاحقًا إلى صفحة إضافة البطاقة بعد تقدم المالك من البنود، ولا يوجد تأكيد دفع بعد. دخل المالك إلى Apple بالحساب `support@buniahksa.com`؛ اختير Company / Organization وأُدخل الاسم القانوني والرقم، والصفحة تنتظر CAPTCHA ثم Continue لفحص المطابقة. لم يُرفع التطبيق بعد ولم يُنتج IPA. تفاصيل التسجيل الحالية في `STORE_ENROLLMENT_STATUS.md` والتجهيز في `docs/STORE_PUBLISHING_HANDOFF_2026-09-07.md`.

## 2026-09-12 — وصول رقم D‑U‑N‑S

- آخر خطوة بعد دخول المالك: Apple عند `/enroll/organization/details/edit/legal-entity` بالاسم `DAFAF ALEBDA TRADING COMPANY` والرقم `986471359`، بانتظار إكمال CAPTCHA؛ لم تُختبر المطابقة بعد. Google أصبح عند نموذج إضافة بطاقة فارغ، وقد طُلب من المالك إكمال الدفع بنفسه في المتصفح. التبويبان محفوظان للمتابعة. لا تُفسر رسالة government organization الموجودة في شجرة الإتاحة وحدها على أنها تصنيف فعلي؛ لقطة الصفحة لا تعرضها ولم يُرسل البحث بعد.

- تحديث مساءً بعد طلب استئناف النشر: Google قبل الرقم وأنشأ ملف الدفع؛ اكتملت بيانات التسجيل وإثبات بريد الشركة حتى صفحة «البنود» وزر «إنشاء حساب والدفع» (25 دولارًا). لم تُقبل اتفاقيتا التسجيل بعد؛ يلزم تأكيد المالك على الاتفاقيتين وإقرار العمر والصلاحية القانونية. Apple ينتظر دخول المالك في الصفحة المفتوحة. لا دفع ولا رفع لأي متجر، وAAB القديم مطابق لبصمته المسجلة دون بناء جديد أو اختبارات جديدة. نقطة الاستئناف التفصيلية والحقول في `STORE_ENROLLMENT_STATUS.md`.

- فُحص بريد الشركة في Lark: وصلت رسالة من `donotreply@iresearch.dnb.com` بتاريخ 8 سبتمبر 2026 الساعة 14:29 بتوقيت الرياض، تؤكد إغلاق الحالة `10902911` والمتابعة `10843019` وإصدار الرقم **986471359** باسم `DAFAF ALEBDA TRADING COMPANY` بعد التحقق من السجل الوطني، بصفة شركة ذات مسؤولية محدودة. تطلب الرسالة إعادة التحقق بعد 2–4 أيام عمل. لم يُختبر قبول الرقم في Apple أو Google Play في هذه الجلسة.
- تبين أن متابعة 7 سبتمبر إلى `appdeveloper@dnb.com` ارتدت برسالة `550 5.1.10 RecipientNotFound`؛ لا يُعاد استخدام هذا العنوان دون التحقق منه. لم تُرسل رسائل جديدة.
- هذا التحديث يحل محل حالة انتظار إصدار الرقم في السجلات التاريخية أدناه.

> متابعة تسجيل Apple وGoogle Play وطلب D‑U‑N‑S موثقة تفصيليًا في `STORE_ENROLLMENT_STATUS.md`. في هذا السياق، عبارة «شيك على الإيميل» تعني فحص `support@buniahksa.com` في Lark Mail بحثًا عن تحديث للحالة `10902911` ورقم المتابعة `10843019`.

> نقطة استئناف فحص هاتف Android بتاريخ 2026-09-02 موثقة في `ANDROID_TEST_HANDOFF_2026-09-02.md`. تشمل الجهاز، ما فُحص، العيوب التي أصلحت في المصدر، سبب توقف أداة التكامل، حالة الهاتف عند التوقف، وخطوات جلسة الغد. لا يحتوي الملف على أسرار أو بيانات دخول.

> سجل تجهيز 7 سبتمبر: بيانات الممثل مكتملة، دخول المتاجر مكتمل حتى خطوة D-U-N-S، وحزمة Android موقعة محليًا. وصل الرقم لاحقًا كما هو موثق أعلاه؛ لم يُرفع التطبيق إلى المتجرين ولم تُخصم رسوم.

## 2026-09-07 — تجهيز توقيع Android ومسار iOS للنشر

- متابعة D&B عند 08:28 بتوقيت الرياض: اعتمد المالك `Ahmed Mohammed Abu Moala` بصفة `CTO`. أُكملت بيانات التواصل في نموذج الدعم؛ النموذج يقدم إنشاء رقم جديد أو تعديل رقم قائم فقط، وتقرير الحالات يتطلب حساب D&B SSO منفصلًا. أُرسلت المتابعة من `support@buniahksa.com` إلى `appdeveloper@dnb.com` المدرج في صفحة تسجيل Apple، بعنوان `Status and missing-document check - Case 10902911 / Tracking ID 10843019`، وتأكد ظهورها في Sent. طلبت الحالة والمستندات الناقصة والموعد المتوقع وأقرب إنجاز ممكن، دون طلب رقم مكرر أو مرفقات أو دفع. سجل النص والإرسال في `docs/DUNS_FOLLOWUP_DRAFT_2026-09-07.md`. لم يصل رد أو رقم أثناء هذه الخطوة، ولا يعني وجود الرسالة في Sent تأكيد تسليمها للمستلم.
- تحديث بعد دخول المالك: تأكد تسجيل الدخول إلى Apple بالحساب الصحيح `support@buniahksa.com`. بوابة المطور تعرض `Join the Apple Developer Program`؛ لا توجد عضوية نشر فعالة. فُتح التسجيل واختير `Company / Organization` ووصل إلى `Tell us about your organization` التي تطلب الاسم القانوني وD-U-N-S قبل المتابعة. لقطة المستخدم لـGoogle تؤكد وصول الحساب الصحيح إلى حقل D-U-N-S الإلزامي. بذلك أُغلق عائق الدخول، وبقي رقم المنظمة قبل الدفع في المتجرين. لم يُحل CAPTCHA ولم تُرسل استمارة منظمة ناقصة ولم تُخصم رسوم. اكتملت لاحقًا بيانات ممثل الشركة وأُرسلت المتابعة عند 08:28 كما هو موثق أعلاه.
- أكد المالك تنفيذ التجهيز وموافقته على الدفع. لم تُخصم رسوم ولم تُنشأ عضوية مدفوعة أو خدمة بناء سحابية؛ اكتمل الدخول لاحقًا إلى الحسابين ووصل تسجيل الشركة إلى رقم D-U-N-S. D-U-N-S ما زال مانعًا لتسجيل الشركة.
- أُنشئ مفتاح رفع RSA 3072 باسم الشركة في `%USERPROFILE%\.bunya\signing\android\upload-keystore.jks`، وملف خصائص خاص بجواره ونسخة محلية في `apps/bunya_app/android/key.properties`. صُرّحت الملفات للمستخدم الحالي وSYSTEM فقط، وهي خارج Git/متجاهلة. لم تُحفظ كلمات المرور في المرجع أو الشيفرة، ولم تُنشأ نسخة احتياطية خارج الجهاز. دليل الاستعادة `docs/ANDROID_RELEASE_SIGNING.md`.
- عُدّل Gradle ليستخدم توقيع release الخاص بدل debug، مع تحقق الحقول ومنع alias التجريبي؛ بناء AAB يتوقف مبكرًا إذا غاب ملف التوقيع. نجح اختبار هذا المنع قبل إنشاء المفتاح.
- بُني `apps/bunya_app/build/app/outputs/bundle/release/app-release.aab` عند 08:20 بتوقيت الرياض: `com.buniahksa.app`، الإصدار `1.0.2+3`، الحجم 56,747,865 بايت. SHA256 للحزمة `5BB490249A800372EAF9C3233FA8585625456E4005B020CDAEFD5FA8D55FE01B`. تحقق `jarsigner` أعاد `jar verified`، و`keytool` أثبت شهادة الشركة الصالحة حتى 23 يناير 2054، ببصمة SHA256 `6D:45:75:04:43:A1:88:63:21:94:D0:6B:EE:72:EA:73:95:26:92:3F:B5:44:8E:E2:9C:5C:A4:2D:28:9D:63:88`. صدرت تحذيرات JAR حول الشهادة الذاتية وعدم timestamp وترتيب manifest عند القراءة المتدفقة؛ لم يُختبر قبول Play Console للحزمة بعد.
- نجح `flutter analyze` بلا ملاحظات، و`flutter test` (8 اختبارات)، وفحص التنسيق بلا تغييرات. محاولة البناء الأولى فشلت في generated plugin registrant الخاص بـintegration_test أثناء تشغيل فحص Flutter بالتزامن؛ الإعادة بعد انتهاء الفحص نجحت. يجب تشغيل أوامر Flutter بالتتابع داخل هذا المشروع لتجنب تغيير ملفات التوليد أثناء البناء. ظهر تحذير Kotlin daemon وتابع البناء بنجاح.
- جُهز `codemagic.yaml` لبناء IPA يدويًا على macOS M2 (حتى 45 دقيقة)، دون triggers أو نشر تلقائي. نجح تحليل YAML، لكن لم تُشغّل بيئة macOS ولم يُنتَج IPA؛ يحتاج حساب Apple فعالًا وشهادة/profile ومجموعة إعدادات عامة، وإعداد خدمة البناء لدى المالك. لا يوجد رفع مصدر أو أسرار إلى Codemagic. الدليل الكامل `docs/STORE_PUBLISHING_HANDOFF_2026-09-07.md`.
- اكتملت بيانات نموذج D&B، ثم أُرسلت المتابعة بالبريد لأن النموذج لا يعرض استفسار حالة دون حساب SSO منفصل. لم يُنشأ طلب رقم مكرر. تظل اختبارات الدفع والإشعارات وiPhone وبيانات المتاجر متطلبات مستقلة عن نجاح بناء AAB.

## 2026-09-07 — متابعة بريد D&B قبل تجهيز الإصدار والإرسال

هذا سجل الفحص الأول في اليوم؛ الحالة الأحدث في القسم السابق، وتشمل إغلاق عائق توقيع Android ودخول الحسابات وإرسال المتابعة.

- طلب المالك النشر في App Store وGoogle Play اليوم. مراجعة إعداد Gradle الحالية أكدت استمرار توقيع release بمفتاح debug، ولا يوجد `apps/bunya_app/android/key.properties`؛ ملف AAB المتوفر مؤرخ 2 سبتمبر. تقرير الإصدار يسجل حاجة iOS إلى عضوية وتوقيع وبناء macOS، ولم تُنتج أو تُرفع نسخة جديدة في هذه المتابعة.
- روجعت المصادر الرسمية: Apple يشترط D-U-N-S للمنظمة ويذكر حتى 5 أيام عمل للإصدار وحتى يومي عمل للمزامنة؛ Google لا يجعل الاستعجال استثناءً من رقم المنظمة، والحساب الشخصي الجديد يتطلب 12 مختبرًا طوال 14 يومًا قبل طلب الوصول للإنتاج. سُئل المالك عن حسابات نشر مفعلة يملكها هو أو العميل؛ لم يُعتمد تغيير نوع الحساب أو الناشر.
- جُهزت مسودة محلية فقط في `docs/DUNS_FOLLOWUP_DRAFT_2026-09-07.md` للاستعلام عن الحالة والمستندات الناقصة. لم تُرسل إلى D&B. الموقع العام استجاب HTTP 200؛ هذا فحص وصول فقط وليس اعتمادًا لجميع وظائفه أو إصدار متجر.
- محاولة الوصول الحي إلى Apple Developer عرضت صفحة تسجيل الدخول. اختيار حساب Google Play المعتمد `cto.buniah@gmail.com` أعاد خطأ Google بعنوان `Something went wrong`؛ لم يُغيَّر إعداد حساب آخر ولم تُدفع رسوم.
- فُحص بريد `support@buniahksa.com` في Lark Mail عند 08:06 صباحًا بتوقيت الرياض: الوارد والبحث بالحالة `10902911` والمتابعة `10843019` يعرضان رسالة تأكيد الاستلام المؤرخة 2 سبتمبر فقط، وحقل Duns فيها فارغ. لا توجد رسالة نتيجة جديدة، وSpam فارغ. لم تُرسل أي رسالة.
- رابط صندوق المؤسسة المستخدم بنجاح: `https://pjprmm7u1qll.jp.larksuite.com/mail`؛ الرابط العام `mail.larksuite.com` لم يستجب. حُدّث `STORE_ENROLLMENT_STATUS.md` بنتيجة الفحص والرابط لتسهيل المتابعة.

## 2026-09-04 — فحص بريد D&B ومراجعة حالة المشروع

- فُحص `support@buniahksa.com` فعليًا في Lark Mail عند 11:18 صباحًا بتوقيت الرياض. البحث برقم الحالة `10902911` ورقم المتابعة `10843019` أعاد رسالة تأكيد الاستلام المؤرخة 2 سبتمبر فقط؛ لا توجد رسالة نتيجة جديدة ولا رقم D‑U‑N‑S صادر، ومجلد Spam فارغ.
- فُتح مرفق تقرير DMARC الوارد من `noreply-dmarc-support@google.com` قراءةً فقط. التقرير يخص النطاق `buniahksa.com` ومعرّفه `891954903590811967`، ويسجل رسالة واحدة نجحت في كل من DKIM وSPF (`pass`) دون حجر أو رفض؛ هو تقرير مصادقة بريد اعتيادي وليس تحديثًا من D&B ولا يحتاج ردًا.
- شُغلت نسخة Flutter Web المحلية للتعديل عبر `apps/bunya_app/tool/run.ps1` على `http://127.0.0.1:8090` مع توجيه API إلى `https://www.buniahksa.com` وإعدادات Supabase العامة من `.env.local`. اكتمل التحميل وظهرت الواجهة الرئيسية في Chrome؛ الخادم عملية تطوير مؤقتة ويحتاج إعادة تشغيل إذا انتهت الجلسة.
- روجعت حالة المستودع دون تشغيل بناء أو اختبارات ودون تعديل المصدر. آخر commit مسجل هو `03a258b` بتاريخ 25 أغسطس 2026، بينما العمل المنجز بعده ما زال محليًا وغير ملتزم ويشمل تغييرات كبيرة في Next.js وFlutter وSupabase ومخرجات اختبار/بناء وملفات مؤقتة. نقطة الاستئناف العملية للهاتف ما زالت في `ANDROID_TEST_HANDOFF_2026-09-02.md`، وتسجيل المتاجر ما زال متوقفًا على D‑U‑N‑S.

## 2026-09-03 — فحص بريد D&B لمتطلبات المتاجر

- فُحص `support@buniahksa.com` فعليًا في Lark Mail عند 06:52 مساءً بتوقيت الرياض. لا توجد رسالة نتيجة جديدة من Dun & Bradstreet ولا رقم D‑U‑N‑S صادر للحالة `10902911` أو المتابعة `10843019`؛ ما زالت رسالة تأكيد الاستلام فقط موجودة، ومجلد Spam فارغ.
- لا توجد رسالة Apple جديدة تخص إكمال تسجيل المؤسسة. لذلك يبقى تسجيل Apple Developer وGoogle Play متوقفًا حتى وصول رقم D‑U‑N‑S ومزامنته، ولا توجد خطوة دفع جاهزة للتنفيذ الآن.

## 2026-09-01 — Apple organization enrollment decision

- Apple Developer enrollment is being pursued as a Company / Organization under the legal entity `Dafaf Alebda Trading Company` (`شركة ضفاف الابداع التجارية`), a Saudi single-member limited liability company whose supplied commercial-registration certificate shows active status.
- The supplied bank letter dated 2026-08-19 supports the same legal entity name and unified number. The supplied National Address proof expired on 2025-07-10, so it must not be uploaded to Apple as current proof; obtain a fresh SPL National Address certificate if Apple requests address documentation.
- Organization enrollment cannot be completed until the company has a matching D-U-N-S Number. Apple's lookup returned "Your organization was not found" for the available legal name and headquarters data. With the account holder's explicit consent, the free D-U-N-S request was submitted to Dun & Bradstreet through Apple. D&B confirmed receipt from `donotreply@iresearch.dnb.com`: tracking ID `10843019`, case number `10902911`, business `Dafaf Alebda Trading Company`, location `Abha, Saudi Arabia`, category `Add business - Mini Inquiry - Identity Data Only`. Apple organization enrollment remains pending until D&B sends the result and Apple synchronizes the issued D-U-N-S Number.
- The App Store seller name will be the verified legal entity name, while `Bunya` remains the app/brand name. Apple also requires legal signing authority, a functional public website/domain associated with the organization, and a work email on that domain.

## 2026-09-02 — Store legal identity and Google Play preparation

- Added public legal pages at `/privacy`, `/terms`, and `/account-deletion`. They identify Bunya as operated by `Dafaf Alebda Trading Company LLC` / `شركة ضفاف الإبداع التجارية`, unified number `7041070603`, and use `support@buniahksa.com` for support and deletion requests.
- Added the same legal identity and links to the public website footer and the Flutter Account tab, including access before login. The deletion page provides a functional email request path and warns users not to send passwords, verification codes, or card details.
- Targeted verification passed: `npx tsc --noEmit` and targeted ESLint completed with exit code 0. `flutter analyze` reported no errors or warnings; only the same six pre-existing info diagnostics remain. Desktop browser review confirmed the legal identity and all three links render correctly.
- Production deployment `dpl_HAYDTxyigx4QqKqYyAGsgDvienpX` completed successfully and was aliased to `https://www.buniahksa.com`. Live checks confirmed `/privacy`, `/terms`, `/account-deletion`, and the homepage legal footer return the expected titles, company identity, unified number, and links.
- Google Play Console initially used `developer@buniahksa.com`, but that identity redirected authentication to `admin.google.com` and Google rejected the verification attempt. The incorrect Admin flow was abandoned. The owner-designated work Google account `cto.buniah@gmail.com` is now signed in, and two-step verification was fully enabled with Google Prompt, Authenticator, and the official management phone `0508424401`.
- Google Play organization onboarding is configured as `Company or business` with public developer name `Bunya | بُنية`. The flow reached the Google Payments dialog `Enter your organization's D-U-N-S number`; no payment profile was created and no fee was charged because D&B has not issued the nine-digit D-U-N-S Number yet. The browser remains at that field for continuation after case `10902911` is resolved. Do not create a personal developer profile as a workaround.

## 2026-09-01 — البريد الرسمي المجاني عبر Lark Mail

- أُنشئت مؤسسة `Buniah | بُنية` على خطة Lark المجانية، مع استخدام `cto.buniah@gmail.com` كحساب المالك وتسجيل الدخول.
- تم التحقق من نطاق `buniahksa.com` وتفعيله للبريد، وإنشاء العنوان الرسمي `support@buniahksa.com` وربطه بعضو `Buniah CTO`.
- أضيفت سجلات Lark Mail المطلوبة في Vercel DNS: MX وSPF وDKIM وDMARC، مع الإبقاء على سجلات Resend الحالية دون تغيير. حالة النطاق في Lark هي `Enabled` وحالة DKIM هي `On`.
- نجح اختبار الإرسال الفعلي من `support@buniahksa.com` إلى `cto.buniah@gmail.com`؛ عرض Lark حالة `Sent successfully` وظهرت الرسالة في مجلد البريد الصادر.
- لم تُحفظ في المشروع أي كلمة مرور أو رمز تحقق أو قيمة سرية خاصة بالبريد.

## 2026-09-01 — Apple Sign In وحساب المقاول التجريبي الكامل

- جُهز تسجيل الدخول عبر Apple داخليًا للويب وFlutter/iOS خلف مفتاح تعطيل افتراضي آمن. أضيف مسار OAuth للويب، وتسجيل Native على iOS باستخدام nonce وID token، وملف entitlement، ودليل الإعداد `docs/APPLE_SIGN_IN_SETUP.md`. يبقى التفعيل الخارجي متوقفًا حتى إضافة بيانات Apple Developer إلى Supabase وضبط Service ID وApp ID ومفتاح التوقيع وروابط العودة.
- أُنشئ واعتمد حساب المقاول التجريبي `ajjbari.a@gmail.com` باسم «مؤسسة الأجباري للمقاولات» في خميس مشيط. الحساب نشط وظاهر في الدليل ومتوافر، وأضيفت له تخصصات ومناطق عمل وملخص وخبرة ثماني سنوات وموقع Google Maps. تم التحقق من تسجيل الدخول بكلمة المرور التي حددها مالك المشروع، ولم تُحفظ كلمة المرور في هذا المرجع.
- نُفذت دورة مقاول حية كاملة بعميل E2E مخصص: طلب مشروع مطابق، فرصة، عرض، قبول، إنشاء مشروع وقيد مالي، بدء مرحلة، إرسالها لاعتماد العميل، ثم اعتمادها. انتهى المشروع التجريبي `CTR-16A2E6A2D7` بحالة `completed` وتقدم 100%.
- أُضيفت واعتمدت خدمة «خدمة المقاولات العامة التجريبية» وعنصر معرض «مشروع ترميم تجريبي». الخدمة نشطة، وعنصر المعرض معتمد وظاهر للعامة.
- صُحح توجيه `contractor.proposal_submitted` إلى العميل/الإدارة وتوجيه `customer.milestone_approval_requested` إلى عميل المشروع، وأصبحت أحداث المقاول تُحفظ أيضًا في `contractor_notifications`. أضيف `admin.project_no_contractors` إلى dispatcher، وأضيفت أحداث السلسلة الناقصة إلى كتالوج الأحداث، وأصبحت أخطاء حفظ الإشعار تفشل الحدث بدل نجاحه الصامت.
- طُبقت migrations `077`–`080` على Supabase البعيد: إصلاح حارس إنشاء مراحل العرض المقبول، استكمال حقل `financial_kind` الإلزامي في قيد القبول، وتحويل مفتاح idempotency لإشعارات المقاول إلى قيد فريد صالح لـupsert، وسحب التنفيذ المباشر لدالة trigger ذات `SECURITY DEFINER` الخاصة برسالة نافذة التسعير. عولجت أحداث الاختبار المستهدفة بنجاح، وأكدت الجداول وجود إشعارات opportunity/proposal/milestone/catalog للمقاول وإشعارات العرض واعتماد المرحلة للعميل.
- نجح `npx tsc --noEmit` وESLint الموجه وحارس hashes لـ80 migration. نجح `flutter analyze` بلا أخطاء أو تحذيرات، مع ست ملاحظات `info` سابقة.

## 2026-09-01 — تدقيق جاهزية شامل قبل App Store وGoogle Play

- أُجري تدقيق قراءة فقط للويب وFlutter وقاعدة الإنتاج والإشعارات والدفع والمقاولين والمزودين والمالية ومتطلبات المتاجر. التقرير التفصيلي محفوظ في `docs/RELEASE_READINESS_AUDIT_2026-09-01.md`.
- القرار: الإصدار الحالي غير جاهز للرفع النهائي. أبرز الموانع: Push غير مهيأ ولا توجد أجهزة مسجلة، Android Release موقع بمفتاح debug ولا يوجد AAB إنتاجي، iOS ينقصه Firebase/APNs والتوقيع و`NSPhotoLibraryUsageDescription`، رجوع Paymob للجوال لا يستخدم deep links، ولا يوجد حذف حساب أو صفحات خصوصية/شروط عامة.
- نجح بناء Next.js وESLint الموجه للمصدر واختبارات المسارات والتكامل الثابت وحارس 76 migration. `flutter analyze` بلا errors/warnings مع 6 ملاحظات info. فشل فحص الترجمة بـ395 ترجمة مفقودة، وفشلت حراس lint الشامل وSQL/no-mocks/UI colors لأسباب موثقة في التقرير.
- الإنتاج يحتوي مسارًا تجاريًا حيًا مكتملًا حتى الدفع والإسناد والقيد المالي: طلب واحد، عرض مقبول، دفع ناجح، توريد مسند، وقيد إجمالي 5.10 ر.س بعمولة حالية 0%. لا يوجد سائق، لذلك التسليم النهائي غير مجرب.
- يوجد مزود واحد معتمد ببيانات اتصال وموقع ومنطقة مكتملة، لكن بلا شعار أو وصف عام. مطابقة RFQ الحالية تعتمد على منتج مزود معتمد/منشور مطابق بالاسم أو التصنيف؛ اختيار تصنيف المزود عند الانضمام وحده لا يكفي.
- دليل المقاولين يعمل بصريًا على الهاتف، لكن الإنتاج يحتوي صفر طلبات وصفر ملفات مقاولين وصفر إشعارات مقاولين؛ لا يمكن اعتماد سلسلة المقاول قبل تجربة حساب حي كاملة.
- البريد الرسمي موثق، وGreen API عاد `authorized` بعد حالة `starting` قصيرة. كل 29 إرسالًا خارجيًا مسجلًا حاليًا حالته `submitted`، مع التنبيه أن ذلك لا يثبت قراءة الجهاز.
- كشف التدقيق أن `admin.project_no_contractors` وثلاثة أنواع domain/outbox غير مطالبة من dispatcher، ويوجد حدثان قديمان pending دون محاولة. كتالوج الأحداث وdispatcher غير متزامنين.
- لم تُنفذ أي كتابة لبيانات الإنتاج أو نشر أو بناء APK/AAB أثناء التدقيق.

## 2026-09-01 — تشغيل دليل المقاولين في الويب وFlutter

- كان زر «المقاولون» في الصفحة الرئيسية لتطبيق Flutter يعرض رسالة مؤقتة بأن الدليل قيد التجهيز؛ استُبدل بمسار فعلي يفتح شاشة دليل المقاولين ويقرأ نفس بيانات المنصة الرسمية.
- المصدر العام للدليل يعرض كل سجل `contractor_profiles` حالته `approved` بصرف النظر عن تفعيل الاشتراك أو علم الظهور القديم، لأن اعتماد طلب انضمام المقاول من الإدارة هو شرط الظهور المطلوب. يبقى الاشتراك مستقلاً لاستخدام فرص المشاريع.
- يجمع الدليل بيانات المقاول الأساسية، وسائل الاتصال، رابط الموقع، التخصصات، مناطق العمل، الخدمات المعتمدة، معرض الأعمال، التقييم، عدد المشاريع، سنوات الخبرة، وحالة التوفر. أضيف البحث والفلترة حسب المنطقة وحالات التحميل والخطأ والفراغ في الويب والتطبيق.
- أضيف المسار العام `GET /api/public/contractors` مع CORS مقيد لنسخة Flutter المحلية على المنفذ `8090`. التحقق المباشر أعاد `200` وترويسة الأصل الصحيحة.
- لا توجد حاليًا سجلات مقاولين معتمدين في قاعدة الإنتاج، لذلك تظهر حالة الفراغ «لا يوجد مقاولون معتمدون حتى الآن». سيظهر أي مقاول تلقائيًا فور اعتماد طلب انضمامه من الإدارة.
- نجح بناء Next.js وTypeScript، وتحليل Flutter بلا أخطاء (خمس ملاحظات `info` سابقة فقط)، والفحص المرئي داخل التطبيق المحلي أكد فتح الدليل وظهور حالة الفراغ الصحيحة. نُشر الإصدار `dpl_ABoxUNjTrFsbDYAXRh6CEvC9MqsC` وربط بـ`https://www.buniahksa.com`، وأعيد تشغيل Flutter Web على `http://127.0.0.1:8090`.

## 2026-08-31 — Hide checkout after confirmed payment

- Fixed the Flutter customer quote-detail card that kept showing the Paymob action after a successful charge. `loadQuoteDetail` now reads the related order's `payment_status`; `paid` and `succeeded` are terminal UI states, so the approval countdown and checkout button are removed and replaced with the existing localized payment-success confirmation.
- Flutter return/resume reconciliation now updates the card's local payment state immediately, while subsequent page loads read the persisted order state. The separate workspace quote card already used the same terminal-state rule.
- Applied the same rule to the Next.js customer quote decision screen: accepted quotes show the payment link only while the related order is unpaid, and paid quotes show a success confirmation instead.
- Live read-only verification for quote `BQ-4119FDD1E8` confirmed `quote.status=accepted` and `orders.payment_status=paid`. Flutter analysis reported no errors (only five pre-existing informational lints); TypeScript, targeted ESLint, the Vercel production build, and targeted diff checks passed. Flutter Web was restarted on `http://127.0.0.1:8090`; no APK was rebuilt. Production deployment `bunya-platform-1zp3t5gs9-ahmedabumoallas-projects.vercel.app` is READY and aliased to `https://www.buniahksa.com`.

## 2026-08-31 — Paymob missed-webhook reconciliation and confirmed live payment

- The customer report was correct: Paymob Transaction Inquiry returned live transaction `9195990` for payment record `3710e760-662c-4883-8714-063e703bca2d`, amount `510` halalas (`5.10 SAR`), currency `SAR`, `success=true`, `pending=false`, approved, not refunded, and not voided. The merchant reference matched the Bunya payment UUID exactly.
- Paymob's recorded processed-callback response showed HTTP `401` from `https://www.buniahksa.com/api/payments/paymob/webhook`; this is why the platform remained pending even though the card was charged. The payment was reconciled only after independent server-to-server inquiry and strict validation of merchant reference, amount, currency, integration ID, live mode, and transaction outcome.
- The trusted event `paymob:9195990:succeeded` was applied atomically. Payment `3710e760-662c-4883-8714-063e703bca2d` is now `succeeded`, invoice `INV-394ED5BA7E` is `paid`, order `ORD-20260830-82A03FEE` has `payment_status=paid`, and fulfillment `FUL-01EA3AAE93` has `payment_released_at` set for provider `شركة بيك للتطوير العقاري`.
- Customer payment, delivery-code, provider fulfillment, and admin financial-summary notifications were processed immediately. WhatsApp submissions to the customer, the official admin mobile ending `4401`, and the provider mobile ending `3570` were all accepted on the first attempt.
- Added `paymob-reconciliation.ts` using Paymob's documented API-key auth and `/api/ecommerce/orders/transaction_inquiry` endpoint. It prevents duplicate charging by reconciling a pending payment before issuing/reusing a checkout, provides authenticated `/api/payments/paymob/reconcile` for web and Flutter return/resume flows, and reconciles pending Paymob records from the existing two-minute production cron.
- The webhook remains HMAC-first. When a syntactically valid Paymob HMAC is present but mismatches, it now uses the independent authenticated inquiry path and applies only the server-confirmed transaction; it never trusts redirect parameters or an unverified callback body. Web and Flutter request reconciliation immediately after returning from Paymob.
- ESLint, TypeScript, and the Vercel production build passed. Flutter analysis has no errors (six existing informational lints remain). Deployment `dpl_Hog7ae98Ho3optKddmYZi6tyfnfZ` is READY and aliased to `https://www.buniahksa.com`.

## 2026-08-31 — Admin quote acceptance and payment summaries

- `order_created` now notifies every active administrator through in-app notification, WhatsApp when the admin profile has a mobile number, and best-effort native push. The message includes the accepted customer quote total, exact cumulative succeeded-payment amount, remaining balance, payment state, each winning provider, and each provider's awarded value. The action opens `/admin/orders`.
- `customer.payment_succeeded` now sends administrators a second financial summary after the trusted Paymob event is processed. It recomputes the cumulative succeeded payments from `payment_records`, shows the exact paid and remaining amounts, and repeats the winning provider allocation. Customer and provider payment notifications remain intact.
- A one-off idempotent event `6d2c13b4-f757-4da4-be08-c659395f5ef3` sent the current order `ORD-20260830-82A03FEE` summary to all four active admin accounts. Recorded values were accepted quote `5.10 SAR`, paid `0.00 SAR`, remaining `5.10 SAR`, and winning provider `شركة بيك للتطوير العقاري` with an awarded value of `5.10 SAR`.
- Four in-app notifications were created. Green API accepted the WhatsApp submission to the official administration mobile ending in `4401` on the first attempt. There are currently no active admin `push_subscriptions`, so OS-level push cannot be delivered until an administrator opens a push-enabled native build and grants notification permission.
- ESLint, TypeScript, and the Vercel production build passed. Deployment `dpl_Aju1QyqbsaM7PLsN6K9PDcyjL6VK` is READY and aliased to `https://www.buniahksa.com`.

## 2026-08-31 — Provider notification when customer accepts an order

- `order_created` now also resolves every provider fulfillment attached to the accepted customer quote and creates a provider-specific notification with a direct `/merchant/orders/[fulfillmentId]` action. Delivery uses the same outbox path for in-app notification, WhatsApp, and best-effort native push. The customer notification remains unchanged.
- The provider message distinguishes customer acceptance from payment confirmation. While the payment is pending it says that Paymob confirmation is awaited; the existing `provider.fulfillment_assigned` event remains the separate payment-confirmed notification that opens fulfillment work.
- For the current order `ORD-20260830-82A03FEE`, a provider-only idempotent outbox event `7089de2d-090e-4016-851e-82750e383606` was processed successfully. The WhatsApp submission to the provider was accepted by Green API on the first attempt, and the in-app notification points directly to fulfillment `b95ae2a0-fd1e-40a6-8cc6-0e8408d86985`.
- The provider owner profile currently has no active row in `push_subscriptions`; therefore an OS-level mobile push cannot be delivered to that device until it opens a push-enabled Android/iOS build, grants notification permission, and registers its device token. The in-app notification is present now and native push will work automatically once a token is active.
- ESLint and TypeScript passed. Production deployment `dpl_9nTsSRwL7sW1NDgky6HXoRHAft3r` is READY and aliased to `https://www.buniahksa.com`.

> مرجع العمل المستمر لـCodex. يُقرأ في بداية كل مهمة ويُحدّث عند إكمال مهمة أو اكتشاف خلل أو اتخاذ قرار معماري. لا تُسجل فيه كلمات مرور أو مفاتيح أو رموز جلسات.

- **قاعدة تنفيذ ملزمة:** كل تغيير وظيفي أو تدفق أو واجهة يُنفّذ ويحافظ عليه بالتوازي في منصة الويب وتطبيق Flutter، ما لم يطلب المستخدم صراحة خلاف ذلك. الويب والتطبيق واجهتان لنفس منطق الأعمال والبيانات، مع تصميم أصيل ومناسب لكل وسيط.

- نموذج المنتج مرن ولا يفترض قياسًا أو فئة واحدة: يدعم عدة قياسات عبر `product_measurements`، وعدة خيارات/فئات مثل المقاس والضغط والكثافة والسماكة والدرجة واللون والموديل عبر `product_variants.attributes`. نموذج إضافة المنتج وعرض تفاصيله ومراجعته يجب أن يعرض هذه البيانات بصورة منظمة في الويب والتطبيق، دون بيانات خام.

- نموذج إضافة المنتج في Flutter يستخدم نافذة `showModalBottomSheet` الأصلية بارتفاع 95% و`ListView`. لا تستبدل مسار النافذة بـ`showGeneralDialog` لأنه ترك طبقة سوداء عند تعذر رسم المحتوى في Flutter Web. القياسات وخيارات المنتج (الضغط/الكثافة/السماكة وغيرها) تُضاف قيمةً قيمةً بزر إضافة وتظهر كصفوف خفيفة قابلة للحذف، ثم تُحفظ في `product_measurements` و`product_variants`. تجنب `InputChip` والقوائم الديناميكية الثقيلة داخل النافذة.
- أخطاء تحقق نموذج المنتج وأخطاء الحفظ تظهر داخل النافذة فوق زر الإرسال، لأن `SnackBar` من الـScaffold الخلفي قد يُحجب خلف الـbottom sheet ويوحي بأن الزر لا يعمل. بيانات التجهيز والتوصيل المطلوبة تبدأ بقيم افتراضية قابلة للتعديل.
- انتقال منتج المزود من `draft` أو `needs_changes` إلى `pending_review` يتم حصريًا عبر RPC آمن `submit_product_for_review` في migration `044_submit_product_for_review.sql`. الدالة تتحقق من عضوية المزود ووجود صورة، ثم تنفذ الانتقال بصلاحية definer كي يستطيع trigger إضافة `product_review_history` دون منح المزود صلاحية كتابة السجل مباشرة.

- توسع نموذج منتج Flutter ليغطي السمات الاختيارية المهنية لمواد البناء والمعدات: SKU وGTIN والمصنّع والمنشأ والمادة/الدرجة والأبعاد والوزن ووحدته واللون والتعبئة والمواصفة/شهادة المطابقة والاستخدام والسلامة والتخزين والضمان، مع بيع أو تأجير ومدة التأجير. تُحفظ الأبعاد في `product_measurements` والسمات الفنية في `product_specifications` والضمان في `product_warranties`، وتظهر جميعها في مراجعة الإدارة المنظمة.

- يتيح تطبيق Flutter للمزود إضافة منتج فعلي من شاشة المنتجات عبر نموذج مخصص للجوال يشمل الصورة والتصنيف والوحدة والوصف والسعر والمخزون والتوفر والتجهيز والتوصيل والضريبة. يُنشأ المنتج كمسودة حتى تنجح الصورة ثم ينتقل إلى `pending_review` لتعمل إشعارات الإدارة. مراجعة الإدارة في التطبيق تعرض الصورة والمزود والتسعير والمخزون والوحدات والقياسات والمواصفات والتغطية والتوصيل والضمان وسجل المراجعة وإجراءات القرار؛ واجهة الويب المتخصصة `AdminProductReview` تبقى مرجع الإدارة الكامل وليست عارض بيانات خام.

- طلبات انضمام المزودين والمقاولين المعتمدة لا تعيد طلب رقم الجوال إذا قُبل إرسال كلمة المرور المؤقتة عبر واتساب: مسار الموافقة يثبت رقم الطلب في Supabase Auth بعد نجاح الإرسال، وmigration `043_trust_delivered_onboarding_phone.sql` تعالج الحسابات المعتمدة السابقة. يبقى التحقق اليدوي للحسابات العادية أو عند فشل إرسال واتساب.

- فُصل تغيير كلمة المرور الاختياري من قسم الحساب عن إكمال كلمة المرور المؤقتة: التغيير الاختياري يحدث Supabase Auth فقط، بينما المسار الإجباري يستدعي أيضًا `complete_temporary_password_change` لإزالة علامة الإجبار.

- يفرض تطبيق Flutter شاشة إنشاء كلمة مرور جديدة على أي جلسة تحمل `must_change_password` قبل فتح لوحات العميل أو المزود أو المقاول أو الإدارة، بما يشمل الجلسات المستعادة. كما يتوفر زر «إعادة تعيين كلمة المرور» داخل قسم الحساب لجميع الأدوار.

- فُصلت طلبات انضمام المزودين عن المقاولين في تطبيق Flutter عبر بطاقتي أقسام بعدادات وأيقونات وهوية مستقلة، مع فلاتر للحالة وبطاقات طلبات تعرض التواصل والتغطية والتخصصات والتاريخ وتفتح ملف المراجعة الكامل.

- طُبقت migration `042_purge_stale_pending_join_requests.sql` لحذف جميع طلبات انضمام المزودين والمقاولين غير المحسومة وسجلاتها التابعة، مع الإبقاء حصراً على أحدث طلب مزود فعلي للبريد `ceo.branda@gmail.com` (البريد الموجود في قاعدة البيانات؛ لا يوجد طلب باسم `cto.branda@gmail.com`).

## البيئة والاتصال

- مسار المشروع: `C:\Projects\bunya-platform`
- Next.js: `16.2.9` مع Turbopack. يجب قراءة الدليل المناسب من `node_modules/next/dist/docs/` قبل تعديل كود Next.js.
- خادم التطوير الحالي يعمل غالبًا على `http://localhost:3001` لأن المنفذ `3000` مستخدم من مشروع آخر.
- مشروع Supabase المرتبط: `ccvbtduzkvuzvckfwqik`.
- Supabase CLI مرتبط ويصل إلى القاعدة البعيدة.
- تاريخ migrations البعيد كان فارغًا رغم وجود المخطط الفعلي. بتاريخ 2026-08-18 تم إصلاح التاريخ وتسجيل `001–021` كخط أساس مطبق، ثم دُفعت `022` و`023` بنجاح. لا تُعد تشغيل migrations القديمة.

## أرقام التشغيل المعتمدة

- رقم واتساب أعمال المربوط بـGreen API والخاص **بالإرسال** هو `0508333556`، وبالصيغة الدولية `+966508333556`. هذا الرقم هو مرسِل رسائل المنصة وليس رقم العميل المستلم.
- مستلم OTP هو رقم الجوال الموجود في حساب العميل الذي يريد توثيقه (`auth.users.phone`)؛ يتغير من عميل لآخر، لذلك لا يجوز تثبيته داخل الكود أو استبداله برقم المرسل.
- رقم الإدارة المعتمد هو `0508424401`، وبالصيغة الدولية `+966508424401`. لا يُستخدم كمرسل Green API ولا كوجهة OTP للعميل؛ يستخدم فقط في مسارات تنبيهات الإدارة التي تختار أرقام الإداريين.

## قواعد العمل

- لا تعرض أو تسجل بيانات دخول المستخدمين أو مفاتيح Supabase.
- حافظ على تغييرات المستخدم غير المرتبطة؛ worktree يحتوي تعديلات سابقة غير ملتزمة.
- بعد كل تغيير: شغّل TypeScript وESLint واختبار متصفح متناسب مع المهمة.
- حدّث هذا الملف بخلاصة المهمة، سبب الخلل، الملفات المهمة، وحالة التحقق.

## ما تم إنجازه

- 2026-08-25: عولج ظهور بعض صور المنتجات باللون الأسود في Flutter Web: تستخدم المعاينة الأصل المضغوط على الويب بدل الصورة المحولة العالقة، مع إصدار جديد لمفاتيح الكاش وبديل تبادلي بين الأصل والصورة المصغرة على جميع المنصات.

### اعتماد طلبات انضمام المزودين

- عولج خطأ `404` في مسار الاعتماد ثم خطأ `500` في تجهيز الحساب.
- السبب الجذري للـ`500`: اسم مستخدم مطلوب يحتوي مسافات بينما قيود قاعدة البيانات تمنعها.
- أضيف توحيد/تحقق اسم المستخدم في `src/lib/join/username.ts` وربط بمسارات الانضمام والمراجعة.
- واجهة اعتماد الإدارة تعرض التحميل والنجاح والخطأ بوضوح.
- حساب المزود المعتمد تم التحقق منه فعليًا: profile ودور provider وعضوية المالك وprovider_profile وprovider_settings كلها مرتبطة وتخضع لـRLS.

### لوحة المزود

- الرسالة العامة «لا توجد بيانات حقيقية» كانت مضللة لحساب مزود جديد بلا عمليات.
- أضيفت بطاقة حالة المنشأة وحالة «حساب المزود جاهز» في `src/components/database/RoleDatabasePortal.tsx`.
- الحساب الجديد لا يحتوي حاليًا منتجات أو طلبات تسعير أو أوامر توريد أو سائقين؛ هذا فراغ تشغيلي وليس عطل ربط.
- بطاقات المنتجات في `/merchant/products` أصبحت قابلة للفتح وتعرض نافذة قراءة كاملة من `ProviderProducts.tsx`: معرض كل صور المنتج، الحالة، السعر والمخزون والضريبة والحد الأدنى، الوصف، التوفر والتجهيز والتوصيل وتواريخ الإنشاء والتحديث. الصور الخاصة تُعرض بروابط Supabase موقعة لمدة 10 دقائق.
- المنتج بحالة `pending_review` يفتح بصورة طبيعية لكن يظهر تنبيه واضح بأنه تحت المراجعة، ولا توجد في نافذته أي حقول أو أدوات تعديل. التنسيق المتجاوب والمعرض في `ProviderProducts.module.css`.

### المنتجات والصور وإشعارات المراجعة

- كان `/merchant/products/new` مجرد route فارغ يعرض السجلات ولا يحتوي نموذج insert.
- أضيفت إدارة المنتجات ونموذج الإنشاء في `src/components/provider/ProviderProducts.tsx` وربطها في `RoleDatabasePortal.tsx`.
- أضيف Route Handler خادمي في `src/app/api/provider/products/route.ts` للتحقق من المزود، إنشاء المنتج، رفع الصور إلى `provider-product-images`، تسجيل `product_images`، وإرسال إشعار لكل مدير نشط عند `pending_review`.
- النموذج يدعم حتى 6 صور JPEG/PNG/WebP، 5MB للصورة، والصورة الأولى رئيسية. إرسال المراجعة يتطلب صورة؛ المسودة لا تتطلب.
- أضيف trigger في `022_notify_admins_product_review.sql` يرسل إشعارًا داخل التطبيق لكل مدير نشط عند دخول منتج حالة `pending_review`.
- عولج تعارض trigger مع حماية payload في `023_allow_internal_product_review_notifications.sql` عبر سياق داخلي transaction-local لا يستطيع المستخدم استدعاءه مباشرة.
- أضيف عداد الإشعارات غير المقروءة في `src/components/admin/AdminShell.tsx`.
- تم تطبيق migrations `022` و`023` على Supabase البعيد.
- اختبار التكامل الحقيقي نجح: HTTP `201`، حالة `pending_review`، صورة واحدة رئيسية، 4 مديرين نشطين و4 إشعارات بروابط مراجعة صحيحة، ولا أخطاء متصفح. حُذف المنتج المؤقت وصورته وإشعاراته بعد الاختبار، وتأكد أن عدد المنتجات والإشعارات المتبقية للاختبار صفر.

### واتساب الإدارة عند مراجعة المنتجات

- أرقام مستلمي الإدارة لا تُقرأ من `.env.local`؛ تُقرأ من `profiles.mobile` للحسابات النشطة في `admin_users`. ملف البيئة مخصص لإعدادات Green API وتشغيل الإشعارات.
- بتاريخ 2026-08-18 كان هناك 4 حسابات إدارة نشطة، وحساب واحد فقط لديه رقم جوال سعودي صالح؛ بقية حسابات الإدارة تحتاج تعبئة `profiles.mobile` إذا كان مطلوبًا أن تستقبل واتساب.
- سبب عدم وصول الرسالة كان أن حدث `admin.product_pending_review` ينشئ إشعارًا داخل التطبيق فقط ولم يكن مدرجًا في outbox/dispatcher الخاص بواتساب.
- أضيف `src/lib/notifications/product-review-dispatcher.ts` لمسار واتساب مخصص، وربط بإنشاء المنتج وبـ`/api/cron/notifications`، مع خيار تشغيلي محمي `?only=product-reviews`.
- أضيف وطبق migration `024_enqueue_product_review_whatsapp.sql`: trigger لإضافة الحدث إلى outbox، منع التكرار لكل منتج، وbackfill للمنتجات الموجودة بانتظار المراجعة.
- تحقق الإرسال الحقيقي نجح: عولج حدثان، وسُجلت رسالتان بحالة `submitted`، وعدد أحداث مراجعة المنتجات غير المعالجة أصبح صفرًا. أزيل سر الاختبار المحلي بعد التنفيذ.
- عُدلت رسالة مراجعة المنتج لتجلب تفاصيل المنتج مباشرة من القاعدة وترسل الصورة الرئيسية عبر Green API مع الاسم والمنشأة والتصنيف وSKU ونوع العرض والسعر والضريبة والوحدة والحد الأدنى والمخزون والتوفر والتجهيز والتوصيل والوصف ورابط المراجعة. إذا تجاوزت التفاصيل حد وصف الصورة (1024 حرفًا) تصل الصورة بملخص ثم رسالة نصية كاملة، وإذا تعذر إرسال الصورة لا يضيع التنبيه بل يُرسل كنص. صور WebP تُحوّل إلى JPEG قبل الإرسال.
- اختبار واتساب الحقيقي للشكل الغني نجح على منتج موجود بانتظار المراجعة: سجل الإرسال الأخير من نوع صورة وحالته `submitted` بلا خطأ، ولا توجد أحداث مراجعة منتجات غير معالجة. لم تتغير حالة المنتج وأزيل سر الاختبار المحلي بعد التنفيذ.

## ملفات محورية

- `AGENTS.md`: تعليمات Next.js وقراءة هذا المرجع.
- `src/components/provider/ProviderProducts.tsx`: قائمة المنتجات ونموذج الإضافة والصور.
- `src/app/api/provider/products/route.ts`: الحفظ الخادمي والإشعارات والتراجع الآمن.
- `src/components/database/RoleDatabasePortal.tsx`: توجيه واجهات الأدوار.
- `src/components/admin/AdminShell.tsx`: تنقل الإدارة ومؤشرات التنبيه.
- `supabase/migrations/`: المخطط وتاريخ التعديلات.

## آخر تحقق

### منع تكرار تقديم عرض المزود — 2026-08-23

- سبب ظهور نموذج التسعير بعد تقديم العرض أن صفحة التفاصيل كانت تجلب سياق الطلب فقط ولا تستعلم عن رد المنشأة الموجود؛ عند الضغط كان قيد القاعدة يرفض التكرار برسالة `Response already submitted`.
- أضيفت وطُبقت migration `039_provider_rfq_existing_response.sql` مع RPC محمية `get_my_provider_rfq_response` تعيد رد المنشأة الحالية فقط.
- صفحة `/merchant/quote-requests/[id]` تعرض بعد الرد ملخص العرض المحفوظ للقراءة فقط: السعر والكمية والتجهيز والتوصيل والضريبة والصلاحية والإجمالي، ولا تعرض نموذجًا أو زر إرسال ثانٍ.
- بطاقة الإشعار تتغير إلى «تم تقديم عرض السعر» و«عرض السعر المقدم» بدل مطالبة المزود بإدخال السعر مرة أخرى.
- التحقق: TypeScript وESLint المستهدف وSQL static وحارس migration hashes ناجحة، وطبقت migration `039` على القاعدة البعيدة.

### واجهة إشعارات واعتماد تسعير المزود — 2026-08-23

- استُبدلت واجهة `/merchant/notifications` بواجهة تشغيلية تفصيلية تعرض طلب التسعير كبطاقة منظمة: صورة المنتج، أكواد الطلب، المنتج وSKU، الكمية والوحدة والقياس، المنطقة وطريقة التسليم والموقع والخريطة، موعد الاستلام، مهلة الرد، المواصفات والملاحظات وأقل تكلفة حالية، مع زر واضح لإدخال السعر وإخفاء الروابط الطويلة من النص.
- استُبدلت واجهة `/merchant/quote-requests/[id]` بصفحة مراجعة وتسعير احترافية تعرض نفس بيانات المنتج والتسليم والصورة، وتقسم نموذج العرض إلى السعر والتوفر والتجهيز والتوصيل وصلاحية السعر. أضيفت حاسبة فورية لقيمة المنتجات والضريبة والتوصيل والإجمالي الواصل لتقليل أخطاء الإدخال.
- أضيفت وطُبقت migration `038_provider_rfq_product_media.sql`: توسع `get_provider_rfq_context` ببيانات المنتج والصورة وأكواد الطلب، وتسمح بإنشاء روابط موقعة فقط لصور المنتجات المعتمدة والمنشورة المرتبطة فعليًا بسجل `product_images`.
- التحقق: SQL static ناجح حتى 38 migration، حارس hashes ناجح، TypeScript وESLint المستهدف ناجحان، وتطابق سجل migrations المحلي والبعيد حتى `038`. لم يتوفر متصفح متصل لإجراء المعاينة البصرية داخل جلسة Codex.

### استكمال إشعارات دورة عرض السعر — 2026-08-23

- كان حدث `provider.rfq_responded` يُنشأ عند حفظ رد المزود لكنه غير موجود في قائمة أحداث عامل الإرسال، كما أن بنيته تختلف عن أحداث المزود الموجهة للمزود نفسه؛ لذلك بقيت ردود التسعير بلا تنبيه للإدارة.
- أضيف الحدث إلى `src/lib/notifications/dispatcher.ts` مع حلّ مستقل يجلب الرد والمنتج والمزود والتكلفة الواصلة والمهلة، ويرسل إشعارًا داخل المنصة لكل مدير نشط وواتساب لمن لديه رقم جوال، مع رابط `/admin/sourcing/{sourcing_request_id}`.
- عُدّل مسار إشعارات الإدارة العام بحيث يصل الإشعار الداخلي للمدير حتى إذا لم يكن لديه رقم واتساب، وكذلك إشعارات طلب التسعير للمزود لا تتوقف عن الظهور داخل المنصة عند غياب رقم الجوال.
- تم التحقق من المهل الحالية دون تعديل قاعدة البيانات: مهلة رد المزود هي الأقل بين 24 ساعة وقبل الاستلام بساعة، التذكير قبل ساعتين، صلاحية رد المزود حتى 72 ساعة، وصلاحية عرض العميل 24 ساعة مع تنبيه قبل ساعتين. Cron يعالج الجدولة كل دقيقتين.
- التحقق المركز: `npm exec eslint -- src/lib/notifications/dispatcher.ts` ناجح، و`git diff --check` بلا أخطاء محتوى.

- قبل إضافة الصور والإشعارات: TypeScript وESLint ناجحان، والدخول الفعلي أظهر قائمة المنتجات والنموذج و9 تصنيفات بلا أخطاء متصفح.
- TypeScript وESLint ناجحان بعد إضافة المنتجات والصور والإشعارات.
- اختبار متصفح Edge لمسار الإنشاء والحفظ والصورة والإشعار ناجح، مع تنظيف بيانات الاختبار.
- اختبار متصفح Edge الفعلي لتفاصيل منتجات المزود ناجح: مسار `/merchant/products`، بطاقتان قابلتان للفتح، نافذة التفاصيل ظاهرة، صورة واحدة ظاهرة للمنتج المختبر، تنبيه القراءة فقط ظاهر للمنتج تحت المراجعة، صفر حقول قابلة للتعديل وصفر أخطاء متصفح. لقطة التحقق في `test-results/provider-product-details.png`.

### تحسين إضافة المنتجات وإدارة سائقي المزود — 2026-08-21

- عُدّل نموذج `/merchant/products/new` ليدعم خيار التصنيف «أخرى» مع حقل إلزامي لاسم التصنيف المخصص. أضيف `products.custom_category`، وأصبح `category_id` اختياريًا بشرط أن يحتوي المنتج إما تصنيفًا قياسيًا أو تصنيفًا مخصصًا.
- اختيار صور المنتج أصبح تراكميًا: الضغط على اختيار الصور مرة أخرى يضيف الصور الجديدة إلى السابقة، يمنع التكرار، ويحافظ على حد 6 صور. كان سبب الخلل استبدال state الصور كاملًا في كل حدث اختيار.
- عند اختيار حالة التوفر «كمية محدودة» يظهر حقل كمية إلزامي، ويتحقق الخادم أن الكمية أكبر من صفر. أزيل حقلا «ملخص التوفر» و«طريقة التسليم» من النموذج ومن عرض التفاصيل، مع اشتقاق قيم داخلية متوافقة مع المخطط والكتالوج العام.
- استُبدلت صفحة `/merchant/drivers` العامة بواجهة إدارة فعلية تعرض السائقين وحالاتهم وتتيح الإيقاف وإعادة التفعيل، وأصبحت `/merchant/drivers/new` تنشئ Auth user وprofile ودور driver وسجل `provider_drivers` وربط `provider_driver_accounts` مع تراجع آمن عند الفشل.
- بيانات الدخول المؤقتة للسائق تُعرض مرة واحدة بعد الإنشاء ولا تُخزن في الجداول أو السجلات. تغيير كلمة المرور المؤقتة يفعّل سجل السائق تلقائيًا، كما صُحح استهداف سجل السائق في `DriverChangePassword` من عمود غير موجود إلى معرّف السائق الفعلي.
- أضيفت وطُبقت migration أمامية `025_provider_catalog_and_driver_management.sql` على مشروع Supabase المرتبط. لم تُعدّل أي migration تاريخية، وحُدث manifest hashes ليشمل migrations `011–025` الموجودة.
- التحقق: TypeScript ناجح، ESLint ناجح، production build ناجح، SQL static ناجح (25 migrations)، migration hash guard ناجح، route smoke ناجح، وRemote migration list يؤكد تطابق `001–025`. مسارات المزود المحمية تعيد توجيه غير المسجل إلى الدخول، وAPI السائقين يعيد 401 لغير المصرح. تعذر الاختبار البصري التفاعلي لأن جلسة العمل لم تجد متصفحًا متصلًا.

### توسيع مساحة عمل المزود والمالية والملف والدعم — 2026-08-21

- استبدلت صفحات `/merchant/quote-requests` و`/merchant/quotes` و`/merchant/orders` و`/merchant/finance` و`/merchant/notifications` العامة بوحدات تشغيلية حقيقية في `ProviderWorkspace.tsx`: تعرض الطلبات والاستجابات والأوامر والإشعارات والحركات المالية من Supabase، وتقدم إجراءات التسعير والتجهيز وتحديد المقروء وإضافة الحساب البنكي وطلب الصرف. حالات الفراغ أصبحت إرشادية ولا تنشئ بيانات وهمية.
- أضيف ملف منشأة شامل قابل للتعديل: الشعار، بيانات الاتصال، الوصف والموقع، السجل التجاري والرقم الضريبي، حقول العنوان الوطني، والتوصيل. أضيف رفع مستندات الإثبات الخاصة إلى bucket خاص مع RLS وحالة مراجعة.
- أضيفت واجهة سياسات مستقلة للمزود في `/merchant/policies` تعرض المنشور فقط، ومحرر إدارة فعلي في `/admin/policies` للإنشاء والتعديل والنشر.
- أصبح إنشاء تذكرة الدعم يربط `provider_id` تلقائيًا للمزود ويمر عبر `/api/support/tickets`. حدث `ticket.created` ينشئ إشعارًا داخل التطبيق لكل مدير فعال، ويرسل واتساب وبريدًا عند توفر الجوال والبريد، مع idempotency وتسجيل نتيجة المزود وإعادة المحاولة عبر outbox.
- حسابات المزود البنكية تحفظ الآيبان مشفرًا بـAES-256-GCM في الخادم، مع بصمة لمنع التكرار ولا تعيد النص الكامل للعميل. طلب الصرف لا يقبل حسابًا غير فعال أو غير معتمد ولا مبلغًا أعلى من الرصيد المتاح بعد الحجوزات.
- أضيفت وطبقت migration `026_provider_workspace_expansion.sql` على Supabase البعيد. أضيفت بعدها `027_secure_provider_settlements.sql` لإلغاء الكتابة المباشرة للمزود على اعتماد الحسابات وطلبات التسوية، وحصر طلب الصرف في RPC ذرية تستخدم advisory lock وidempotency وتتحقق من الحساب المعتمد والرصيد بعد الحجوزات. يتطابق سجل migrations الآن `001–027`. تحقق استعلام PostgREST المركب لطلبات التسعير وحقول الملف والمستندات والحسابات البنكية بنجاح.
- عولج توافق عميل Supabase الإداري مع Node 20 بإضافة transport من `ws` في `src/lib/supabase/admin.ts`؛ البيئة الحالية تستخدم Supabase JS حديثًا يتطلب WebSocket صريحًا على Node 20، مع توصية مستقبلية بالترقية إلى Node 22.
- التحقق: TypeScript وESLint وproduction build وSQL static وmigration hash guard وworkflow integration وno-operational-mocks وroute smoke كلها ناجحة حتى migration 027. تعذر الفحص البصري داخل المتصفح لعدم وجود متصفح متصل في جلسة Codex.

### تشخيص رفض تسجيل العميل — 2026-08-21

- سجل التشغيل يثبت أن `POST /api/auth/register` أعاد HTTP 400؛ طلبات `/merchant/support` الناجحة وتحذير Node 20 غير مرتبطين بالرفض.
- السبب هو عدم تطابق التحقق: `validatePassword` في `src/lib/bunya-local.ts` يسمح بكلمة مرور من 8 أحرف، بينما Route Handler في `src/app/api/auth/register/route.ts` يشترط 12 حرفًا. لذلك تمر كلمة من 8–11 حرفًا في الواجهة ثم يرفضها الخادم برسالة «بيانات التسجيل غير صالحة».
- أُصلح التعارض بتجميع السياسة في `src/lib/auth/password-policy.ts`: الحد الأدنى 8 أحرف، ويجب وجود حرف إنجليزي كبير واحد ورقم واحد على الأقل؛ لا يُشترط حرف صغير أو رمز.
- يستخدم السياسة المشتركة الآن تسجيل العميل في الواجهة والخادم، واستعادة كلمة المرور، وتغيير كلمة المرور المؤقتة، وأول دخول للسائق. يعيد خادم التسجيل رسالة شرط كلمة المرور الدقيقة بدل الرسالة العامة عند مخالفة السياسة.
- التحقق بعد الإصلاح: TypeScript وESLint على الملفات المعنية وproduction build كلها ناجحة. بقي تحذير ترقية Node 20 إلى Node 22 من Supabase أثناء البناء، وهو غير مرتبط بسياسة كلمة المرور أو رفض التسجيل.
- متابعة `409`: أثبت اختبار Auth بعيد حقيقي أن Supabase يقبل `A1234567` ثم حُذف حساب الاختبار، لذلك `409` تعارض بيانات لا سياسة كلمة مرور. وُحّد تحقق اسم المستخدم مع قيد القاعدة إلى 4–40 محرفًا، وأضيف فحص مسبق ورسائل مستقلة للبريد والجوال واسم المستخدم المسجل، مع تحويل أخطاء Auth غير المتعارضة إلى `500` وتسجيل رمز الخطأ داخليًا. نجح TypeScript وESLint واختبار تعارض بعيد بحساب مؤقت مع تنظيفه. أُلغي لاحقًا منع المسافات كما هو موضح أدناه.

### تشخيص تعذر إرسال رمز تسجيل العميل — 2026-08-21

- `POST /api/auth/register 201` يعني أن Auth user أُنشئ؛ الفشل يحدث بعد ذلك في `signInWithOtp`، والذي أعاد في اختبار الحساب الأحدث HTTP 500 ورسالة `{}`.
- لا توجد أي سجلات `auth.phone_otp` أو `auth.phone_otp_copy` في `notification_provider_submissions`، لذلك الطلب لم يصل إلى مرحلة إرسال Green API داخل Route Handler.
- إعداد التشغيل المحلي يحتوي Green API وResend، لكنه يفتقد `SUPABASE_SEND_SMS_HOOK_SECRET`، و`NEXT_PUBLIC_SITE_URL` مضبوط على `http://localhost:3001` بينما التطبيق يعمل على 3000. Supabase السحابي لا يستطيع استدعاء HTTP Hook على localhost؛ يلزم endpoint عام HTTPS مع سر مطابق في Supabase والتطبيق، أو استبدال الاعتماد على Auth Hook بمسار OTP خادمي مباشر.
- لم يُطبّق تغيير معماري لمسار OTP في هذا التشخيص.

### السماح بالمسافات في اسم مستخدم العميل — 2026-08-21

- تسجيل العميل يقبل اسم مستخدم من 4 إلى 40 حرفًا مع مسافات داخلية، مثل `محمد أحمد`، ويطبع Unicode ويزيل المسافات الطرفية ويختصر تتابع المسافات قبل الحفظ.
- أضيفت وطُبقت migration `028_allow_spaces_in_profile_usernames.sql` على Supabase البعيد لتحديث قيد `profiles_username_format` دون تعديل migration تاريخية.
- نجح TypeScript وESLint وفحص SQL وحارس hashes، كما نجح إنشاء حساب بعيد مؤقت باسم مستخدم يحتوي مسافة مع حفظه كما هو ثم حُذف الحساب التجريبي.

### تشخيص OTP على الدومين الرسمي — 2026-08-22

- النسخة المنشورة على `https://www.buniahksa.com/register` متاحة، ومسار `POST /api/auth/hooks/send-sms` منشور ويعيد `401 Invalid hook signature` للطلب غير الموقع، أي أن الملفات وRoute Handler موجودان في Vercel.
- الدومين `https://buniahksa.com` يعيد `308` إلى `https://www.buniahksa.com` حتى لطلبات POST. يجب أن يكون رابط Supabase Send SMS Hook هو الرابط النهائي `https://www.buniahksa.com/api/auth/hooks/send-sms` مباشرة؛ استخدام الرابط بلا `www` قد يمنع وصول webhook الموقع أو يفقد ترويسات التوقيع عند التحويل.
- لا توجد أي سجلات `auth.phone_otp` أو `auth.phone_otp_copy` في `notification_provider_submissions` بعد محاولة الإنتاج، ما يثبت أن الطلب لم يصل إلى مرحلة Green API في التطبيق. إعداد Auth العام يظهر `sms_provider: twilio` و`phone_autoconfirm: false`.
- الاحتمالات المحصورة في إعداد Supabase/Vercel: Send SMS Hook غير مفعّل، أو URI غير نهائي/خاطئ، أو `SUPABASE_SEND_SMS_HOOK_SECRET` غير موجود/غير مطابق في Vercel Production. رفع الملفات وحده لا ينقل أسرار البيئة ولا يضبط Auth Hooks.
- أظهرت لقطة إعداد Vercel أن قيمة `SUPABASE_SEND_SMS_HOOK_SECRET` تبدأ بـ`sk_live_`، وهي ليست قيمة سر Supabase Send SMS Hook الظاهرة بصيغة `v1,whsec_...`. هذا عدم تطابق مؤكد يجعل التحقق من توقيع الـWebhook يعيد `401` قبل استدعاء Green API. يجب نسخ سر الـHook نفسه كاملًا إلى بيئة Vercel Production ثم إعادة النشر؛ دالة التحقق تقبل `v1,whsec_...` أو `whsec_...`.
- بعد تصحيح سر الـHook، سُجلت محاولتا OTP إنتاجيتان في `notification_provider_submissions` عند `2026-08-22T09:15:05Z` و`09:17:46Z` للوجهة المقنعة `966****769`، وكلتاهما `submitted` ومعهما Green API `provider_message_id`. هذا يثبت وصول الـHook وقبول `sendMessage` للطلب، لكنه لا يثبت التسليم إلى واتساب؛ `submitted` في التطبيق تعني أن Green API أعاد `idMessage` فقط.
- فحص Green API بالإعداد المحلي أظهر instance بحالة `authorized` ورقم مرسل مقنع `966****556`، لكن سجل آخر الرسائل لم يحتو الرسالتين/الوجهة `966****769`. يلزم مقارنة `GREEN_API_URL` و`GREEN_API_ID_INSTANCE` و`GREEN_API_TOKEN_INSTANCE` في Vercel Production مع الـinstance المربوط فعليًا في لوحة Green API، ثم فحص حالة instance والطابور/سجل الرسائل هناك. قيم Vercel الحساسة لا يمكن تنزيلها نصيًا عبر CLI للتحقق منها؛ تُعاد بصيغة `[SENSITIVE]`.
- طابقت لقطة Green API لاحقًا الإعداد المحلي: `apiUrl` على مضيف `7107` وinstance `710722692511` والمرسل المقنع `966****556` بحالة `authorized`. حُدثت متغيرات `GREEN_API_URL` و`GREEN_API_MEDIA_URL` و`GREEN_API_ID_INSTANCE` و`GREEN_API_TOKEN_INSTANCE` في Vercel Production من القيم المحلية المطابقة، ثم نُشر deployment `dpl_7X9ykxxh5hQHHzRyHQAsnxyFJzxx` وأصبح `Ready` على الدومين الرسمي.
- اختبار OTP حقيقي بعد نشر إعداد Green المصحح أعاد من Supabase `422 hook_timeout`، بينما أكمل Route Handler لاحقًا وسجل WhatsApp كـ`submitted`. الفحص القسري `checkWhatsapp` من نفس instance للوجهة `966****769` أعاد `existsWhatsapp: false` و`fromCache: false`؛ لذلك الرقم المرتبط بحساب العميل غير موجود على واتساب وفق Green API، و`sendMessage` يعيد `idMessage` لكن لا تظهر رسالة في الطابور أو السجل أو المحادثات. الرقم `966****556` هو المرسل المربوط بالـinstance وليس وجهة OTP.
- فحص طابور Green API بتاريخ 2026-08-22 الساعة 13:04 بتوقيت الرياض أكد أن instance المرسل `0508333556` بحالة `authorized`: أعاد `getMessagesCount` صفرًا و`showMessagesQueue` قائمة فارغة، ولم يعرض `lastOutgoingMessages` أي رسالة إلى الوجهة المنتهية بـ`769` خلال 24 ساعة. لا توجد رسائل OTP معلقة؛ الطلبات المقبولة سابقًا لم تتحول إلى رسائل واتساب فعلية.
- فشل مسار النسخة البريدية أيضًا لكل المحاولات الأخيرة بحالة `provider_http_403` من Resend إلى البريد المقنع `s***@gmail.com`، لذلك لا توجد قناة احتياطية عاملة حاليًا. الحل التشغيلي المباشر يتطلب تصحيح رقم Auth للحساب إلى رقم يستقبل واتساب، مع معالجة `Payment is required` في حساب Green API وإعداد Resend؛ لا ينبغي تغيير رقم الحساب دون تأكيد المستخدم للرقم الصحيح.
- لم يُغيّر كود الإرسال في هذا التشخيص. ضُبط Hook secret ومتغيرات Green API وأعيد نشر Production؛ المتبقي تصحيح وجهة الجوال إلى رقم مسجل في واتساب وإصلاح Resend/الدفع، ثم معالجة مهلة Hook إذا استمرت بعد صلاحية قنوات الإرسال.

### استئناف توثيق جوال العميل من تسجيل الدخول — 2026-08-22

- سبب رسالة «لا يوجد دور نشط» للحساب الذي فشل إرسال OTP إليه هو أن `initialize_customer_account` لا ينشئ `customer_profiles` ودور `customer` إلا بعد نجاح توثيق الجوال، بينما مسار الدخول السابق كان يفحص الدور مباشرة ثم يسجل خروج المستخدم.
- بعد نجاح البريد وكلمة المرور، يفحص تسجيل الدخول الآن Auth user: إذا كان لديه `phone` و`phone_confirmed_at` فارغًا فقط، يحتفظ بالجلسة ويوجهه إلى `/verify-phone`. كما توجه صفحة `/login` الجلسة غير الموثقة الموجودة مسبقًا إلى المسار نفسه.
- صفحة `/verify-phone` لا تفتح دون جلسة، وتتيح إرسال OTP وإعادة إرساله والتحقق منه. بعد النجاح تستدعي `initialize_customer_account` ثم توجه إلى `/customer`. الحسابات الموثقة وبقية الأدوار تستمر في مسار الدخول المعتاد دون تغيير.
- تحقق بعيد بحساب مؤقت أثبت نجاح تسجيل الدخول بكلمة المرور مع وجود جوال غير موثق وصفر أدوار، ثم حُذف الحساب. TypeScript وESLint وproduction build ناجحة، والبناء يتضمن `/verify-phone` كمسار ديناميكي.
- هذا التدفق يعالج إمكانية العودة للتوثيق، لكنه لا يلغي ضرورة إصلاح إعداد Send SMS Hook/Green API في الإنتاج حتى يصل الرمز فعليًا.
- رُفع الإصلاح إلى GitHub على `main` في commit `4d8e693`، ثم نُشر يدويًا إلى Vercel Production في deployment `dpl_egj8Cceji7aoVV4k36e9bcfeDiK3` وأصبح `Ready` ومربوطًا بـ`https://www.buniahksa.com`. تحقق الدومين أعاد `200` لـ`/login` و`307` من `/verify-phone` إلى `/login` بلا جلسة مع `X-Matched-Path: /verify-phone`، ما يثبت وصول المسار الجديد إلى الدومين الرسمي.
- تحقق ما قبل النشر: ESLint وTypeScript وroute smoke وworkflow integration وproduction build كلها ناجحة. تحذير Supabase عن Node 20 ظهر محليًا فقط؛ Vercel Production يبني على Node 24.

### رقم يكتبه المستخدم ويُحفظ بعد التحقق فقط — 2026-08-22

- ألغي الاعتماد على أي رقم جوال قديم غير موثق في Auth أو `profiles.mobile` أو `providers.mobile`. العميل أو مالك المزود غير الموثق يدخل بعد البريد وكلمة المرور إلى `/verify-phone` ويجد حقل رقم فارغًا.
- صفحة التوثيق تسمح بكتابة رقم سعودي جديد، إعادة إرسال الرمز، والعودة عبر «تعديل رقم الجوال» لتصحيح الرقم. لا يُكتب الرقم في Supabase Auth أو الجداول العامة أثناء الطلب أو الإرسال؛ الحفظ يحدث فقط بعد قبول رمز صحيح.
- أضيف مسارا الخادم `/api/auth/phone-verification/request` و`/api/auth/phone-verification/complete`. الأول يفحص الرقم مباشرة من WhatsApp عبر Green API `checkWhatsapp` مع `force: true` ثم يرسل رمزًا عاجلًا؛ الثاني يتحقق من hash مؤقت محدود بعشر دقائق وخمس محاولات ثم يعتمد الرقم وينشئ حساب العميل الجديد عند الحاجة أو يعيد المزود إلى بوابته الصحيحة.
- رموز التحقق تحفظ مؤقتًا في `phone_verification_challenges` بصلاحيات service role فقط، مع hash وsalt وفترة منع إعادة الإرسال. لا يُحفظ الرمز كنص صريح ولا يُعاد إلى الواجهة.
- مسار التسجيل الجديد لا يطلب أو يخزن رقمًا قبل إنشاء الحساب؛ يسجل الدخول بالبريد وكلمة المرور ثم ينقل المستخدم إلى إدخال الرقم والتحقق منه. مسار دخول المزود يفرض التحقق أيضًا حتى لو كان Auth phone فارغًا.
- أضيفت migration `029_verified_phone_capture.sql` وطُبقت على Supabase: أنشأت تحديات التحقق والمزامنة، جعلت جوال المزود قابلًا للفراغ قبل التحقق، ومسحت تحديدًا 3 حسابات غير موثقة: عميلين بأرقام منتهية بـ`769` و`689`، ومزودًا برقم منتهٍ بـ`570`. حُذفت أرقام Auth وهوية phone الداخلية وmetadata وأرقام الملفات، مع إبقاء الحسابات وطلبات الانضمام والسجل التاريخي.
- أضيفت وطُبقت migration `030_canonical_verified_phone_format.sql` لتوحيد جوال الجداول العامة بصيغة `+9665xxxxxxxx` لأن Supabase Auth يعرض الرقم المؤكد داخليًا بلا علامة `+`. تحقق مستقل أثبت أن Auth مؤكد وأن `profiles.mobile` يُزامن بالصيغة القياسية.
- أُصلح Send SMS Hook القديم أيضًا: إرسال Green API العاجل يتجاوز الطابور والتأخير، وتسجيل الإرسال ونسخة البريد ينفذان عبر `after()` بعد استجابة الـhook لتجنب `hook_timeout`.
- تحقق الإنتاج الكامل نجح بحساب مؤقت: طلب الرمز أعاد `201`، سجل Green الحالة `sent`، التحقق أعاد `200` و`/customer`، وأنشأ دور العميل. حُذف الحساب المؤقت وتحديه وسجل اختباره بعد الفحص. فحص Green النهائي: instance `authorized`، الرقم المرسل فعّال على واتساب بنتيجة غير مخبأة، والطابور صفر.
- تحقق التنظيف النهائي: 3/3 أرقام Auth فارغة، 3/3 أرقام profiles فارغة، رقم المزود فارغ، لا توجد phone identities أو phone providers للحسابات المستهدفة، وعدد التحديات المعلقة صفر.
- فحوص TypeScript وESLint وSQL validation وmigration hashes وproduction build وroute smoke وroute audit وworkflow integration وno-operational-mocks ناجحة. فحص HTTP للدومين أعاد `200` لـ`/login` و`/register`، و`307` لـ`/verify-phone` بلا جلسة، و`401` لمساري API بلا جلسة.
- رفع الكود إلى GitHub في `66b0f32` وتوحيد الصيغة في `31c00a8`. Vercel Production الحالي `dpl_DxoZpB9eYThZbxC5C6W7dxUxiaMQ` بحالة `Ready` ومربوط بـ`https://www.buniahksa.com`.
- الملفات المحورية: `src/components/PhoneVerificationFlow.tsx`، `src/app/api/auth/phone-verification/request/route.ts`، `src/app/api/auth/phone-verification/complete/route.ts`، `src/lib/auth/phone-verification.ts`، `src/lib/notifications/providers/green-api.ts`، وmigrations `029` و`030`.

### تحويل بوابتي العميل والمقاول من عارض بيانات إلى مساحة تشغيل — 2026-08-22

- أثبت فحص RLS بحساب عميل مؤقت أن جداول العميل ومسار `get_customer_deliveries` قابلة للقراءة ولا يوجد قفل في قاعدة البيانات. السبب كان معماريًا في الواجهة: صفحات المسارات كانت تعيد `null` وتعتمد على `RoleDatabasePortal` كعارض جداول عام للقراءة فقط.
- أضيفت مساحة عميل تشغيلية تغطي اللوحة الرئيسية، طلبات المشاريع، طلبات الأسعار، العروض، الطلبات، التوصيلات، الفواتير، المقاولين المحفوظين، العناوين والملف الشخصي. تعرض الصفحات حالات فارغة مرتبطة بإجراء حقيقي بدل رسالة عامة، وتوفر روابط إنشاء الطلبات واتخاذ القرار.
- أصبحت عناوين العميل قابلة للإضافة والتعديل والحذف وتعيين الافتراضي. أضيفت وطُبقت migration `031_customer_workspace_actions.sql` بدالتي `save_customer_address` و`delete_customer_address`؛ التنفيذ ذري ومحكوم بهوية العميل، وأول عنوان يصبح افتراضيًا تلقائيًا.
- أصلح مسار الإشعارات: العميل يقرأ `customer_notifications` والمقاول يقرأ `contractor_notifications` بدل جدول `notifications` العام، مع دعم `action_url` للعميل و`link` للمقاول وتعليم الإشعار كمقروء.
- أصبح حفظ المقاول وإزالته من المحفوظات فعليًا من دليل المقاولين للحساب المسجل، وأصبحت صفحة المقاولين المحفوظين تعرض بيانات المقاول وتدير الحذف.
- أصبح الملف المهني للمقاول قابلًا للتعديل في الحقول غير الإدارية، مع إبقاء الاعتماد والاشتراك والظهور والتقييم محمية. صُححت أسماء حقول مشاريع المقاول وعروضه وتقييماته لتطابق المخطط (`project_value`, `start_at`, `amount`, `comment` وغيرها).
- المزود كان يملك بالفعل واجهات تشغيل متخصصة للمنتجات والسائقين والطلبات والتسعير والمالية والملف؛ لم يظهر قفل RLS جديد في مساراته ضمن هذا الفحص.
- تحقق حي بعيد بحساب عميل مؤقت نجح في تهيئة الحساب وحفظ أول عنوان كافتراضي وقراءته وحذفه تحت RLS، ثم حُذف المستخدم المؤقت. نجحت ESLint وTypeScript وSQL validation وworkflow integration وroute smoke وno-operational-mocks وproduction build.
- رُفع الإصلاح إلى GitHub على `main` في commit `54ed2dc`. نُشر Vercel Production في deployment `dpl_GFCK3iX8qyYzckJ6u9Hc3sLZQw6n` بحالة `Ready` وربط بـ`https://www.buniahksa.com`. فحص HTTP أعاد `307` إلى تسجيل الدخول للمسارات المحمية و`200` لدليل المقاولين العام.

### فلترة احترافية لمستخدمي الإدارة — 2026-08-22

- استُبدل عارض الجدول العام في `/admin/users` بمساحة متخصصة تعرض مؤشرات إجمالية وحسب الدور، وبحثًا موحدًا في الاسم واسم المستخدم والبريد والجوال والمعرف.
- تدعم الصفحة الفلترة حسب الدور النشط، حالة الحساب، وجود جوال موثق، وفترة التسجيل، مع الفرز بالأحدث أو الأقدم أو الاسم أو آخر تحديث، ومسح الفلاتر وترقيم الصفحات.
- تعرض النتائج الأدوار النشطة من `user_roles` مع تمييز الدور الأساسي، وتستخدم `profiles.role` كحل توافق للحسابات القديمة التي لا تملك سجل أدوار نشطًا.
- تحقق استعلام Supabase البعيد بنجاح باستخدام علاقة `user_roles_profile_id_fkey`. نجحت ESLint وTypeScript وproduction build؛ تعذر الفحص البصري لأن جلسة المتصفح المحلية غير متصلة بأداة الفحص.

### تهيئة حساب اختبار للوحة المقاول — 2026-08-22

- فُحص الحساب `c***@gmail.com` في Supabase Production: البريد مؤكد والحساب نشط، لكنه كان بلا دور نشط وبلا ملف أو طلب مقاول، ولا يملك جوالًا موثقًا.
- أضيف له دور `contractor` نشط وأساسي، وحُدث الدور المخبأ في `profiles` إلى `contractor`، وأُنشئ `contractor_profiles` و`contractor_availability` مرتبطان بالحساب.
- الملف بحالة `pending` واشتراكه غير نشط وظهوره في الدليل معطل. هذا يكفي لاجتياز `roleIsReady` والدخول إلى `/contractor` واختبار اللوحة والملف والخدمات، من دون اختلاق جوال أو تجاوز اعتماد المستندات والاشتراك.
- التحقق اللاحق أثبت وجود دور مقاول أساسي واحد وملف مقاول واحد مرتبط بالحساب. لم تُنشأ بيانات مشاريع أو عروض أو فرص وهمية.

### تحويل بقية لوحة المقاول إلى مساحة تشغيل متخصصة — 2026-08-22

- استبدلت واجهات القراءة العامة في `/contractor` و`/contractor/opportunities` و`/contractor/projects` و`/contractor/proposals` و`/contractor/project-comments` و`/contractor/reviews` و`/contractor/verification` بمساحة عمل مقاول متخصصة تقرأ السجلات الحقيقية تحت RLS، مع صفحات تفاصيل للمشاريع والعروض وحالات فراغ إرشادية بدل الجداول الفارغة.
- تعرض الرئيسية جاهزية الحساب من الملف والمستندات والخدمات ومعرض الأعمال والاعتماد والاشتراك. الفرص تشرح صراحة أن توليد المطابقات يتطلب مقاولًا معتمدًا واشتراكًا نشطًا؛ لذلك يظهر للحساب التجريبي `pending` سبب عدم وجود الفرص بدل الإيحاء بوجود عطل في البيانات.
- أصبحت المشاريع تعرض القيمة والتقدم والدفع والتواريخ، وتدعم انتقال مراحل التنفيذ عبر `transition_contractor_milestone` وإضافة تحديثات المشروع. تعرض العروض تفاصيلها ومراحلها وطلبات التعديل وأسباب الرفض، وتسمح صفحة التقييمات للمقاول بحفظ أو تحديث رده.
- أضيف رفع مستندات تحقق خاصة إلى bucket `contractor-documents` بمسار يبدأ بمعرف Auth المتوافق مع سياسات التخزين، مع PDF/صور حتى 5MB، روابط موقعة، تنظيف ملف التخزين عند فشل إدخال السجل، وحذف المستندات غير المعتمدة. لا يعتمد الرفع الحساب آليًا؛ يبقى قرار الاعتماد للإدارة.
- صححت قيمة حالة التوفر في محرر ملف المقاول من `unavailable` غير الموجودة في enum إلى `temporarily_unavailable`.
- التحقق: TypeScript وESLint للملفات المعدلة وNext.js production build ناجحة. بقي تحذير Supabase المعروف عن الترقية المستقبلية من Node 20 إلى Node 22، ولا يرتبط بالإصلاح.

### تسريع تسجيل الدخول وتصحيح رسائل المصادقة — 2026-08-22

- كان `LoginFlow` يحول كل أخطاء Supabase Auth، بما فيها انقطاع الشبكة وانتهاء المهلة وتقييد كثرة المحاولات، إلى رسالة «البريد الإلكتروني أو كلمة المرور غير صحيحة». أصبح التفريع يعتمد رمز Auth الفعلي (`invalid_credentials`, `email_not_confirmed`, `user_banned`, `over_request_rate_limit`, `request_timeout`) مع رسالة مستقلة للأعطال الشبكية.
- أصبحت قيم الدخول تُقرأ من `FormData` الفعلي مع إضافة أسماء حقول البريد وكلمة المرور، لتعمل بصورة صحيحة مع الملء التلقائي ومديري كلمات المرور. يُنظف البريد من محارف اتجاه النص الخفية ويُوحّد إلى lowercase، بينما تبقى كلمة المرور كما كتبها المستخدم بلا trim أو normalization.
- بعد نجاح كلمة المرور لم يعد العميل يشغّل `resolveAuthIdentity` كاملًا ثم `router.refresh` بعد الانتقال. يقرأ الملف والدور الأساسي بالتوازي في جولة واحدة، يقرر توثيق الجوال أو تغيير كلمة المرور، ثم يستخدم انتقالًا كاملًا واحدًا؛ وتبقى البوابة الهدف مسؤولة عن التحقق الأمني الكامل من جاهزية الدور.
- فحص حساب المقاول `c***@gmail.com` أثبت أن البريد مؤكد والحساب غير محظور وهوية email موجودة وله تسجيل دخول ناجح في اليوم نفسه. لم تُقرأ أو تُغيّر كلمة مروره.
- اختبار Auth مؤقت حُذف فورًا قاس المصادقة بنحو 0.46 ثانية وقراءة مسار البوابة الجديد بنحو 0.54 ثانية، بإجمالي يقارب ثانية واحدة قبل الانتقال. نجح TypeScript وESLint والبناء الإنتاجي. تعذر الفحص التفاعلي لأن جلسة Codex لا تحتوي متصفحًا متصلًا.

### عرض بصري موسع لمراجعة منتجات الإدارة — 2026-08-22

- استبدلت صفحة `/admin/products/review` عارض الجدول العام بوحدة `AdminProductReview` مخصصة. تعرض كل منتج في بطاقة عريضة بصورة كبيرة واسم المنشأة والتصنيف والحالة والسعر والمخزون ونوع العرض وSKU والوصف وآخر تحديث.
- أضيفت مؤشرات لحالات المراجعة، بحث موحد، وفلترة حسب حالة المراجعة والمنشأة. الحالة الافتراضية تعرض المنتجات المنتظرة للمراجعة، ويمكن الانتقال إلى جميع الحالات والتاريخ السابق.
- يفتح زر التفاصيل نافذة كبيرة متجاوبة تعرض معرض كل صور المنتج بروابط Storage موقعة لمدة عشر دقائق، ووصفه الكامل، وبيانات السعر والضريبة والحد الأدنى والمخزون، والتوفر والتجهيز والتوصيل وسجل قرارات المراجعة إن وجد. المنتجات بلا صور تعرض حالة واضحة بدل مساحة صغيرة مبهمة.
- يدعم المسار التفصيلي `/admin/products/review/[id]` الوحدة نفسها ويفتح المنتج المطلوب تلقائيًا، وبذلك تعمل روابط إشعارات مراجعة المنتجات على العرض الموسع بدل العارض العام.
- تحقق استعلام Supabase الفعلي من المنتجين الحاليين والمنشأة والصورة الخاصة الموقعة بنجاح. نجح TypeScript وESLint والبناء الإنتاجي؛ تعذر الفحص البصري التفاعلي لعدم وجود متصفح متصل بجلسة Codex.

### إجراءات مراجعة منتجات الإدارة — 2026-08-22

- أضيفت أزرار واضحة داخل بطاقة كل منتج منتظر وداخل نافذة التفاصيل: «اعتماد ونشر»، «طلب تعديلات»، و«رفض».
- القرار ليس تغيير واجهة فقط: migration `032_product_review_actions.sql` أضافت RPC ذرية `review_product` تتطلب صلاحية `reviews.manage`، وتقبل فقط المنتجات بحالة `pending_review`، وتمنع تكرار العملية بمفتاح idempotency.
- الاعتماد يغيّر الحالة إلى `approved` ويضبط `is_published=true`. طلب التعديلات والرفض يحفظان السبب ويتركان المنتج غير منشور. كل قرار يُسجل في `product_review_decisions` و`audit_logs` ويظهر لاحقًا في سجل المنتج.
- يولد القرار حدثًا موجهًا للمزوّد (`provider.product_approved` أو `provider.product_needs_changes` أو `provider.product_rejected`)؛ أضيفت معالجته في notification dispatcher لإشعار المزوّد داخل المنصة وعبر واتساب عندما تكون وجهته متاحة.
- طُبقت migration `032` على Supabase البعيد. نجحت SQL validation وmigration hashes وTypeScript وESLint وproduction build وroute audit وno-operational-mocks. لم يُتخذ قرار على أي منتج حقيقي أثناء الاختبار.

### تشخيص صور المنتجات في المتجر العام — 2026-08-22

- المنتج المنشور «تجربة المنتجات» يملك سجل صورة أساسية حقيقيًا في `product_images` بمسار `storage_path`، والملف موجود في bucket `provider-product-images` ويعيد `200 image/jpeg`؛ الرفع والتخزين سليمان.
- سبب ظهور الرسم الأزرق أن `loadPublicCatalog` يجلب من `product_images` حقول `id,product_id,label,alt_text,tone,sort_order` فقط ولا يجلب `storage_path` أو ينشئ signed URL، ثم يحول المنتج إلى `ProductImage` بلا رابط صورة.
- `ProductArtwork` في `HomeStorefrontUi` لا يرسم عنصر صورة أصلًا؛ يستخدم `tone` وطبقات CSS لتوليد الرسم التجريدي الاحتياطي. لذلك تعرض الصفحة الرسم نفسه رغم وجود الملف الحقيقي.
- أُصلح المسار لاحقًا: `loadPublicCatalog` يجلب `storage_path` و`image_url` ويرتب الصورة الأساسية أولًا، ثم ينشئ روابط موقعة جماعيًا لمدة ساعة من الخادم للصور الموجودة في bucket الخاص.
- امتد نوع `ProductImage` بحقل URL، وأصبح `ProductArtwork` يعرض ملف الصورة الحقيقي فوق الرسم الاحتياطي. يبقى الرسم الاحتياطي ظاهرًا فقط عندما لا توجد صورة أو يفشل تحميلها، وتستخدم نافذة التفاصيل `object-fit: contain` لعدم قص الصورة.
- تحقق حي على `http://localhost:3000/` أعاد HTML يحتوي `store-product-photo` ورابط Storage موقعًا، ثم أعاد رابط الصورة نفسه `200 image/jpeg` بالحجم المسجل. نجحت TypeScript وESLint والبناء الإنتاجي وroute audit وno-operational-mocks؛ تعذر التقاط فحص بصري آلي لعدم وجود متصفح متصل بجلسة Codex.

### مزامنة الوحدة الأساسية في كرت المنتج — 2026-08-22

- كان حقل الوحدة في نافذة المنتج يقرأ خياراته من `product_units` فقط، بينما الإنشاء الحديث كان يحفظ `products.base_unit` دون إنشاء سجل وحدة فرعي. لذلك كانت قيمة النموذج «حبة» بلا `<option>` مطابق ويظهر حقل الاختيار فارغًا.
- أصبح المتجر يدمج الوحدة الأساسية دائمًا مع الوحدات الإضافية ويزيل التكرار، فتظهر «حبة» كخيار صالح حتى لو كانت العلاقات الفرعية ناقصة.
- لم يعد غياب `product_measurements` يمنع إضافة المنتج إلى طلب عرض السعر؛ يظهر «بدون قياس إضافي» ويصبح القياس مطلوبًا فقط عندما توجد قياسات فعلية. كما تعرض منطقة القياسات حالة فارغة واضحة بدل مساحة بلا محتوى.
- أضيفت وطُبقت migration `033_sync_product_base_units.sql`: أنشأت وحدة أساسية لكل المنتجات الحالية التي كانت تفتقدها، وأضافت trigger يزامن `product_units` تلقائيًا عند إنشاء المنتج أو تغيير `base_unit` مستقبلًا.
- تحقق Supabase البعيد أثبت أن «تجربة المنتجات» يملك الآن وحدة `حبة` مع `is_base=true`، ولا يملك قياسات إضافية. نجحت SQL validation وmigration hashes وTypeScript وESLint والبناء الإنتاجي وroute audit وno-operational-mocks.

### إغلاق كرت المنتج بعد إضافته للطلب — 2026-08-22

- كان نجاح إضافة المنتج يحدّث طلب عرض السعر ثم يعرض الرسالة داخل نافذة المنتج نفسها، لذلك تبقى النافذة مفتوحة ويضطر المستخدم إلى إغلاقها يدويًا.
- أصبحت نافذة المنتج تُغلق فور نجاح الإضافة، ويظهر تأكيد مستقل أسفل الصفحة باسم المنتج وعدد عناصر الطلب ويختفي تلقائيًا بعد 4.5 ثوانٍ أو يدويًا.
- يبقى الكرت مفتوحًا عند أخطاء الحقول أو اكتشاف عنصر مكرر حتى يختار المستخدم. وإذا اختار زيادة كمية العنصر الموجود، تُحدّث الكمية ثم يُغلق الكرت ويظهر تأكيد مستقل كذلك.
- نجحت فحوص TypeScript وESLint والبناء الإنتاجي بعد التعديل.

### درج طلب عرض السعر والرجوع بعد تسجيل الدخول — 2026-08-22

- أصبح زر العروض في ترويسة المتجر زرًا فعليًا يفتح درجًا جانبيًا من اليسار بدل رابط `#quote`. يعرض الدرج صور المنتجات وأسماءها وكمياتها ووحداتها وقياساتها ومواعيدها وملاحظاتها وروابط مواقعها، مع تعديل الكمية وحذف المنتج.
- يحتوي الدرج بيانات الطلب المشتركة اللازمة للتنفيذ الحقيقي: المدينة، وصف الموقع، رابط Google Maps، موعد الاستلام، طريقة الاستلام، اسم المشروع، المستلم وجواله والملاحظات. تُملأ بيانات المستلم تلقائيًا من ملف العميل عندما تكون الجلسة متاحة.
- إذا ضغط الزائر «اعتماد طلب عرض السعر» بلا جلسة، تحفظ المسودة 24 ساعة في `pending_quote_drafts` خلف رمز عشوائي داخل cookie من نوع `HttpOnly/SameSite=Lax`، ثم يذهب إلى `/login?returnTo=%2F%3Fquote%3Dreview`. بعد تسجيل الدخول أو إنشاء حساب وتوثيق الجوال يرجع إلى المتجر، تُستعاد المسودة ويفتح الدرج تلقائيًا.
- تسجيل الدخول يقبل مسار الرجوع العام المحدد `/?quote=review` لحساب العميل فقط؛ بقية الأدوار والمسارات تستمر في التوجيه إلى جذر البوابة المناسب، لمنع open redirects أو توجيه الأدوار الأخرى إلى تدفق العميل.
- اعتماد العميل المسجل يمر عبر `/api/customer/quote-requests` ويتحقق خادميًا من الجلسة والمدينة والموقع وGoogle Maps والموعد والمستلم والجوال، ثم يستدعي RPC `submit_storefront_rfq` التي تعتمد على دورة `submit_customer_rfq` الذرية وتضيف رابط الخريطة إلى الطلب. تحمل المسودة مفتاح idempotency ثابتًا عبر رحلة الدخول لمنع إنشاء طلبين عند إعادة المحاولة؛ وبعد النجاح تُحذف المسودة ويُنقل العميل إلى سجل الطلب الحقيقي.
- أضيفت وطُبقت migration `034_storefront_quote_drafts.sql` على Supabase البعيد، وتطابق سجل migrations المحلي والبعيد حتى `034`. اختبار HTTP الفعلي نجح في حفظ المسودة واستعادتها وحذفها، ومسار الاعتماد أعاد `401` الصحيح بلا جلسة.
- نجحت TypeScript وESLint وSQL validation وmigration hashes وproduction build وroute smoke وroute audit وworkflow integration وno-operational-mocks. تعذر الفحص البصري فقط لعدم وجود متصفح متصل بجلسة Codex.

### إصلاح رفض اعتماد طلب المتجر — 2026-08-22

- أعاد اختبار RPC الفعلي الخطأ `Invalid quote request status transition: submitted -> verifying`. عند عدم وجود مزود مطابق، تنقل `submit_customer_rfq` الطلب مباشرة إلى التحقق، بينما حارس الحالات القديم كان يسمح بالتحقق بعد `sourcing` فقط.
- أضيفت وطُبقت migration `035_allow_direct_quote_verification.sql` للسماح بالانتقال المقصود `submitted -> verifying` مع إبقاء بقية انتقالات الحالة كما هي.
- أُعيد اختبار اعتماد طلب حقيقي مرة واحدة بحساب مؤقت فأعاد `200` ونجح الاعتماد، ثم حُذف الطلب والحساب التجريبيان. لم تُجر مجموعة اختبارات طويلة بناءً على طلب المستخدم بتقليل التجارب.

### واجهة تفاصيل طلب عرض السعر للعميل — 2026-08-22

- كان مسار `/customer/quote-requests/[id]` يسقط إلى عارض قاعدة البيانات العام داخل `RoleDatabasePortal`، ولذلك ظهرت أسماء الأعمدة الإنجليزية والمعرفات التقنية وعبارة Supabase بدل تفاصيل مفهومة للعميل.
- أضيفت واجهة مخصصة للمسار تعرض حالة الطلب وشرحها ومراحل المعالجة والمنتجات والكميات والتسليم والموقع والمتابعة، وتخفي UUIDs وحقول النظام. عند صدور العرض يظهر زر مباشر لفتحه.
- أضيف رابط «عرض تفاصيل الطلب» إلى بطاقات سجل طلبات الأسعار. التعديل واجهي فقط ولا يغير الاعتماد أو دورة البيانات.
- نجح `tsc --noEmit` وESLint المستهدف لملفي المكونات، واكتُفي بهذين الفحصين لتقليل زمن وتجارب التحقق حسب طلب المستخدم.

### تشخيص عدم إشعار مزوّد المنتج بطلب التسعير — 2026-08-22

- فُحص طلب الإنتاج `RFQ-20260822-0D509167` بلا إنشاء طلبات تجريبية. الطلب والمنتج وعنصر التوريد موجودة وحالة الطلب `verifying`، لكن `internal_sourcing_request_targets` فارغ؛ لذلك لم يُنشأ أي حدث `provider.rfq_new` ولم توجد محاولة Green API معلقة أو فاشلة.
- المزوّد مالك المنتج معتمد، والمنتج منشور ومتاح، ومنطقة الطلب «خميس مشيط» موجودة ضمن مناطق توصيل المزوّد. سبب الاستبعاد هو أن RPC `submit_customer_rfq` ما زالت تعتمد نموذج المطابقة القديم: سجل حديث في `provider_product_prices` واشتراك `subscriptions` نشط. كلاهما غير موجود لهذا المزوّد.
- تدفق إضافة المنتجات الحالي يحفظ الملكية والسعر مباشرة في `products.provider_id` و`products.unit_price`، ولا ينشئ سجل `provider_product_prices`. يوجد لذلك تعارض معماري بين نموذج إنشاء المنتج الحديث ومنطق استهداف طلبات التسعير القديم. الإصلاح المطلوب هو تحويل المطابقة إلى مالك المنتج المعتمد في `products.provider_id` (مع التحقق من النشر والتوفر والمنطقة)، ثم إنشاء الهدف وحدث الإشعار له.

### المطابقة الديناميكية لمزوّدي طلبات التسعير — 2026-08-22

- أضيفت وطُبقت migration `036_dynamic_provider_rfq_matching.sql`. أصبحت `submit_customer_rfq` تستهدف جميع المنشآت المعتمدة التي تملك منتجًا منشورًا ومتاحًا مطابقًا للمنتج المطلوب: تطابق SKU، أو الاسم والتصنيف والوحدة، مع دعم سجل `provider_product_prices` القديم. يلزم تطابق مدينة الطلب مع تغطية المنتج أو منطقة توصيل المنشأة، ويُستثنى شرط المنطقة عند اختيار الاستلام.
- لا تعتمد المطابقة الحديثة على وجود اشتراك أو سجل سعر قديم؛ يقدّم كل مزوّد سعر وحدة جديدًا وتوفر الكمية ومدة التجهيز والتوصيل وتكلفته وصلاحية العرض. بقي محرك `select_best_provider_price` الحالي مسؤولًا عن اعتماد أقل تكلفة مؤهلة واصلة تشمل الكمية والضريبة والتوصيل.
- أضيف RPC محمي `get_provider_rfq_context` لا يعمل إلا للمزوّد المستهدف، ويعرض بيانات المنتج والكمية والموقع ورابط الخريطة وطريقة وموعد التسليم وأقل سعر وحدة وأقل تكلفة واصلة مقدمة حاليًا، من دون كشف هوية المنافس. حُدثت شاشة رد المزوّد لاستخدامه وشرح قاعدة اعتماد الأقل.
- توسعت رسالة `provider.rfq_new` لتتضمن وصف الموقع ورابط Google Maps وطريقة الاستلام وموعده وقاعدة اعتماد أقل تكلفة. عالجت migration الطلبات النشطة المنشأة خلال آخر 24 ساعة؛ تحقق الإنتاج أكد أن `RFQ-20260822-0D509167` أصبح يملك هدفًا واحدًا. ولأن Cron لم يكن قد التقط الحدث بعد، أُرسل الحدث الحالي مرة واحدة عبر إعداد Green API نفسه ثم سُجل `processed` بمحاولة واحدة و`submitted` إلى الوجهة المقنعة `966****689` بلا خطأ، لمنع التكرار لاحقًا.
- أضيفت وطُبقت migration `037_wait_for_all_provider_quotes.sql` لمنع تجميع عرض العميل قبل رد جميع المزوّدين المستهدفين، ما دامت مهلة الرد لم تنتهِ. بعد اكتمال الردود أو انتهاء المهلة يبقى `select_best_provider_price` هو من يختار أقل تكلفة واصلة مؤهلة.
- نجح SQL static validation وTypeScript وESLint المستهدف وحارس migration hashes. طُبقت migrations على Supabase البعيد حتى `037` بلا إنشاء طلب تجريبي جديد.

### توحيد التصميم الاحترافي للوحة الإدارة — 2026-08-23

- أضيفت طبقة تصميم موحدة ومحصورة داخل `.admin-app` في `src/app/admin/admin-polish.css`، واستوردت بعد الأنماط القديمة من تخطيط الإدارة كي تغطي جميع مسارات `/admin` من مصدر واحد من دون تغيير منطق البيانات أو الصلاحيات.
- وحّدت الطبقة هوية اللوحة بالأخضر الداكن والنحاسي المتوافقين مع هوية بنية، وطورت القائمة الجانبية والترويسة والبحث والتنقل والعناوين ومؤشرات الأداء والبطاقات والجداول والفلاتر والنماذج والأزرار والحالات الفارغة والأخطاء والنوافذ المنبثقة.
- حسّنت وضوح البيانات بجداول ذات رؤوس ثابتة وصفوف متمايزة، مساحات وتباين أوضح، حالات تركيز مرئية، أحجام لمس مناسبة، وتجاوب كامل مع الشاشات المتوسطة والجوال، مع احترام إعداد تقليل الحركة.
- نجح ESLint المستهدف و`tsc --noEmit` وتدقيق 73 صفحة و24 معالجًا و5 بوابات أدوار، كما نجح بناء Next.js 16.2.9 الإنتاجي. بقي تحذير Supabase المعروف فقط بشأن ترقية Node 20 إلى Node 22 مستقبلًا.

### إصلاح خروج صفحات الإدارة عن مساحة العرض — 2026-08-23

- كان نمط الاستجابة العام عند العروض المتوسطة يعيد عرض القائمة المطوية إلى `238px` بسبب أولوية `!important`، بينما تبقى تسميات القائمة مخفية؛ فظهر شريط جانبي فارغ وضُغط المحتوى خارج الشاشة.
- ثُبت تطابق عرض القائمة وهامش ومساحة العمل في الحالات العادية والمطوية والمتوسطة، وتتحول القائمة إلى درج بلا هامش على مساحة العمل تحت `900px`.
- أضيفت حدود `min-width: 0` و`max-width: 100%` إلى حاويات صفحات الإدارة واللوحات والجداول، مع التفاف رؤوس الصفحات، لمنع أي جدول أو بطاقة أو بيانات طويلة من توسيع الصفحة أفقيًا.

### واجهة مخصصة لتصنيفات الإدارة — 2026-08-23

- استبدلت قائمة `/admin/catalog` الجدول العام بواجهة بطاقات متجاوبة تعرض اسم التصنيف والرابط والحالة والترتيب وتاريخ الإضافة ورابط التفاصيل، مع ملخص النشط وإجمالي التصنيفات.
- أضيفت روابط مباشرة إلى مراجعة المنتجات والأسعار والتوفر، مع إبقاء جلب البيانات والصلاحيات ومسار التفاصيل كما هي.

### تطبيقات Android وiOS وإشعارات الجوال — 2026-08-23

- اعتمدت تطبيقات الجوال غلاف Capacitor بالمعرّف `com.buniahksa.app` فوق `https://www.buniahksa.com`، وبذلك تستخدم Android وiOS نفس المنصة الحية والجلسات والتوجيه والصلاحيات والخدمات من دون نسخة منطق منفصلة قابلة للتعارض.
- أضيف مشروعا `android/` و`ios/` مع هوية بُنية، وأيقونات التطبيقات من أصول PWA الحالية، وملف احتياطي عند انقطاع الاتصال، وأوامر `mobile:sync` و`mobile:android` و`mobile:ios`.
- أضيفت طبقة `native-mobile.css` العامة لمساحات الأمان وأهداف اللمس والنماذج والبطاقات والجداول على الجوال، مع إبقاء الويب القابل للتثبيت عبر manifest وservice worker الحاليين على الرابط الرسمي نفسه.
- أضيف تسجيل Push Notification من التطبيق بعد تسجيل الدخول إلى `/api/push/subscriptions`، وmigration `040_mobile_push_subscriptions.sql` بحماية RLS، وإرسال Android عبر FCM HTTP v1 وiOS عبر APNs HTTP/2 من دورة الإشعارات الحالية.
- تفعيل الإرسال الفعلي في الإنتاج يتطلب وضع `FIREBASE_SERVICE_ACCOUNT_JSON` وملف Android `google-services.json`، ومفاتيح `APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY/APNS_BUNDLE_ID` من حسابات Firebase وApple. لا تحفظ هذه الأسرار في المستودع.
- طبقت migration `040` على Supabase البعيد ونجح بناء Next.js الإنتاجي. استخرجت نسخة Android تجريبية موقعة للتجربة إلى `public/downloads/bunya-android-debug.apk` بعد بناء Gradle ناجح؛ مشروع iOS كامل، لكن إخراج IPA وتوقيعه يتطلبان macOS/Xcode وعضوية Apple Developer.

### واجهة رئيسية تطبيقية مستقلة — 2026-08-23

- أصبحت الصفحة الرئيسية داخل تطبيق Capacitor تجربة جوال مخصصة بهوية بُنية بدل تكرار واجهة الويب: رأس مختصر، بطاقة ترحيب، اختصارات للمنتجات والمقاولين وطلب السعر، شبكة منتجات محسنة، وشريط تنقل سفلي ثابت.
- بقي تصميم الويب دون تغيير، وأضيف وضع معاينة للواجهة التطبيقية على المتصفح باستخدام `?app=1`. يعتمد التطبيق الحقيقي الوضع نفسه تلقائيًا عبر `data-native-app`.
- نجح بناء Next.js الإنتاجي الكامل بعد التعديل؛ التحذير الوحيد المعروف هو طلب Supabase ترقية Node.js من 20 إلى 22 مستقبلًا.

### تصحيح تصميم واجهة التطبيق الرئيسية — 2026-08-23

- استبدلت النسخة الأولى الثقيلة بواجهة سوق جوال فاتحة ومضغوطة: بطاقة افتتاحية واضحة، بحث مدمج، ثلاث خدمات متساوية، وعرض أفقي لأحدث المنتجات مع شبكة ثنائية للكتالوج.
- عولج تعارض ألوان الأنماط العامة الذي كان يجعل النص داكنًا فوق الخلفيات الداكنة، وأصبح شريط التنقل السفلي ثابتًا على حافة الشاشة دون تغطية المحتوى.
- بقيت التغييرات محصورة في وضع التطبيق/المعاينة `?app=1` ونجح بناء Next.js الإنتاجي الكامل.

### تطبيق Flutter المستقل — 2026-08-23

- أصبح `apps/bunya_app` هو تطبيق الجوال الأساسي: Flutter مستقل بالكامل بلا WebView، مع بقاء منصة Next.js دون حذف أو تغيير.
- التطبيق متصل مباشرة بنفس Supabase ويشمل متجر المنتجات الحي، الصور والتصنيفات، تسجيل الدخول، إنشاء طلب عرض سعر عبر `submit_customer_rfq`، متابعة الطلبات، الحساب، والإشعارات الموحدة والعامة وإشعارات العملاء والمقاولين.
- جهزت Android وiOS وFlutter Web للمعاينة، وهوية الحزمة `com.buniahksa.app` وأيقونات بُنية. نجح `flutter analyze` وبناء Android Release متعدد المعماريات، واستبدلت نسخة التنزيل السابقة بملف Flutter ARM64 بحجم يقارب 20MB.
- المعاينة المحلية تعمل على `http://127.0.0.1:8090` عبر `apps/bunya_app/tool/run.ps1`. تفعيل Push الفعلي يحتاج ملفات Firebase الرسمية؛ الكود يسجل الرمز في `push_subscriptions` عند توفرها.
- تعرض بطاقة طلب عرض السعر شاشة تفاصيل كاملة، وأصبح رابط موقع التسليم داخلها زرًا مباشرًا يفتح Google Maps خارج التطبيق على Android وiOS والويب.
- أضيف إلى Flutter مدخلان أصليان بهوية التطبيق للانضمام كمزود أو مقاول، ويرفعان الطلب إلى مسار الانضمام المركزي نفسه؛ لذلك تصل إشعارات الإدارة داخل المنصة وعبر واتساب والبريد، وتصل بيانات الدخول المؤقتة للمتقدم عبر واتساب والبريد بعد الموافقة.
- بعد أول دخول بالحساب الموافق عليه، يسجل التطبيق رمز Push للمستخدم ويجبره على شاشة تعيين كلمة مرور جديدة وفق سياسة المنصة ثم يكمل دخوله. أضيف دعم CORS المقيد بمعاينة Flutter المحلية لمسار الانضمام فقط.
- حُسّن تحميل كتالوج Flutter: تُجلب التصنيفات والمنتجات بالتوازي، وتُوقّع جميع صور التخزين في طلب واحد بدل طلب لكل منتج، مع single-flight وكاش ذاكرة لخمس دقائق وكاش صور ثابت بمفتاح مسار التخزين وتصغير فك الصورة لتقليل الذاكرة والتعليق.
- أصلح فشل نشر مسار انضمام تطبيق Flutter الناتج عن استنتاج TypeScript غير متوافق لرؤوس CORS؛ أصبحت الدالة تعيد `Record<string, string>` صريحًا، وثُبتت قاعدة تنفيذ سريعة وقليلة الفحوص في `AGENTS.md`.

### لوحات الأدوار الأصلية في Flutter — 2026-08-24

- أصبح تطبيق Flutter يكتشف دور الحساب بعد الدخول ويعرض لوحة مستقلة للمدير أو المزود أو المقاول، بينما تبقى تجربة العميل كما هي؛ جميع اللوحات أصلية بلا WebView ومتصلة مباشرة بنفس Supabase وRLS.
- لوحة الإدارة تشمل المؤشرات، طلبات انضمام المزودين والمقاولين، الاعتماد/الرفض/طلب التعديل وإنشاء الحساب وإرسال كلمة المرور عبر المنظومة الحالية، إضافة إلى صفحات المستخدمين والمزودين والمقاولين ومراجعة المنتجات والطلبات والتوريد والتوصيل والدعم والمالية وسجل التدقيق. تدعم مراجعة المنتجات الاعتماد أو الإعادة للتعديل أو الرفض.
- لوحة المزود تشمل مؤشرات المنتجات والتسعير والتوريد، استلام طلبات التسعير وتقديم السعر والكمية والتجهيز والتوصيل، المنتجات والعروض وأوامر التوريد والسائقين والمالية والدعم. تدعم أوامر التوريد بدء التجهيز وتأكيد الجاهزية عبر RPC الآمن.
- لوحة المقاول تشمل الفرص المطابقة وتقديم عرض المشروع فعليًا، العروض والمشاريع والخدمات ومعرض الأعمال والتقييمات والمستندات والمالية والإشعارات والحساب.
- أضيف توثيق Bearer آمن لتطبيق Flutter على مسارات اعتماد طلبات الانضمام مع بقاء تحقق صلاحية `reviews.manage` والخادم صاحب مفاتيح إنشاء الحساب والإشعارات. أضيفت رؤوس CORS لمسارات الاعتماد لتعمل معاينة Flutter Web دون كشف مفاتيح الخادم.
- عولج تعليق مؤشر إحصاءات لوحات الأدوار: أصبحت الاستعلامات الثلاثة متوازية، وطلب الإحصاءات ثابتًا لكل شاشة بدل إنشائه مع كل إعادة بناء، مع مهلة 5 ثوانٍ وعرض بديل عند تعذر أحد المؤشرات.
- تعرض صفحة منتجات المزود والإدارة في Flutter بطاقات مرئية تشمل الصورة الأساسية الموقعة من التخزين، اسم المنتج ووصفه ووحدته وحالة المراجعة؛ تُوقّع صور الصفحة دفعة واحدة وتستخدم كاش الصور لتسريع العودة إليها.
- استبدلت تفاصيل المنتج الخام في Flutter بشاشة تطبيق مخصصة لهوية بُنية: صورة كبيرة، اسم ووصف، حالة، تصنيف، وحدة، توفر وتوصيل، بلا UUID أو حقول قاعدة بيانات؛ وتظهر قرارات مراجعة الإدارة داخل قسم واضح واحد عند الحاجة.
- أصبحت إشعارات Flutter تحتفظ بمسار الإجراء ونوع الكيان ومعرّفه؛ ضغط إشعار طلب التسعير يفتح شاشة التسعير الأصلية مباشرة داخل التطبيق، وبقية الإشعارات تفتح شاشة تفاصيل تطبيقية بدل الاكتفاء بتعليمها كمقروء.
- شاشة طلب تسعير المزود تستدعي سياق الطلب وعرض المنشأة الحالي بالتوازي؛ إذا سبق تقديم العرض تصبح الشاشة للقراءة فقط وتعرض السعر والكمية والتجهيز والتوصيل والضريبة والإجمالي، ولا يظهر نموذج إرسال عرض ثانٍ.
- ألغيت واجهة السجل الخام العامة من تطبيق Flutter لكل لوحات الإدارة والمزود والمقاول: القوائم تختار عنوانًا مفهومًا بدل UUID، والتفاصيل تعرض فقط حقولًا تجارية مترجمة ومنسقة ضمن بطاقات بهوية بُنية، وتخفي المفاتيح والمعرفات وJSON والحقول الداخلية. تظهر روابط المواقع كزر خرائط، وسجل التدقيق كإجراءات وأقسام مفهومة، وإجراءات التشغيل مرة واحدة في قسم مستقل.
- تنظف واجهة إشعارات التطبيق النص من UUID والروابط التقنية، مع بقاء التوجيه الداخلي الفعلي محفوظًا عند الضغط على الإشعار. واجهات العميل المتخصصة بقيت كما هي لأنها لا تستخدم عارض السجلات العام.
- أصبحت تفاصيل طلبات العملاء في لوحة الإدارة شاشة متخصصة تعرض المستلم والتسليم والموقع والمهلة والمنتجات والكميات والملاحظات وملخص عرض بُنية المالي وحالته بدل التفاصيل العامة.
- أصبحت شاشة مراجعة طلب الانضمام في Flutter تعرض كامل بيانات المزود أو المقاول: بيانات التواصل والمسؤول واسم المستخدم والتوصيل، التصنيفات أو التخصصات، مناطق التغطية، الخريطة، أسماء المستندات، سجل المراجعات وحالة إنشاء الحساب وتسليم بيانات الدخول؛ وتظهر إجراءات القرار فقط للطلبات القابلة للمراجعة.
- طُبقت migration `041_purge_selected_test_accounts.sql` على Supabase لحذف حسابات التجربة الخمسة المحددة وما يرتبط بها من طلبات ومنتجات وتسعير وتوريد وتوصيل ومالية وإشعارات وطلبات انضمام، مع تجاوز الحسابات التي كانت محذوفة أصلًا.
- صور منتجات Flutter تُعرض الآن كنسخ مصغرة 640px من Supabase مع كاش للرابط الموقّع وذاكرة وقرص، وتوقيع متوازٍ محدود، وتُصغّر الصور الجديدة قبل الرفع إلى 1280px بجودة 72% لتقليل زمن النقل والرسم.
- توحّد مسار صور المنتجات في جميع واجهات Flutter والويب: قوائم ومراجعة الإدارة، منتجات المزود، الكتالوج العام، تفاصيل المنتج، إشعارات وطلبات التسعير تستخدم نسخ Supabase مصغرة موقعة لمدة 6 ساعات وكاش موحد؛ Flutter يرجع تلقائيًا للرابط الأصلي إذا تعذر التحويل بدل المساحة السوداء. نجح Flutter analyze وESLint وفحص TypeScript دون أخطاء.
- يعتمد تطبيق Flutter قناة تحديث بيانات موحدة `AppDataRefresh`: نجاح إنشاء أو اعتماد منتج، قرار انضمام، تسعير، عرض مقاول، انتقال توريد، طلب عميل، تغيير كلمة مرور أو تسجيل خروج يبطل الكاش ويعيد تحميل القوائم والعدادات والإشعارات المفتوحة تلقائيًا دون الخروج من الصفحة. مراجعة المنتجات في الويب تحدّث الحالة والنشر تفاؤليًا فور نجاح القرار ثم تعيد الجلب وتنفذ `router.refresh()` للمزامنة.

### تفاصيل المنتج الشاملة في الكتالوج — 2026-08-25

- توسع نموذج الكتالوج العام في منصة Next.js وتطبيق Flutter ليحمل رمز المنتج، نوع العرض، الضريبة، الحد الأدنى، المخزون، مدة التأجير، جميع الصور، الوحدات والقياسات، الخيارات، المواصفات، التوفر والتغطية، التوصيل والضمان دون عرض JSON أو معرفات داخلية.
- طُورت بطاقات قوائم المنتجات لتعرض ملخصًا سريعًا للتصنيف والتوفر والوصف والوحدة والتوصيل، بينما أصبحت نافذة التفاصيل سطحًا منظمًا قابلًا للمسح البصري مع معرض صور وأقسام واضحة وزر طلب سعر ثابت أسفل شاشة Flutter.
- بقي السعر العام خاضعًا لمسار طلب عرض السعر ومقارنة المزودين، فلا يُعرض سعر مزود خام في الكتالوج؛ تعرض الواجهة بدلًا منه توضيحًا بأن السعر النهائي يعتمد على التكلفة والتوصيل.
- جداول `product_delivery_configs` و`product_delivery_regions` لا تُقرأ مباشرة من الواجهة العامة لأن سياسات RLS الحالية تستدعي `is_provider_member` غير المتاحة لدور `anon`. استُخدمت حقول التوصيل العامة ومناطق توفر المنتج بدل توسيع الصلاحيات، وبذلك ظل الكتالوج العام يعمل بأمان.
- نجح `tsc --noEmit` وESLint المستهدف و`dart analyze` لملفات الكتالوج الجديدة وبناء Flutter Web، كما نجح استعلام الكتالوج العام الفعلي واستجابة الصفحة الرئيسية دون حالة خطأ.

### إنشاء حساب العميل واستعادة كلمة المرور في Flutter — 2026-08-26

- أصبحت شاشة تسجيل الدخول في تطبيق Flutter تعرض إجراءين واضحين: «نسيت كلمة المرور؟» و«إنشاء حساب عميل»، مع شاشتي تسجيل واستعادة أصليتين ومتجاوبتين تدعمان RTL والإكمال التلقائي وحالات الانتظار والخطأ والنجاح.
- يستخدم إنشاء الحساب مسار المنصة المركزي `/api/auth/register` ثم يسجل دخول العميل ويستدعي `initialize_customer_account` لتهيئة ملف العميل ودوره. تُحوّل المسافات في اسم المستخدم إلى `_`، وأُصلح التطبيع نفسه في نموذج تسجيل الويب.
- يسمح مسار التسجيل بطلبات CORS القادمة من معاينة Flutter Web المحلية على `127.0.0.1` و`localhost` فقط، مع بقاء حماية المصدر لبقية الطلبات. نجح اختبار preflight للمصدر المحلي بالحالة `204` ورُفض مصدر خارجي بالحالة `403`.
- يقبل `apps/bunya_app/tool/run.ps1` الآن معامل `-AppUrl` اختياريًا لتوجيه معاينة Flutter إلى خادم Next المحلي قبل نشر تغييرات المنصة، مع بقاء عنوان الإنتاج هو القيمة الافتراضية.
- ترسل استعادة كلمة المرور رسالة Supabase إلى البريد وتوجّه الرابط إلى مسار الويب الحالي `/auth/callback?next=/reset-password`، مع رسالة نجاح عامة لا تكشف إن كان البريد مسجلًا.
- نجح `dart analyze` للملفات الجديدة، و`flutter analyze --no-fatal-infos` دون أخطاء جديدة، و`tsc --noEmit` وESLint المستهدف، وبناء Flutter Web الكامل. لم يُنشأ حساب تجريبي حتى لا تُضاف بيانات حقيقية إلى المنصة.

### إلزام رقم الجوال وتوثيقه عند إنشاء حساب العميل — 2026-08-26

- أصبح رقم الجوال السعودي حقلًا إلزاميًا داخل نموذج إنشاء حساب العميل في منصة Next.js وتطبيق Flutter، مع شرح أنه قناة رمز التحقق والعروض والإشعارات والتواصل. يقبل التطبيع صيغ `05xxxxxxxx` و`5xxxxxxxx` و`+9665xxxxxxxx` ويحفظ الصيغة الموحدة فقط بعد التحقق.
- يتحقق مسار `/api/auth/register` من صحة الجوال ومن عدم ارتباطه بملف موثّق قبل إنشاء الحساب، لكنه لا يحفظه في `profiles.mobile` أو Supabase Auth كرقم موثّق قبل نجاح الرمز.
- بعد إنشاء الحساب وتسجيل الدخول، ينتقل الويب وFlutter مباشرة إلى مرحلة التحقق ويرسلان رمزًا من 6 أرقام عبر مسار واتساب الحالي. عند نجاح الرمز يعتمد الخادم الهاتف في Supabase Auth، ويزامنه مع الملف الشخصي، ثم ينفذ `initialize_customer_account` لإنشاء دور وملف العميل.
- أضيفت شاشة تحقق أصلية في Flutter تدعم الإرسال التلقائي بعد التسجيل، إعادة الإرسال، تعديل الرقم، الإكمال التلقائي للرمز، حالات الانتظار والخطأ والنجاح، وتسجيل الخروج. يمنع التطبيق الحسابات الجديدة أو حسابات العميل/المزود غير الموثقة من تجاوز هذه الشاشة عند الدخول أو إعادة فتح التطبيق.
- تدعم مسارات طلب رمز الجوال وإكماله جلسات Cookie للويب وBearer لتطبيق Flutter، مع CORS مقيد بمعاينات `localhost` و`127.0.0.1` ورأس `Authorization`. نجحت اختبارات preflight، ورفض التسجيل الآمن بلا جوال بالحالة `400`، ونجح `tsc --noEmit` وESLint وFlutter analyze وبناء Flutter Web دون أخطاء جديدة.

### إصلاح التعارض الكاذب لرقم جوال العميل — 2026-08-26

- ظهر «رقم الجوال مرتبط بحساب موثّق آخر» للرقم `+966505120689` رغم عدم وجوده في Supabase Auth؛ كشف الفحص أنه كان منسوخًا قديمًا إلى `profiles.mobile` لحساب مقاول غير موثّق، بينما لا يوجد له `phone_confirmed_at` أو تحدي تحقق معلّق.
- أضيفت وطُبقت migration `045_profiles_mobile_verified_only.sql` على Supabase البعيد. أصبح `profiles.mobile` قناة الجوال الموثقة فقط لكل الأدوار، وتوقف `handle_new_auth_user` عن نسخ رقم طلب/بيانات المقاول غير الموثق إلى ملف المستخدم.
- نظفت migration قيم `profiles.mobile` التي لا يقابلها رقم Auth موثّق، مع إبقاء أرقام التواصل الأصلية للمقاولين في `contractor_profiles.phone`. بعد التطبيق أصبح حجز الرقم المذكور في `profiles` صفرًا، وبقي سجل تواصل المقاول محفوظًا، ولا توجد له محاولة تحقق أو Auth phone.
- حُدث manifest بصمات migrations ليشمل الترحيلات `041` حتى `045`. نجح SQL static validation لحزمة 45 migration وحارس البصمات، وتطابق سجل Supabase المحلي والبعيد حتى `045`.

### إصلاح خطأ Future داخل setState بعد توثيق الجوال — 2026-08-26

- كان توثيق الرمز ينجح على الخادم، ثم يستدعي Flutter تحديث `roleProfile` بصيغة assignment expression تعيد `Future` من داخل callback الخاص بـ`setState`؛ لذلك عرض التطبيق رسالة Flutter التقنية رغم نجاح اعتماد الرقم.
- أصبحت استدعاءات تحديث `catalog` و`roleProfile` داخل `_BunyaShellState` تستخدم callbacks متزامنة ذات جسم صريح، وتُنشأ الـFuture خارج قيمة الإرجاع الخاصة بـ`setState`. يمنع ذلك الخطأ بعد توثيق الجوال وعند تحديث الكتالوج أو الملف الشخصي أو إكمال تغيير كلمة المرور.
- أكد الفحص البعيد بعد ظهور الخطأ أن الرقم أصبح موثقًا فعليًا في Supabase Auth، وأن `profiles.mobile` مرتبط بدور `customer` ولا يوجد تحدي تحقق معلّق؛ لذلك يكفي إعادة تشغيل Flutter للانتقال إلى الحساب ولا يلزم إرسال رمز جديد.

### حماية بيانات التسليم قبل اعتماد عرض السعر — 2026-08-26

- أزيل حقل «مدينة التسليم» من مسار إنشاء طلب السعر في الويب وFlutter. أصبح رابط Google Maps الصريح هو المرجع الأساسي لموقع التسليم، مع وصف المكان والبوابة وتعليمات الوصول بدل الاعتماد على اسم مدينة عام.
- أصبح العميل يجمع كامل المنتجات أولًا في طلب واحد، ثم يراجع الطلب ويدخل بيانات التسليم مرة واحدة: اسم وجوال المستلم، اسم وجوال مسؤول الموقع، اسم وجوال المقاول اختياريًا، مواعيد العمل، مسؤولية التحميل، خيار التنزيل، سهولة الطريق، وتعليمات الوصول.
- أضيف إقراران إلزاميان قبل الاعتماد: تحمل العميل تكلفة/مسؤولية تعذر الاستلام إذا وصل السائق وفق الموعد والبيانات ثم غادر، والإقرار بصحة جميع بيانات الموقع والتواصل والعمل والتحميل والتنزيل والوصول.
- أضيفت migration `046_quote_delivery_handover_protection.sql` وطُبقت على Supabase البعيد. تحفظ الحقول الجديدة في `quote_requests`، وتتحقق دالة `submit_storefront_rfq` منها، ويمنع trigger على `orders` قبول عرض وإنشاء طلب نهائي إذا كانت بيانات التسليم أو الإقرارات ناقصة.
- يعرض ملف طلب العميل وواجهة اعتماد العرض وطلب التسعير المرسل للمزود البيانات الجديدة ورابط Google Maps. توسع إشعار المزود ليحمل ملخص المستلم ومسؤول الموقع ومواعيد العمل والتحميل والتنزيل والوصول.
- نجح TypeScript وESLint المستهدف وDart analyze دون أخطاء، ونجح SQL static validation وحارس بصمات 46 migration، وتطابق سجل Supabase المحلي والبعيد حتى `046`. تعذر الفحص المرئي الآلي لأن جلسة المتصفح لم تكن متاحة في البيئة الحالية.

### تشخيص عدم إشعار المزودين لطلب RFQ-20260825-E586C621 — 2026-08-26

- الطلب محفوظ بالحالة `verifying`، ومصدره الداخلي بالحالة `verifying_availability`، ولا توجد له أي سجلات في `internal_sourcing_request_targets`؛ لذلك لم يُنشأ أي حدث `provider.rfq_new` ولم يكن هناك إشعار مزود يمكن إرساله.
- المنتج المطلوب مرتبط فعلًا بمزود معتمد ومنتج منشور ومعتمد ومتاح. سبب الاستبعاد هو أن migration `046` مررت القيمة الداخلية «موقع التسليم عبر Google Maps» إلى معامل المدينة في `match_rfq_providers`، بينما الدالة تشترط تطابقًا نصيًا مع منطقة توصيل المزود.
- يوجد عيب بيانات/مطابقة إضافي: مناطق المزود في الطلب محل الفحص محفوظة كسجل واحد متعدد الأسطر (`ابها` و`خميس مشيط` و`جازان`)، بينما المطابقة الحالية تستخدم مساواة نصية كاملة ولا تفكك السجل إلى مناطق منفصلة.
- سجل Outbox للطلب يحتوي فقط `admin.rfq_no_providers` بالحالة `pending` ولا يحتوي أحداث استهداف مزودين. يلزم فصل تحديد النطاق الجغرافي عن رابط الخرائط، وتطبيع مناطق المزود، ثم إعادة مطابقة الطلبات العالقة وإصدار أحداث الاستهداف بصورة idempotent.

### إصلاح استهداف مزودي المنتجات ومراجعة موقع التسليم — 2026-08-26

- أضيفت وطُبقت migration `047_product_first_rfq_targeting.sql` على Supabase البعيد. أصبحت مطابقة طلبات التسعير تعتمد على أهلية المزود وتوفيره لنفس المنتج، ولا تستبعده بسبب مقارنة اسم منطقة نصي مع رابط Google Maps؛ يقرر المزود قابلية التوصيل بعد مراجعة الموقع الدقيق وتعليمات الوصول.
- أصبح إقرار المزود بمراجعة رابط Google Maps وإمكانية التوصيل إلزاميًا في منصة Next.js وتطبيق Flutter، وتتحقق منه دالة `submit_provider_pricing_response` على الخادم لمنع تجاوز الشرط من أي عميل. تعرض الواجهتان تنبيهًا واضحًا قبل السعر والتوفر، وأضاف إشعار واتساب/Push النص نفسه.
- ينشئ استهداف `provider.rfq_new` إشعارًا داخل حساب المزود في المعاملة نفسها، مع بقاء حدث Outbox لإرسال Push وواتساب بصورة قابلة لإعادة المحاولة ومن دون تكرار إشعار الواجهة بفضل `event_key` الموحد.
- أصلحت migration الطلب `RFQ-20260825-E586C621`: أصبحت حالته `sourcing` والمصدر `comparing_prices`، وأُنشئ هدف للمزود «تجربة المزود» بمهلة جديدة، وأُنشئ إشعار داخل حسابه يفتح شاشة التسعير مباشرة، وحُيّد تنبيه `admin.rfq_no_providers` القديم. لم يكن لحساب المزود اشتراك Push نشط، فأُرسلت رسالة واتساب الخاصة بالطلب مباشرةً عبر Green API بنفس مفتاح منع التكرار وسُجل حدث `provider.rfq_new` بالحالة `processed`.
- نجح `tsc --noEmit` وESLint المستهدف وSQL static validation وحارس بصمات 47 migration، وتطابق سجل migrations المحلي والبعيد حتى `047`. نجح Flutter analyze دون أخطاء، مع بقاء سبع ملاحظات أسلوبية معروفة من نوع `curly_braces_in_flow_control_structures`.

### تسعير كل منتج ونافذة المنافسة وصلاحية العرض — 2026-08-26

- أضيفت وطُبقت migrations `048_riyadh_pricing_windows_and_quote_validity.sql` و`049_provider_price_covers_customer_quote.sql` على Supabase البعيد. يحتسب `rfq_pricing_window` جميع المواعيد بتوقيت `Asia/Riyadh`: الطلب بين 8 ص و4 م يبدأ فورًا ويغلق بعد 3 ساعات بحد أقصى 7 م، وخارج الفترة يُتاح من 6 ص ويبدأ عداده 8 ص ويغلق 11 ص. يمنع الخادم إرسال سعر قبل الفتح أو بعد الإغلاق.
- بقي الاستهداف على مستوى منتج الطلب، لذلك يستطيع المزود تسعير الخشب وحده حتى لو احتوى طلب العميل على الحديد والفلين. أضيف RPC آمن `get_my_provider_rfq_list` يعيد للمزود منتجاته المستهدفة فقط، وصورة كل منتج، والكمية، والنافذة، ورد المنشأة، وأقل سعر وحدة/تكلفة واصلة من مزود آخر مع استبعاد سعر المنشأة الحالية.
- تعرض منصة Next.js وتطبيق Flutter صور المنتجات في قائمة طلبات المزود، وتوضح أن كل بطاقة منتج مستقل، وتعرض أقل سعر منافس وعدادًا حيًا لحالة الفتح/المعاينة/التسعير/الإغلاق. شاشة التفاصيل تحدّث أقل سعر كل 30 ثانية، وتخفي نموذج الإرسال خارج النافذة، وتلزم المزود بمراجعة Google Maps قبل اعتماد السعر والتوفر.
- توضح واجهات إنشاء الطلب ومتابعته للعميل سياسة الساعات، وتعرض صلاحية عرض بُنية لمدة 48 ساعة بعد إصداره بعداد حي في الويب وFlutter. يمنع الخادم قبول العرض بعد انتهاء `valid_until`، وتعالج المهمة التشغيلية الحالية حالته إلى `expired`. يضمن trigger الجديد أن صلاحية سعر المزود تغطي نافذة قرار العميل كاملة.
- توسعت رسالة إشعار المزود لتؤكد أن التسعير خاص بالمنتج المطابق فقط، وتعرض فتح النافذة وبدء العداد وآخر موعد، مع تنبيه صريح لمراجعة موقع التسليم ومسار الوصول والتنزيل قبل التسعير.
- نجح SQL static validation وحارس بصمات 49 migration، وتطابق سجل Supabase المحلي والبعيد حتى `049`. نجح `tsc --noEmit` وESLint المستهدف وبناء Flutter Web Release. لم توجد ملفات Flutter test بالمشروع، ونجح التحليل دون أخطاء مع بقاء ملاحظات info قديمة. تعذرت المراجعة المرئية الآلية لأن قائمة المتصفحات المتصلة كانت فارغة.
- فُتح طلب الاختبار `RFQ-20260825-E586C621` / `SRC-7711C88CDE` يدويًا للمزود لمدة ثلاث ساعات استثنائية من 02:42 إلى 05:42 صباحًا بتوقيت الرياض يوم 2026-08-26 لاختبار الرحلة بعد التسعير. لا توجد له استجابة سعر حتى لحظة الفتح، وتطابقت مواعيد الطلب والمصدر وهدف المزود بعد التحديث.

### مناقصة المزود واعتماد رحلة الطلب التجريبية — 2026-08-26

- ثبت الفحص أن عرض المزود كان محفوظًا أصلًا بالرمز `RSP-5104786CF6` وسعر وحدة `2.70` ر.س شامل الضريبة؛ كان الالتباس من بطاقة المزود التي عرضت حالة المنافس فقط. أصبحت بطاقات الويب وFlutter تعرض «تم حفظ عرضك» وسعر المزود المحفوظ صراحةً.
- أضيفت وطُبقت migration `050_provider_tender_repricing.sql`: عرض المزود يقفل بعد الإرسال، ولا يُتاح تغييره إلا إذا وصل عرض مؤهل أقل أثناء نافذة المنافسة. عندها يصل إشعار داخل المنصة وعبر Outbox يوضح السعر المنافس، ويستطيع المزود اختيار تخفيض إجمالي عرضه؛ تحفظ جميع التخفيضات في سجل revisions ولا يقبل الخادم تخفيضًا لا يقلل التكلفة الواصلة السابقة.
- أضيفت وطُبقت migration `052_lock_provider_pricing_after_quote.sql` لمنع أي سعر أو تخفيض جديد بعد تجميع عرض العميل أو إغلاق مرحلة المنافسة، حتى في حالات السباق بين استجابة المزود وتجميع العرض.
- توسع إشعار عرض العميل ليشمل البنود والكميات وسعر الوحدة وإجمالي كل بند، الإجماليات، Google Maps، المستلم ومسؤول الموقع، مواعيد العمل، التحميل والتنزيل والطريق وتعليمات الوصول، وموعد التسليم وانتهاء صلاحية 48 ساعة.
- أثناء اعتماد الطلب ظهر خلل في إنشاء بنود الفاتورة عندما يكون سعر المزود شامل الضريبة. أضيفت وطُبقت migration `051_invoice_items_vat_inclusive.sql` لحفظ دلالة شمول الضريبة في بند الفاتورة ومنع احتسابها مرتين، ثم نجح الاعتماد.
- للطلب التجريبي المحدد فقط أُنشئ عرض العميل `BQ-08207C57C1` واعتمد إلى الطلب `ORD-20260826-F3BEBF7D` بإجمالي `270` ر.س. سُجل السداد التجريبي بالحالة `succeeded`، وأصبحت الفاتورة `paid`، وأُسند أمر التجهيز `FUL-544693181C` للمزود مع تحريره بعد الدفع.
- أرسلت Green API بنجاح أربعة إشعارات قابلة للتتبع: عرض السعر الكامل للعميل، نجاح السداد للعميل، إسناد التجهيز للمزود، ورمز تأكيد الاستلام للعميل. لا يحفظ النظام الرمز الصريح؛ حُفظ salt وSHA-256 فقط، والرمز صالح حتى 2026-09-02 ولم يُستخدم بعد.
- تحقق القفل فعليًا بمحاولة تعديل السعر المحدد بعد تجميع العرض؛ رفضته قاعدة البيانات برسالة أن التسعير مغلق، وبقي السعر `2.70` وحالة الاستجابة `selected`. نجح TypeScript وESLint وSQL static validation وحارس بصمات 52 migration، وأصبح `flutter analyze lib/src/workspace.dart` بلا أي ملاحظات.

### تأكيد رمز التسليم والإغلاق الذرّي للطلب — 2026-08-26

- أضيفت وطُبقت migrations `053_add_customer_delivery_confirmation_method.sql` و`054_atomic_delivery_completion.sql`. يستطيع العميل مالك الطلب أو السائق المعيّن النشط أو عضو المزود إدخال رمز التسليم، مع قفل صفوف التوصيل والرمز أثناء التحقق، وتسجيل المحاولات، وإرجاع نجاح آمن عند تكرار نفس التأكيد المكتمل.
- أصبح نجاح الرمز يغلق السلسلة كاملة داخل معاملة واحدة: `provider_delivery_assignments=delivered` ثم `internal_fulfillment_orders=delivered` ثم `orders=delivered→completed` مع `completed_at` وسجلات الحالة وسجل مؤكد واحد وحدث Outbox واحد. أي خطأ يعيد المعاملة كاملة ويمنع الإغلاق الجزئي.
- ظهر في أول اختبار حي أن `outbox_events` يستخدم فهرسًا فريدًا جزئيًا لا يطابق صيغة `ON CONFLICT` الجديدة، فتراجعت معاملة التوصيل ولم تتغير حالتها. أضيفت وطُبقت migration `055_outbox_idempotency_constraint.sql` التي تستبدله بقيد فريد كامل مع السماح بقيم `NULL` المتعددة، ثم نجحت الرحلة.
- توسع `get_customer_deliveries` ليعيد حالة صلاحية الرمز والمحاولات والتأكيد وحالة الطلب ورابط Google Maps. أضيف `get_my_driver_deliveries` ليعرض للسائق المعيّن فقط بيانات المستلم ومسؤول الموقع والعمل والتحميل والتنزيل والوصول والخريطة.
- في منصة Next.js وتطبيق Flutter أصبح للعميل مدخل رمز واضح بعد وصول السائق مع تحذير بعدم التأكيد قبل الاستلام الكامل، وحالة نجاح تثبت إغلاق الطلب. أصبحت لوحة السائق في Flutter فعالة، وتعرض انتقالات الرحلة والبيانات التشغيلية ومدخل الرمز، كما تعرضها لوحة السائق في الويب.
- يستطيع المزود إنشاء حساب السائق من الويب أو Flutter. ينشأ حساب Supabase Auth برقم الجوال الموحّد والمؤكد إضافة إلى البريد، وتقبل شاشة الدخول الموحدة في الويب وFlutter البريد أو رقم الجوال. تظهر كلمة المرور المؤقتة مرة واحدة ويظل تغييرها إلزاميًا.
- أصبح إشعار `delivery_confirmed` يوجه نجاح الإغلاق للعميل والمزود والسائق المعيّن، مع مفاتيح منع تكرار مستقلة لكل مستلم وواتساب وPush/In-app وفق القنوات المتاحة.
- أُكملت رحلة الطلب التجريبي `ORD-20260826-F3BEBF7D` فعليًا: التوصيل `delivered`، أمر التوريد `delivered`، الطلب `completed` مع `completed_at`، وسجل التأكيد محفوظ بدور `customer`. أُرسلت رسالة الرمز ورسالتا نجاح الإغلاق للعميل والمزود عبر Green API، وحُفظ إشعاراهما داخل المنصة، وعولج حدث Outbox. لم يكن للتوصيل سائق معيّن وقت الاختبار، لذلك تم تحريك الرحلة بصلاحية المزود ثم أكدها العميل؛ مسار السائق جاهز لكنه يحتاج إنشاء سائق حقيقي وإسناده لاختبار دخول بشخص فعلي.
- نجح `tsc --noEmit` وESLint المستهدف وSQL static validation وحارس بصمات 55 migration. نجح Flutter analyze للملفات المعدلة دون أخطاء، مع بقاء ملاحظات info قديمة في `app.dart` لا تتعلق بالتسليم.

### تصحيح صلاحية رمز التسليم وإعادة فتح الطلب التجريبي — 2026-08-26

- أُلغي إدخال رمز التسليم من حساب العميل في الويب وFlutter. العميل يتابع التوصيل فقط داخل بطاقة عرض السعر المدفوع ويرى اسم السائق ورقم الاتصال والحالة والمواعيد عند وجود سائق، ولم يعد هناك اختصار «الاستلامات» مستقل في تنقل العميل.
- أضيفت وطُبقت migration `056_delivery_tracking_and_provider_confirmation.sql`: RPC المتابعة `get_customer_delivery_tracking` للعميل، وحصر `confirm_delivery_code` في السائق النشط المعيّن أو عضو المزود فقط. نجاح الرمز ما زال يغلق التوصيل وأمر التوريد والطلب ذرّيًا ويصدر حدث `delivery_confirmed` للعميل والمزود والسائق المعيّن.
- أضيف إدخال الرمز داخل تفاصيل أمر التوريد نفسه في منصة المزود وتطبيق Flutter، وبقي في صفحة السائق. يظهر للعميل تنبيه بتسليم الرمز للسائق أو المزود فقط بعد استلام كامل البضاعة.
- أضيفت وطُبقت migration التشغيلية `057_reopen_selected_delivery_test.sql` لإعادة فتح الطلب المحدد `ORD-20260826-F3BEBF7D` فقط: التوصيل `arrived`، أمر التوريد `out_for_delivery`، والطلب `out_for_delivery`. حُذفت نتيجة الاختبار السابقة وسجل الإغلاق وحدثه حتى لا تظهر الرحلة كمكتملة.
- أُصدر رمز جديد مشفّر التجزئة صالح حتى 2026-09-02، محاولاته صفر ولم يُستخدم، وأُرسل للعميل عبر Green API بنجاح دون حفظ نصه الصريح. لا يوجد سائق معيّن على هذا الطلب، لذلك الاختبار الحالي يتم من المزود داخل `FUL-544693181C`؛ مسار السائق يحتاج سائقًا حقيقيًا معيّنًا.
- نجح `tsc --noEmit` وSQL static validation وحارس بصمات 57 migration. تحليل Flutter للملفات الثلاثة المعدلة بلا أخطاء أو تحذيرات جديدة؛ بقيت أربع ملاحظات `info` قديمة في `app.dart`.

### إضافة السائق وإسناد أمر التوريد — 2026-08-26

- إضافة السائق كانت موجودة فعليًا في المنصة عبر `/merchant/drivers/new` وفي تطبيق Flutter من وحدة «السائقون» وزر «إضافة سائق». أضيف أيضًا اختصار «إضافة سائق جديد من التطبيق» داخل بطاقة إسناد أمر التوريد لتقليل التنقل.
- أضيف اختيار السائق النشط وزر «إسناد الطلب للسائق» داخل نفس بطاقة التوصيل في تفاصيل أمر التوريد على منصة Next.js وتطبيق Flutter. بعد الإسناد يظهر الطلب في بوابة السائق وتظهر بياناته للعميل داخل عرض السعر المدفوع.
- أضيفت وطُبقت migration `058_provider_late_driver_assignment.sql`: تسمح بأول إسناد متأخر إذا بدأت الرحلة بلا سائق، كما في الطلب التجريبي، مع منع استبدال سائق موجود بعد بدء الرحلة. لا يقبل RPC إلا سائقًا نشطًا تابعًا للمزود وأمرًا مدفوعًا بحالة `ready` أو `out_for_delivery`، ويسجل الإسناد في التدقيق.
- توسع إشعار `customer.delivery_assigned` ليصل إلى السائق المعيّن إضافة إلى العميل عبر القنوات المتاحة، ويتضمن رابط بوابة السائق. يستخدم مفتاح منع تكرار مستقلًا لكل سائق وإسناد.
- التحقق الحي للطلب `ORD-20260826-F3BEBF7D` أثبت أن التوصيل `arrived`، وأمر التوريد `out_for_delivery` ومدفوع، ولا يوجد سائق مسند؛ وهو مؤهل الآن لأول إسناد متأخر. يوجد سائق واحد في المنشأة بحالة `must_change_password`، ولن يظهر للاختيار حتى يسجل دخوله ويغيّر كلمة المرور المؤقتة فيتحول تلقائيًا إلى `active`.
- نجح تحليل Flutter المستهدف بلا ملاحظات، ونجح TypeScript وESLint وSQL static validation وحارس بصمات 58 migration. تعذرت المعاينة المرئية الآلية لعدم وجود متصفح متصل بالجلسة.

### حذف حساب السائق التجريبي لإعادة إنشائه — 2026-08-26

- حُذف حساب السائق غير المفعّل «عمر خان» بناءً على طلب المستخدم بعد التحقق من أنه السائق الوحيد وأن حالته `must_change_password` ولا توجد عليه أي مهام توصيل مسندة.
- شمل الحذف سجل `provider_drivers` والرابط في `provider_driver_accounts` وحساب Supabase Auth والملف الشخصي والأدوار التابعة، مع حفظ أثر تدقيق تشغيلي بلا بيانات دخول.
- تحقق الحذف أن سجل السائق والملف الشخصي وحساب Auth لم تعد موجودة، وأصبح بالإمكان إعادة إنشاء السائق بنفس الجوال والبريد واسم المستخدم دون تعارض من الحساب السابق.

### إظهار تسجيل الخروج للسائق — 2026-08-26

- كان مسار `/driver` يعرض `DriverDeliveryWorkflow` مباشرة من دون غلاف تنقل للسائق، لذلك لم يرث زر الخروج الموجود في أغلفة الأدوار الأخرى. أضيف زر «تسجيل الخروج» واضح إلى رأس صفحة التوصيلات باستخدام `LogoutButton` المشترك، وأضيف أيضًا إلى شاشة تغيير كلمة المرور الأولى.
- في تطبيق Flutter بقي زر الخروج داخل تبويب «الحساب»، وأضيف اختصار خروج ظاهر في `AppBar` لكل حساب سائق مع نافذة تأكيد قبل إنهاء الجلسة والعودة لتسجيل الدخول.
- نجح TypeScript وESLint للملفات المعدلة، ونجح `flutter analyze lib/src/workspace.dart` بلا ملاحظات، وفحص `git diff --check` بلا أخطاء محتوى.

### مزامنة آخر نشاط السائق — 2026-08-26

- ثبت الفحص الحي أن حساب السائق «عمر خان» نشط، وكلمة المرور المؤقتة تغيرت، وSupabase Auth سجل دخولًا ناجحًا، لكن `provider_drivers.last_active_at` بقي `NULL`؛ لذلك كانت صفحة المزود تعرض خطأً «لم يسجل دخولًا بعد» رغم صحة الحساب.
- أضيفت وطُبقت migration `059_track_driver_activity.sql` وفيها RPC آمنة `mark_driver_activity()` لا تحدث إلا سجل السائق المرتبط بـ`auth.uid()`، مع تقليل الكتابات إلى مرة في الدقيقة. نفذت migration إصلاحًا رجعيًا من `auth.users.last_sign_in_at` للحسابات الموجودة.
- تستدعي منصة Next.js تحديث النشاط بعد دخول السائق وعند فتح لوحة التوصيلات وبعد إكمال كلمة المرور المؤقتة. يستدعي Flutter نفس RPC بعد تسجيل الدخول، وبعد إكمال كلمة المرور، وعند فتح مهام التوصيل، بما يغطي الجلسات المستعادة.
- أصبحت عبارة الحالة في صفحة المزود تفرق بين «لم يكمل أول دخول» للحساب المنتظر وبين «الحساب مفعّل ولم يسجل نشاطًا حديثًا»، بدل الادعاء بأنه لم يدخل مطلقًا.
- تحقق الإصلاح حيًا أن `last_active_at` للسائق الحالي يطابق وقت الدخول المسجل في Auth، والحساب `active` وعلامتا تغيير كلمة المرور في الملف والسائق `false`. نجح TypeScript وESLint وتحليل Flutter وSQL static وحارس بصمات 59 migration.

### إرسال تفاصيل الإسناد فورًا للعميل والسائق — 2026-08-26

- ثبت الفحص الحي أن الإسناد للسائق «عمر خان» محفوظ بصورة صحيحة، لكن حدث `customer.delivery_assigned` بقي `pending` بلا أي محاولة من العامل المجدول؛ لذلك لم يكن الخلل في السائق أو الطلب بل في تأخر معالجة Outbox.
- أضيفت وطُبقت migration `060_targeted_notification_dispatch.sql` التي تتيح للعامل المطالبة الذرّية بحدث محدد بصلاحية `service_role` فقط، وتمنع إرساله مرتين عند تزامن الإسناد المباشر مع Cron.
- أصبح إسناد السائق من منصة Next.js وتطبيق Flutter يمر عبر مسار مزود موحد: ينفذ RPC الآمنة نفسها ثم يعالج حدث الإسناد المحدد فورًا، ويعيد للواجهة حالة صريحة إن كان واتساب ما زال في إعادة المحاولة.
- توسع إشعار العميل ليشمل اسم السائق ورقم جواله وموعد التوصيل. توسع إشعار السائق ليشمل رقم الطلب وأمر التوريد، جميع المنتجات والكميات، المستلم ومسؤول الموقع والمقاول الاختياري، أرقام التواصل، ساعات العمل، التحميل والتنزيل، ملاءمة الطريق، تعليمات الوصول، وصف الموقع، ورابط Google Maps الصريح ورابط بوابة السائق العامة.
- أُنشئ إشعارا التطبيق فعليًا للعميل والسائق للطلب `ORD-20260826-F3BEBF7D`، وتأكد أن إشعار السائق يحمل رابط البوابة العامة وكامل تفاصيل المهمة. بقي حدث واتساب في إعادة المحاولة لأن إعداد Green API المحلي الحالي يرفض حتى `getStateInstance` والرقمين بـ`HTTP 400`؛ أي أن بيانات الـinstance/token الحالية لدى الموفر غير صالحة أو غير متصلة، وليست مشكلة تنسيق رقم جوال. صُححت أيضًا صيغة `checkWhatsapp` الرسمية إلى `phoneNumber`، وأصبحت سجلات المحاولات تتحدث بدل تثبيت أول فشل.

### إظهار رمز التسليم للعميل فقط داخل العرض المدفوع — 2026-08-27

- يظهر رمز التسليم الصريح للعميل مالك الطلب فقط داخل بطاقة متابعة العرض المدفوع في منصة Next.js وتطبيق Flutter، وبعد أن تصبح حالة التوصيل `arrived`. تعرض البطاقة الرمز بست خانات مع زر نسخ وتحذير صريح بعدم تسليمه قبل استلام كامل البضاعة ومراجعتها.
- لا تعرض واجهات المزود أو السائق الرمز ولا توفر مسارًا لقراءته؛ يبقى لهما مدخل التحقق فقط. أضيف مسار خادم للقراءة يتحقق من جلسة العميل ومن تطابق `orders.customer_profile_id` ومن نجاح السداد ووصول السائق وصلاحية الرمز، ويرسل استجابة `no-store`.
- أضيفت وطُبقت migration `061_customer_delivery_code_vault.sql` لتخزين نسخة قابلة للفك بخادم موثوق فقط باستخدام AES-256-GCM، مع الإبقاء على salt وSHA-256 للتحقق عند الإدخال. أصبح إصدار الرمز عند الدفع وإعادة الإصدار الإداري يحفظان النسخة المشفرة، وربط الرمز النشط للطلب التجريبي بالخزنة دون تغييره أو كشفه في السجلات.
- تحقق الفحص الحي من أن الرمز النشط ست خانات، وأن ناتج فك التشفير يطابق التجزئة المحفوظة، وأن الوصول المجهول محجوب. نجح TypeScript وESLint و`git diff --check`، ونجح تحليل Flutter دون أخطاء جديدة مع بقاء أربع ملاحظات info قديمة. تعذرت المعاينة المرئية الآلية لعدم وجود متصفح متصل بالجلسة.

### إصلاح تعذر تحميل رمز التسليم في Flutter — 2026-08-27

- ثبت الاختبار المباشر أن Flutter كان يتصل بالعنوان الإنتاجي `https://www.buniahksa.com` بينما مسار `/api/customer/deliveries/[id]/code` لم يكن منشورًا بعد، فكان Vercel يعيد صفحة `404` بدل JSON؛ لذلك ظهر تنبيه الاتصال العام رغم صحة الرمز المشفر.
- اكتمل بناء Next.js الإنتاجي ونُشرت النسخة `dpl_EagZJboPuUEXSuUa7v5Nu2rSFHiN` وربطت بالنطاق الإنتاجي. أعاد الاختبار بعد النشر `401` JSON لغير المسجل بدل `404`، وأعاد فحص CORS المسبق من `http://127.0.0.1:8090` الحالة `204`، بينما بقي الموقع الرئيسي بالحالة `200`.
- وسّع ملف `.vercelignore` لاستبعاد بيئات التطوير وبناء Flutter و`node_modules` من رفع Vercel؛ انخفضت حزمة المصدر من نحو `1.7GB` إلى `20MB` من دون حذف ملفات محلية أو استبعاد تنزيلات الموقع العامة.
- أصبحت بطاقة Flutter تعرض رسالة API العربية الآمنة عند وجود خطأ وظيفي، وتحتفظ برسالة اتصال مختصرة عند أخطاء الشبكة، بدل إخفاء كل الأسباب خلف تنبيه عام. نجح تحليل الملفين المستهدفين دون أخطاء جديدة.

### جاهزية دخول السائق وتشغيل مهمته من الجوال — 2026-08-27

- تحقق الفحص الحي أن حساب السائق الحالي «عمر خان» بالحالة `active`، وأن الجوال السعودي في `provider_drivers` مطابق لجوال Supabase Auth ومؤكد، وربط `provider_driver_accounts` موجود، وتغيير كلمة المرور المؤقتة مكتمل، كما توجد أوقات دخول ونشاط فعلية.
- السائق مسند إلى الطلب التجريبي الحالي وحالة التوصيل `arrived`. يدعم Flutter دخوله بالجوال بصيغ `05…` أو `5…` أو `966…`، ثم يحمّل مهمته عبر `get_my_driver_deliveries` ويتيح فتح Google Maps وتحديث مراحل الرحلة وإدخال رمز العميل وإغلاق التسليم.
- أضيفت صلاحية `INTERNET` إلى Android Manifest الرئيسي حتى تعمل نسخة الإنتاج على شبكة الهاتف، وأضيف تعريف فتح روابط `tel` و`https`. أصبحت بطاقة مهمة السائق تعرض زري اتصال مباشر بالمستلم ومسؤول الموقع مع معالجة فشل فتح تطبيق الاتصال أو الخرائط.
- نجح `flutter analyze --no-fatal-infos` للملفات المستهدفة بلا أخطاء جديدة، مع بقاء أربع ملاحظات info قديمة في `app.dart`. لم يُبن ملف APK جديد لأن الطلب كان تحققًا وظيفيًا ولم يطلب إصدار حزمة Android جديدة.

### توحيد رابط استعادة كلمة المرور على منصة بُنية — 2026-08-28

- كان تطبيق Flutter ومنصة Next.js يبنيان `redirectTo` من عنوان التشغيل المحلي؛ كما كان `site_url` في Supabase Auth مضبوطًا على `localhost`. لذلك كانت رسالة الاستعادة قادرة على توجيه هاتف المستخدم إلى `127.0.0.1:3000` بدل النطاق العام.
- ثُبت رابط الاستعادة في المصدرين على `https://www.buniahksa.com/auth/callback?next=/reset-password` بصورة مستقلة عن `APP_URL` و`NEXT_PUBLIC_SITE_URL`، حتى تبقى واجهات التطوير المحلية قادرة على الاتصال بخادم محلي من دون تسريب عنوانه إلى رسائل البريد.
- عُدل إعداد Supabase Auth المستضاف ليكون `https://www.buniahksa.com` هو `site_url`، مع السماح بمسارات النطاق الرسمي فقط لاستعادة الوصول. حوفظ على تأكيد البريد، طول OTP، تسجيل الجوال، Twilio، وMFA TOTP كما كانت قبل التعديل، ولم تُسجل أي مفاتيح أو رموز سرية.
- نجح اختبار `generateLink` فعلي على مستخدم موجود دون إرسال رسالة أو كشف الرمز: كان أصل التوجيه `https://www.buniahksa.com`، والمسار `/auth/callback`، و`next=/reset-password`، ولم يحتوِ الرابط على `localhost` أو `127.0.0.1`.
- نجح ESLint للواجهة وتحليل Flutter للملفين المستهدفين. نُشرت النسخة الإنتاجية `dpl_FS118RtqLLs4fP6yYU2TLuTeiagC` وربطت بـ`www.buniahksa.com`؛ أعادت صفحتا `/forgot-password` و`/reset-password` الحالة `200` وظهر نص التوجيه الرسمي في النسخة المنشورة.

### تثبيت توجيه بريد استعادة كلمة المرور من قالب Supabase — 2026-08-28

- بقيت نسخة تطبيق قديمة قادرة على إرسال `redirectTo` محلي غير موجود في قائمة السماح. كان Supabase يتجاهل العنوان غير المسموح ويعود إلى `site_url` الرسمي، لكن إلى الصفحة الرئيسية بدل صفحة تعيين كلمة المرور؛ لذلك لم يكن تثبيت `site_url` و`redirectTo` في المصدر كافيًا وحده.
- عُدل قالب Recovery المستضاف في Supabase Auth ليبني رابطًا رسميًا ثابتًا إلى `/auth/callback` باستخدام `TokenHash` ونوع `recovery`، وبذلك لم يعد مسار البريد يعتمد على عنوان ترسله نسخة العميل. بقي `site_url` على `https://www.buniahksa.com` وقائمة السماح محصورة في النطاق الرسمي.
- توسع مسار `src/app/auth/callback/route.ts` ليتحقق خادميًا من رمز Recovery عبر `verifyOtp` ويصدر جلسة آمنة ثم يحول إلى `/reset-password`، مع إبقاء مسار PKCE السابق والتحقق من الوجهات المسموحة.
- نجح TypeScript وESLint والبناء الإنتاجي. نُشرت النسخة `dpl_EyvbMqfq9CofW8GnmVBwTztB6U62` وربطت بالنطاق الرسمي. نجح اختبار حي بحساب مؤقت حُذف بعد الفحص: أعاد الرابط `307` إلى `https://www.buniahksa.com/reset-password` وأصدر Cookie للجلسة دون إرسال بريد أو الاحتفاظ ببيانات الاختبار.

### إصلاح إرسال استعادة كلمة المرور من المنصة والتطبيق — 2026-08-28

- كشف الاختبار الحي أن الاستدعاء المباشر إلى Supabase Auth يعيد `429` للبريد بعد تكرار المحاولة، بينما كانت المنصة وFlutter يخفيان السبب برسالة عامة. وُحّد المساران على endpoint خادمي جديد `/api/auth/password-recovery` مع CORS للتطبيق المحلي، حد محاولات، واستجابة لا تكشف وجود الحساب.
- يولد الخادم رمز Recovery عبر Supabase Admin ويبني رابطًا رسميًا إلى `/auth/callback?next=/reset-password` ثم يرسل رسالة عربية HTML ونصًا بديلًا عبر Resend. أصبحت المنصة تعرض نتيجة الاتصال الحقيقية، وأصبح Flutter يستخدم endpoint نفسه ويعرض رسالة الخادم الآمنة بدل استثناء عام.
- كان مرسل Resend السابق `onboarding@resend.dev` يرفض الإرسال العام. أضيف نطاق `buniahksa.com` إلى Resend، وأضيفت سجلات DKIM وSPF/MX إلى DNS في Vercel حتى أصبحت حالة النطاق `verified`، وضُبط المرسل الإنتاجي على `no-reply@buniahksa.com` دون تسجيل أي مفتاح سري.
- أضيفت ثلاث محاولات آمنة لمزود البريد عند أخطاء الشبكة و`429/5xx` مع Idempotency ثابت. كُشف أثناء النشر محرف BOM أضافه تمرير PowerShell عبر stdin إلى متغيرات Vercel؛ أعيد حفظ القيم بخيار `--value` المباشر وأعيد النشر على `www.buniahksa.com`.
- نجح ESLint وTypeScript وبناء Next.js وتحليل ملفي Flutter. أعاد الاختبار النهائي على النطاق الرسمي `202`، وسجلت قاعدة البيانات حالة `submitted`، ثم أكد Resend أن آخر حدث للبريد التجريبي هو `delivered`.
- بعد ظهور خطأ اتصال في Flutter Web، ثُبت عنوان endpoint الاستعادة داخل التطبيق على `https://www.buniahksa.com/api/auth/password-recovery` بدل اشتقاقه من `APP_URL`. يمنع ذلك توجيه الاستعادة إلى خادم تطوير محلي متوقف أو منفذ مختلف، بينما تبقى بقية اتصالات التطبيق قابلة للتوجيه محليًا. نجح تحليل Flutter بعد التعديل.
- اختُبرت عملية تغيير كلمة المرور عبر Supabase Auth بحساب مؤقت حُذف بعد الفحص: قُبلت `Ah_19951995` عند تعيينها أول مرة، ثم أعاد Auth الخطأ `same_password` وحالة `422` عند إرسالها مرة أخرى. عُدلت صفحة `/reset-password` لتترجم هذا الخطأ صراحة إلى وجوب اختيار كلمة مختلفة، وتوضح السياسة، وتمسح الخطأ عند تعديل الحقول مع إبقاء جلسة الاستعادة قابلة لإعادة المحاولة. نجح ESLint وTypeScript ونُشر التعديل على النطاق الرسمي.

### التعدد اللغوي المشترك للمنصة وFlutter — 2026-08-28

- أضيفت طبقة لغات مشتركة تدعم العربية والإنجليزية والأوردو والهندية والبنغالية والفلبينية. يحفظ الويب اللغة في cookie و`profiles.preferred_locale`، ويحفظها Flutter محليًا وفي الملف نفسه، ويضبط المصدران اتجاه `RTL/LTR` والتنسيق المحلي للأرقام والتواريخ. يظهر مبدل اللغة عالميًا في المنصة، وفي ترويسة التطبيق وشاشة دخول السائق/المستخدم.
- رُبط المسار التشغيلي للسائق كاملًا بالقاموس المعتمد في الويب وFlutter: التنقل، حالات التوصيل، المستلم ومسؤول الموقع، ساعات العمل، التحميل والتنزيل، سهولة الوصول، الاتصال، Google Maps، خطوات الرحلة، رمز التسليم ورسائل النجاح والخطأ. أصبحت مهمة السائق تحمل أيضًا منتجات الطلب وكمياتها ووحداتها باللغة المفضلة.
- أضيفت جداول ترجمة بشرية مراجعة للمنتجات والتصنيفات والوحدات والقياسات، وحقول ترجمة ثابتة إلى عناصر طلب السعر وعرض العميل والطلب النهائي. لا تُستخدم ترجمة كتالوج في طلب تشغيلي إلا عند وجود `reviewed_at`؛ النصوص الحرة التي يدخلها العميل أو المزود تبقى كما كُتبت بدل اختلاق ترجمة غير دقيقة.
- طُبقت migrations `062` حتى `066` على Supabase البعيد: تفضيل اللغة، مخزن المحتوى المراجع، تحديث snapshots القديمة والجديدة عند اعتماد ترجمة، قفل دوال triggers، وتعريب payloads المزود والسائق حسب لغة الحساب، وفصل سياسة قراءة الكتالوج العام عن صلاحيات عضوية المزود. تحقق backfill أن عنصر الطلب الحالي يحمل المفاتيح الخمسة `bn,en,hi,ur,fil` للاسم والوحدة.
- أُدخلت ترجمات بشرية معتمدة للبيانات الإنتاجية الحالية: 9 تصنيفات × 5 لغات، منتجان × 5 لغات، ووحدتا المنتجين × 5 لغات. يقرأ كتالوج Next.js وFlutter هذه الترجمات ويعود للعربية فقط عند غياب ترجمة مراجعة.
- نجح TypeScript وESLint وتحليل Flutter المستهدف وبناء Next.js الإنتاجي وبناء Flutter Web Release وSQL static validation وحارس 66 migration وSupabase remote lint. نُشرت النسخة النهائية `dpl_wbH2mo8FwFTY5Goz72SDJPhiiTDK` على `www.buniahksa.com` بعد تعريب عروض العميل والمزود. تحقق النطاق الرسمي من `lang=en` و`dir=ltr` ومن ظهور `App Product Test D` و`Insulation` فعليًا من جداول الترجمة. تعذرت اللقطة البصرية فقط لعدم توفر متصفح متصل بجلسة Codex.

### إكمال تعريب الصفحة الرئيسية للسائق ومنع انقسام تسميات التنقل — 2026-08-28

- كشف الفحص البصري أن تطبيق Flutter كان يترجم عناصر محدودة من شريط التنقل ومسار التوصيل فقط، بينما بقي عنوان لوحة الدور وبطاقة الرئيسية والعدادات وبطاقة اتصال البيانات بالعربية لأن `_RoleHome` و`_roleLabel` وبيانات المؤشرات كانت تستدعي نصوصًا عربية ثابتة خارج القاموس.
- رُبطت ترويسة الدور وبطاقات الرئيسية والعدادات وحالة البيانات وصفحات الخدمات والإشعارات والحساب بقاموس اللغات الست، وأضيفت ترجمة حرفية آمنة للنصوص الواجهية المعتمدة فقط؛ تبقى الأسماء والنصوص الحرة كما أدخلها أصحابها حتى لا تُختلق ترجمة غير دقيقة.
- فُصلت تسميات شريط التنقل المختصرة عن عناوين الصفحات: تستخدم الإنجليزية `Alerts` بدل `Notifications` في الشريط فقط، مع بدائل قصيرة مراجعة للأوردو والهندية والبنغالية والفلبينية وحجم خط ثابت. يبقى عنوان الصفحة الكامل مترجمًا ولا ينقسم اسم الوجهة إلى مقطعين.
- أضيفت المفاتيح نفسها إلى قاموس Next.js حتى تترجم طبقة التوافق أي ظهور مطابق للنصوص القديمة في المنصة، مع استمرار `lang/dir` وآلية حفظ اللغة الحالية.
- نجح `flutter analyze` للملفات المستهدفة، وبناء Flutter Web Release، وTypeScript، وESLint لقاموس الويب، وبناء Next.js الإنتاجي، و`git diff --check` دون أخطاء. نُشرت منصة الويب في deployment `dpl_B2DmBPcu2Wca9UfyNm2zrE22wurE` وربطت بالنطاق `www.buniahksa.com`.

### ترجمة قيم بيانات التسليم داخل مهمة السائق — 2026-08-28

- كان `get_my_driver_deliveries` يترجم أسماء الحقول والمنتجات فقط، لكنه يعيد قيم المستلم ومواعيد العمل والتحميل والتنزيل والطريق وتعليمات الوصول ووصف الموقع بالعربية كما حفظها العميل؛ لذلك ظهرت بطاقة مختلطة رغم اختيار الإنجليزية.
- أضيفت وطُبقت migration `067_localize_driver_delivery_details.sql`. أضافت دالة مركزية بترجمات مراجعة للخيارات المنظمة في نموذج التسليم والقيم التشغيلية المعتمدة في الطلب الحالي، ثم أعادت بناء RPC السائق لتطبق لغة `profiles.preferred_locale` على القيم قبل وصولها إلى منصة السائق أو تطبيق Flutter. أرقام الجوال وأكواد الطلب والتسليم لا تتغير.
- تغطي الترجمات الإنجليزية والأوردو والهندية والبنغالية والفلبينية: مسؤولية التحميل، خيار التنزيل، سهولة الطريق، مواعيد العمل المعتمدة، «لا يوجد»، وصف الموقع الحالي، واسم حساب الاختبار الحالي. القيم الحرة الجديدة التي لا تملك ترجمة مراجعة تعود إلى أصلها بدل اختلاق ترجمة غير دقيقة.
- عُدل ترتيب تغيير اللغة في Flutter ليحفظ `preferred_locale` أولًا ثم يعيد بناء التطبيق، حتى لا يسبق أول طلب بيانات تحديث اللغة في قاعدة البيانات. يوجد حد انتظار أربع ثوانٍ ويظل الحفظ المحلي بديلًا عند انقطاع الاتصال.
- تحقق حي بصلاحية السائق أعاد الطلب `ORD-20260826-F3BEBF7D` بالإنجليزية بقيم `Test Customer` و`7 AM to 4 PM` وخيارات التحميل والتنزيل والطريق وتعليمات الوصول ووصف الموقع مترجمة. كما اختُبرت القيم الخمس نفسها لكل اللغات الأخرى مباشرة من الدالة.
- نجح Flutter analyze وبناء Flutter Web Release وSQL static validation وحارس 67 migration وSupabase remote lint. يتطابق سجل migrations المحلي والبعيد حتى `067`؛ تحذيرات lint المتبقية قديمة في دوال المقاول وليست من هذا التعديل.

### إعادة تصميم بطاقة مهمة السائق — 2026-08-28

- كان عرض Flutter يحسب عرض كل معلومة من عرض الشاشة الكامل رغم وجودها داخل بطاقة ذات padding؛ لذلك لم يتسع عنصران في الصف وظهرت التفاصيل كسلسلة صناديق ضيقة وطويلة. كما كان عرض الويب يستخدم شبكة تعريف عامة لا تعكس أولوية معلومات السائق.
- أُعيد تنظيم المهمة في Flutter وNext.js كبيان توصيل تشغيلي: رأس واضح لأكواد الطلب والحالة، قسم موحد لجهات التواصل مع أزرار اتصال ذات مساحة لمس 44 بكسل، قسم واحد للموقع والتجهيز بمواعيد وتفاصيل تحميل وطريق وتعليمات مفصولة بصريًا، وقائمة منتجات وإجراءات خريطة وحالة واضحة.
- أُلغي الحساب المباشر لعرض حقائق السائق واستُخدم `LayoutBuilder` لملخص الموعد وساعات العمل، مع تحول تلقائي إلى عمود واحد عند العرض الضيق. لا تُنشأ بطاقة مستقلة لكل قيمة، وتبقى النصوص الطويلة قابلة للالتفاف في اللغات الست.
- أضيف عنوانا `deliveryContacts` و`siteReadiness` بترجمات عربية وإنجليزية وأوردية وهندية وبنغالية وفلبينية في قاموسي المنصة والتطبيق.
- نجح Flutter analyze وبناء Flutter Web Release وTypeScript وESLint وبناء Next.js و`git diff --check`. فحص الألوان لم يسجل مخالفة في الملفات المعدلة؛ بقيت 18 مخالفة قديمة في ملفات إدارة ومنتجات أخرى. تعذرت المعاينة الآلية لأن جلسة المتصفح لم تعرض أي متصفح متصل.
- نُشرت منصة الويب في deployment `dpl_8ZExykVX2iFqAsF8gMF45joGDfF1` بحالة `READY` وربطت بالنطاق `https://www.buniahksa.com`.

### تأكيد التسليم وإشعارات إغلاق الطلب — 2026-08-28

- كان تأكيد رمز التسليم من منصة Next.js وتطبيق Flutter يستدعي `confirm_delivery_code` مباشرة؛ نجحت معاملة قاعدة البيانات وأُغلق الطلب، لكن حدث `delivery_confirmed` بقي `pending` بلا معالجة فورية. أضيف المسار الموحد `/api/deliveries/[id]/confirm` ليستدعي RPC الآمنة ثم يطالب بالحدث المحدد ذريًا ويعالج إشعاراته فورًا، مع إبقاء Outbox لإعادة المحاولة عند تعطل قناة خارجية.
- أصلح خطأ Flutter الظاهر `setState() callback argument returned a Future` بفصل إنشاء الـFuture عن callback المتزامن في شاشة توصيلات السائق، وطُبق الإصلاح نفسه على مواضع التحميل المطابقة في مساحات العميل والمزود والإدارة لتجنب تكرار الخطأ.
- أضيف إشعار إتمام احترافي للعميل بعنوان «تم تسليم الطلب بنجاح» يتضمن تأكيد الاستلام، رسالة شكر، رابط تفاصيل الطلب، ودعوة لإنشاء طلب جديد. يصل المزود تأكيد إغلاق الطلب ورابط أمر التوريد، ويصل السائق إشعار نجاح المهمة. أضيف البريد الإلكتروني قناة احتياطية للعميل والمزود إلى جانب الإشعار داخل الحساب وواتساب.
- طُبقت migration `068_customer_notification_event_idempotency.sql` لإضافة `event_key` فريد اختياري إلى `customer_notifications`. يكتب الموزع إشعار العميل في الجدول الذي تقرؤه منصة العميل وتطبيق Flutter فعليًا، بدل جدول الإشعارات العام، مع منع التكرار وإبقاء push مرتبطًا بالحساب.
- ضُبط `CRON_SECRET` كسر إنتاجي في Vercel؛ كان غيابه يمنع `/api/cron/notifications` من قبول تنفيذ الجدولة. نُشرت النسخة النهائية في deployment `dpl_EuGNCezqfo32o6ZQLSPdRgpT7Uqz` وربطت بالنطاق الرسمي.
- عولج حدث التسليم الحالي `1493961a-e054-4e02-bbce-7b779a13aed9`: أُنشئ إشعار العميل وإشعارا المزود/السائق داخل الحسابات دون تكرار، وقُبل بريدا العميل والمزود من Resend بحالة `submitted`. بقي الحدث `failed` عمدًا لإعادة محاولة واتساب؛ Green API يرفض حاليًا `getStateInstance` و`checkWhatsapp` وكل أرقام المستلمين الثلاثة بـHTTP 400، ما يثبت أن نسخة واتساب الخارجية غير متصلة/صالحة وليس الخلل من تنسيق أرقام الجوال أو رحلة التسليم.
- نجح TypeScript وESLint وبناء Next.js الإنتاجي وبناء Flutter Web Release وتحليل Flutter المستهدف وSQL static validation وحارس بصمات 68 migration، وطُبقت migration `068` على Supabase البعيد.

### بطاقات مهام السائق وأرشيف الطلبات المكتملة — 2026-08-28

- استُبدل عرض تفاصيل كل مهام السائق المفتوح افتراضيًا بقائمة بطاقات تشغيلية مختصرة في Flutter ومنصة Next.js. تعرض البطاقة كود الطلب والمستلم والموعد والحالة فقط، وتفتح التفاصيل الكاملة والإجراءات عند ضغط السائق عليها؛ وبذلك لا تمتد المهمة الواحدة بطول الشاشة قبل الحاجة إليها.
- فُصلت الحالات النهائية `delivered` و`failed_delivery` عن قائمة العمل النشطة. تظهر داخل أيقونة أرشيف واضحة في ترويسة مهام Flutter وبجوار إجراءات منصة السائق، مع شارة عددية. الضغط يفتح bottom sheet أصليًا في Flutter ولوحة أرشيف عائمة/سفلية متجاوبة في الويب، وتعرض الطلبات المنتهية كبطاقات صغيرة بدل خلطها بالمهام الحالية.
- أضيفت تسميات بشرية مراجعة للقائمة النشطة والأرشيف والحالات الفارغة بالعربية والإنجليزية والأوردية والهندية والبنغالية والفلبينية. حوفظ على أهداف لمس لا تقل عن 44 بكسل، والتفاف النصوص، واتجاه RTL/LTR، وشريط التنقل السفلي.
- نجح `flutter analyze` للملفين المستهدفين، وبناء Flutter Web Release، وTypeScript وESLint، وبناء Next.js محليًا وفي Vercel. تعذرت اللقطة البصرية الآلية فقط لأن قائمة المتصفحات المتصلة كانت فارغة. نُشرت منصة الويب في deployment `dpl_F7YTJG4Ak3k8kEBZ9SicmPcFNJ8K` وربطت بالنطاق `https://www.buniahksa.com`.

### تبسيط بطاقة الرئيسية في تطبيق Flutter — 2026-08-28

- حُذفت أيقونة النجوم الزخرفية من بطاقة الرئيسية وبطاقات لوحات الأدوار، وحُذفت شارة «سوق البناء الذكي» من `apps/bunya_app/lib/src/app.dart`. بقيت نجمة التقييم الوظيفية فقط، وحُفظت محاذاة البطاقات.
- تحقق البحث من عدم بقاء العبارة أو أيقونة `auto_awesome_rounded`. اكتمل التنسيق و`git diff --check`، ولم يظهر التحليل أخطاء أو تحذيرات؛ بقيت أربع ملاحظات `info` قديمة وغير مرتبطة بالحذف.

### تغطية شاملة لنصوص المنصة باللغات الست — 2026-08-28

- كان سبب بقاء نصوص الرئيسية عربية عند اختيار الإنجليزية أن `translateLiteral` كان يعرف عددًا محدودًا من عبارات قاموس السائق فقط، ولا يراقب تغيير النص أو السمات بعد العرض.
- أضيف `src/lib/i18n/literal-translations.generated.json` ويغطي 2413 عبارات واجهة عربية فعلية لكل من الإنجليزية والأوردية والهندية والبنغالية والفلبينية. لا تحتوي الترجمات الإنجليزية أو الهندية أو البنغالية أو الفلبينية أي حرف عربي متبقٍ.
- أضيفت كذلك ترجمات مراجَعة لأسماء العرض وبيانات العميل والمزود والمقاول والمنتجات وخياراتها الحالية؛ تبقى المعرفات مثل البريد والجوال وSKU وأكواد الطلبات بقيمها الأصلية حتى لا تفسد وظيفتها.
- يطبق `src/lib/i18n/messages.ts` المطابقة الكاملة أولًا ثم ترجمة الأجزاء العربية داخل العبارات المركبة، مع الإبقاء على الأكواد والأرقام والبريد بلا تغيير. وسّع `LocaleProvider.tsx` المراقبة لتغطي النصوص و`placeholder` و`title` و`aria-label` التي تتغير ديناميكيًا.
- أضيف حارس `npm run test:i18n` لمنع إضافة نص عربي جديد دون الترجمات الخمس. نجح الحارس لـ`2413 × 5`، ونجح TypeScript وESLint وبناء Next.js الإنتاجي و`git diff --check`. تعذر الفحص البصري الآلي لأن قائمة المتصفحات المتاحة للجلسة كانت فارغة.

### ربط قياسات المنتج وخياراته بعناصر طلب السعر — 2026-08-28

- كان نموذج الويب يحفظ القياس فقط، بينما كان تطبيق Flutter يرسل `measurement_id` فارغًا دائمًا، ولم يكن عنصر طلب السعر أو قاعدة البيانات يملكان حقلاً منظمًا لاختيارات المنتج مثل الضغط أو اللون أو السماكة.
- يجمع الويب والتطبيق الآن خيارات المنتج حسب فئة الخاصية، ويعرضان اختيارًا مستقلًا لكل فئة مع اختيار القياس وتحديث الوحدة التابعة له. لا تُدمج الكميات إلا عندما يتطابق المنتج والقياس وجميع الخيارات، وتظهر الاختيارات في مراجعة العميل وتفاصيل الطلب ومسار تسعير المزود.
- أضيفت وطُبقت migration `069_quote_item_measurements_and_variants.sql` على Supabase البعيد. تحفظ `quote_request_items.variant_selections` نسخة JSON موثوقة و`variant_label_snapshot` وصفًا تشغيليًا، ويتحقق RPC من أن كل خيار نشط ويتبع المنتج ومن اختيار فئات الخيارات المطلوبة قبل إنشاء الطلب.
- أضيفت الترجمات الخمس للنصوص الجديدة، ونجح TypeScript وESLint وتحليل Flutter المستهدف دون أخطاء وDart format وSQL static validation وحارس بصمات 69 migration وحارس الترجمة لـ`2417 × 5`. يتطابق سجل migrations المحلي والبعيد حتى `069`.

### ربط Paymob والدفع الإلكتروني للويب وFlutter — 2026-08-30

- رُبط حساب Paymob السعودي الحي بمشروع Vercel عبر متغيرات سرية للإنتاج دون حفظ القيم في المستودع أو هذا المرجع. جرى التحقق من صلاحية مفتاح الخادم بطلب تحقق غير منشئ لدفعة، وأعاد Paymob حالة تحقق متوقعة بدل رفض المصادقة.
- أضيف مسار خادمي موحد لإنشاء Intention بعد التحقق من جلسة العميل وملكية العرض والطلب والفاتورة وتطابق المبلغ. يستخدم Hosted Unified Checkout لبطاقات الدفع وApple Pay، ويعيد استخدام الجلسة النشطة لتقليل مخاطر المحاولات المتكررة.
- أضيف Webhook خاص بـPaymob يتحقق بـHMAC-SHA512، ومعرّف التكامل، والعملة SAR، والمبلغ بالهللة قبل تمرير الحدث إلى `apply_trusted_payment_event`. لا تُعتمد نتيجة الرجوع من المتصفح كمصدر للحقيقة؛ Webhook الموقّع وحده يحدّث الدفع والفاتورة والطلب ويحرر التجهيز وينشئ رموز التسليم.
- أضيفت صفحة دفع متجاوبة بهوية بُنية واتجاه RTL/LTR وترجمات عربية وإنجليزية وأوردية وهندية وبنغالية وفلبينية. بعد قبول العرض ينتقل العميل إلى الدفع مباشرة، ويظهر رابط الدفع أيضًا في العرض والطلبات غير المسددة.
- أضيف داخل Flutter زر قبول العرض والدفع أو الدفع للطلب المقبول. يستخدم Bearer token الحالي، ويفتح صفحة Paymob خارج التطبيق، ثم يحدّث بيانات التطبيق عند العودة. أضيفت ترجمات اللغات الست لنصوص الدفع.
- نجح `npx tsc --noEmit` و`npm run test:i18n` وتحليل Flutter للملفين المستهدفين وبناء Next.js الإنتاجي محليًا وعلى Vercel. نُشرت النسخة النهائية `dpl_CdGqYkBct7x9mSP9iPeGVSuS2puH` بحالة `READY` وربطت بـ`https://www.buniahksa.com`. تحقق مسارا Intention وWebhook على النطاق الرسمي بإرجاع `401` للطلبات غير الموثقة/غير الموقعة دون إنشاء أي عملية مالية.

### نسخة Android ARM64 خفيفة للاختبار — 2026-08-30

- بُني تطبيق Flutter كملف APK إنتاجي مخصص لمعمارية `arm64-v8a` فقط باستخدام فصل المعماريات، وتصغير الأيقونات، وتشويش كود Dart، وفصل رموز التصحيح. هذه النسخة موجهة لمعظم أجهزة Android الحديثة ولا تدعم المحاكيات `x86` أو الأجهزة القديمة ذات 32 بت.
- نتج الملف `apps/bunya_app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk` ونسخة التسليم `artifacts/Buniah-Android-arm64-v1.0.0.apk` بحجم `16.52 MB` وبصمة `SHA-256: 692EBE7A61810E69E22F06D58C4BECCBB5C8D5CA8B2FF7C12BE1886E53E492CE`، وتحقق `apksigner` من صحة توقيع APK v2 ومن هوية الحزمة `com.buniahksa.app` والمعمارية `arm64-v8a`.
- يستخدم إصدار التطبيق الحالي توقيع Android التجريبي الموجود في المشروع؛ يصلح للتثبيت المباشر والاختبار، ولا يصلح للنشر في Google Play قبل إنشاء مفتاح إصدار آمن مستقل وحفظه خارج المستودع.

### إزالة نسخة PWA من منصة الويب — 2026-08-30

- أزيلت قابلية تثبيت منصة Next.js كـPWA بالكامل: حُذفت `src/app/manifest.ts` و`public/sw.js` وصفحة `/offline` ومكوّنا التسجيل/التثبيت وأصول `public/pwa`، وأزيلت بيانات `manifest` و`appleWebApp` من metadata وكل أنماط CSS والترويسات واستثناءات Proxy التابعة لها. بقيت أيقونتا الويب العاديتان `src/app/icon.png` و`src/app/apple-icon.png`، وأصبح مزامِن أصول الجوال يستخدم الأولى بدل أصل PWA المحذوف.
- أضيف `LegacyPwaCleanup` كتنظيف انتقالي لا يسجل Service Worker ولا يتيح التثبيت؛ عند فتح الموقع يلغي أي تسجيلات قديمة على النطاق ويحذف caches ومفاتيح localStorage القديمة التابعة لـPWA. لا يمكن للموقع إزالة اختصار PWA المثبت سابقًا من شاشة جهاز المستخدم قسرًا، لكن الاختصار لم يعد مدعومًا كتطبيق قابل للتثبيت بعد فتح النسخة الجديدة.
- نجح TypeScript وESLint المستهدف وبناء Next.js الإنتاجي محليًا وعلى Vercel. نُشرت النسخة على `https://www.buniahksa.com` عبر deployment URL `https://bunya-platform-gxd2qmzzx-ahmedabumoallas-projects.vercel.app`. تحقق الإنتاج من أن `/manifest.webmanifest` و`/sw.js` و`/offline` و`/pwa/icon-192.png` تعيد `404`، وأن الصفحة الرئيسية لا تحتوي رابط manifest أو Apple Web App metadata أو نص تثبيت PWA.
- حارس `check:no-operational-mocks` لا يزال يرصد استخدام localStorage موجودًا مسبقًا في `AuthFlows.tsx` و`PhoneVerificationFlow.tsx`؛ لم ينتج عن إزالة PWA ولم يُعدّل ضمن هذا النطاق.

### إصلاح إعداد اتصال APK وإصدار Android 1.0.1 — 2026-08-30

- كان APK السابق مبنيًا يدويًا من دون `SUPABASE_URL` و`SUPABASE_ANON_KEY` العامة، لذلك حسم Dart الشرط الثابت إلى `ConfigurationMissingApp` وأظهر رسالة أن إعداد الاتصال غير مكتمل. لم يكن الخلل من الشبكة أو النطاق المنشور.
- رُفع الإصدار إلى `1.0.1+2`، وعُدّل `tool/build-android.ps1` لرفض البناء عند غياب الإعدادات العامة، والبناء لمعمارية `android-arm64` فقط مع فصل ABI وتشويش Dart وفصل رموز التصحيح، ثم نسخ الناتج إلى مجلد التسليم والنسخة العامة.
- بُني `artifacts/Buniah-Android-arm64-v1.0.1.apk` بحجم `19.83 MB` وبصمة `SHA-256: 1FD9B92786E0330334DD4E9E789F78E9B835D7101FB7B6B4B59B42A0FE905BAF`. تحقق `aapt` من الحزمة `com.buniahksa.app` والإصدار `1.0.1` ورقم البناء `2002` والمعمارية `arm64-v8a`، وتحقق `apksigner` من توقيع APK v2. لم يتوفر جهاز Android متصل عبر ADB لإجراء تشغيل فعلي على جهاز.

### المسح النهائي لبيانات الإنتاج مع إبقاء حسابات الإدارة — 2026-08-30

- نُفذ مسح نهائي على مشروع Supabase الإنتاجي المرتبط `buniah` بعد مطابقة أربعة حسابات إدارة فعالة عبر `auth.users` و`profiles` و`user_roles` و`admin_users`. حُذفت الحسابات الأربعة غير الإدارية (عميل ومزود ومقاول وسائق) وكل بيانات التطبيق التشغيلية والمرجعية، بما فيها المنتجات والتصنيفات والترجمات والطلبات والعروض والفواتير والمدفوعات والتوصيلات والإشعارات والسجلات والإعدادات ورموز التحقق.
- حُذفت ملفات Storage السبعة عبر Storage API حتى تزول الملفات الفعلية لا سجلاتها فقط. بقيت تعريفات الحاويات ومخططات Supabase الداخلية وسجل migrations لأنها بنية نظام وليست بيانات مستخدم.
- مُسحت جلسات Auth وrefresh tokens وone-time tokens وflow states وعوامل MFA ورموز التأكيد/الاسترداد/تغيير البريد والهاتف وإعادة المصادقة. بقيت أربعة سجلات `auth.users` وأربع identities وأربعة profiles وأربعة user roles وأربعة admin users فقط، مع تعريفات أدوار وصلاحيات الإدارة الضرورية لاستمرار دخولهم.
- تحقق مستقل بعد التنفيذ من: `auth.users=4`، `auth.identities=4`، `profiles=4`، `user_roles=4`، `admin_users=4`، و`products=0` و`phone_verification_challenges=0` و`delivery_confirmation_codes=0` و`sessions=0` و`refresh_tokens=0` و`one_time_tokens=0` و`storage.objects=0`. كما فُحص كل جدول عام غير جداول الإدارة المحفوظة وكانت جميعها بلا صفوف.

### تشغيل تطبيق Flutter محليًا — 2026-08-30

- تطبيق Flutter Web يعمل محليًا عبر أمر التشغيل المخصص على `http://127.0.0.1:8090`، وتحقق طلب HTTP من جاهزية الخادم بحالة `200` وعنوان الصفحة `bunya_app`. يستخدم التشغيل إعدادات Supabase العامة من `.env.local`، وستظهر بيانات التشغيل فارغة بعد المسح النهائي السابق.

### استعادة تصنيفات المنتجات المرجعية — 2026-08-30

- كان نموذج انضمام المزود يعرض شرط اختيار تصنيف من دون خيارات لأن المسح النهائي السابق أفرغ جدول `product_categories`. أُعيدت التصنيفات المرجعية التسعة فقط من seed الأصلي، من دون استعادة أي حسابات أو منتجات أو طلبات أو بيانات تشغيلية.
- أضيف migration دائم وقابل لإعادة التنفيذ باسم `070_restore_product_category_reference_data.sql`، ويستعيد التصنيفات وترجماتها المعتمدة للغات `en` و`ur` و`hi` و`bn` و`fil`.
- تحقق طلب مجهول مماثل لطلب تطبيق Flutter من ظهور `9` تصنيفات نشطة و`45` ترجمة بحالة HTTP `200`.

### تشخيص غياب إشعار واتساب لطلب الانضمام — 2026-08-30

- تحقق طلب انضمام المزود `7a753a90-5297-4523-b2b0-c5682ac1b804` في الإنتاج بحالة `pending`. نجح إرسال أربع نسخ بريدية إلى الإداريين ونسخة تأكيد إلى مقدم الطلب.
- لم تُنشأ أي محاولة واتساب للطلب لأن حقول `profiles.mobile` فارغة لدى حسابات الإدارة الأربعة المحفوظة؛ وهذا متوافق مع المسح السابق الذي أبقى إيميلات الإدارة فقط. مسار `notifyJoinReviewers` يتجاوز واتساب عندما لا يوجد جوال في ملف الإداري، ولذلك لا توجد سجلات فشل من Green API لهذه العملية.
- يلزم تزويد رقم واتساب إدارة واحد أو أرقام الإداريين الأربعة وربطها بملفاتهم قبل اختبار الإرسال مجددًا. لا تُحفظ أرقام أو أسرار في هذا المرجع.

### اعتماد جهة الاتصال الأساسية للإدارة — 2026-08-30

- رُبط رقم واتساب الإدارة بالحساب الإداري الأساسي الموجود فعليًا على نطاق Gmail، ولم يُغيّر البريد إلى النطاق المكتوب خطأً `gtmail.com` لأنه لا يملك خادم MX صالحًا لاستقبال البريد. الحساب فعّال ودوره `super_admin`، ولذلك يدخل ضمن مستلمي جميع تنبيهات الإدارة المبرمجة بحسب الصلاحيات.
- أُعيد إرسال تنبيه واتساب لطلب الانضمام الحالي إلى جهة الإدارة الأساسية فقط. أكد Green API قبول الرسالة وأعاد معرف مزود، وسُجلت المحاولة في `notification_provider_submissions` بحالة `submitted` ومحاولة واحدة ومن دون خطأ.
- أضيفت أداة تشغيل آمنة `scripts/resend-join-whatsapp.mjs` لإعادة إرسال تنبيه طلب انضمام محدد مع التحقق من أن المستلم إداري فعّال، ومنع تكرار الرسالة إذا كان سجلها السابق ناجحًا، وتسجيل نتيجة المزود بصورة قابلة للتدقيق.

### تثبيت النطاق الرسمي في جميع روابط الإشعارات — 2026-08-30

- أصبح مصدر روابط إشعارات البريد وواتساب ثابتًا عبر `src/lib/notifications/site-url.ts` على `https://www.buniahksa.com`، ولا يعتمد على `APP_URL` أو إعدادات التطوير المحلية. شمل ذلك طلبات الانضمام، روابط التعديل والاعتماد، بيانات الدخول المؤقتة، مراجعة المنتجات، الدعم، التسويات والتنبيهات التشغيلية، وكذلك أداة إعادة إرسال تنبيه الانضمام.
- حُدث متغيرا Vercel الإنتاجيان `APP_URL` و`NEXT_PUBLIC_SITE_URL` إلى النطاق الرسمي؛ أُعيد إنشاء المتغير العام كـConfig لأن Vercel لا يسمح ببقاء متغير `NEXT_PUBLIC_` من نوع Secret.
- نجح ESLint للملفات المستهدفة و`npx tsc --noEmit` وبناء Vercel الإنتاجي. نُشر deployment `dpl_B3RxXiP9kzAS9UFP25TkVvvx9Bo5` بحالة `READY` وربط بالنطاق الرسمي. أكد الفحص عدم وجود `localhost` أو `127.0.0.1` أو نطاق Vercel القديم في مسارات الإشعارات، وأعاد النطاق الرسمي HTTP `200`.

### تشخيص إشعارات النظام في تطبيق الجوال — 2026-08-30

- مركز الإشعارات داخل Flutter موجود، كما يوجد كود أولي لطلب الإذن وتسجيل FCM token في `push_subscriptions`، لكن إشعارات النظام التي تظهر في شريط الجوال/شاشة القفل ليست جاهزة فعليًا من طرف إلى طرف.
- لا يحتوي مشروع Flutter على `google-services.json` أو `GoogleService-Info.plist` أو `firebase_options.dart`، ولا يظهر تطبيق Google Services في Gradle. كما لا تحتوي بيئة Vercel الإنتاجية على `FIREBASE_SERVICE_ACCOUNT_JSON` أو إعدادات APNs، وجدول `push_subscriptions` في الإنتاج بلا أي أجهزة مسجلة (`0`). تلتقط `PushService.initialize` خطأ تهيئة Firebase بصمت، ولذلك يستمر التطبيق من دون Push بدل إظهار عطل.
- لتفعيل Android يلزم إعداد مشروع Firebase والحزمة `com.buniahksa.app`، إضافة ملف Android العام الصحيح، إعداد اعتماد FCM للخادم، ثم بناء APK جديد واختباره على جهاز حقيقي بعد قبول إذن الإشعارات. iOS يحتاج أيضًا ملف Firebase الخاص به ومفتاح APNs وTeam ID وKey ID وBundle ID وإصدار iOS موقعًا.

### توحيد رئيسية المزود والمقاول مع واجهة المنتجات — 2026-08-30

- أصبحت الصفحة الأولى في `RoleWorkspace` للمزود والمقاول تستخدم `HomeTab` المشتركة نفسها التي تعرض البحث، اختصارات الكتالوج وطلب السعر، والمنتجات المختارة. بقيت لوحات التسعير/الفرص والخدمات والإشعارات والحساب في تبويبات العمل الحالية، ولم تتغير رئيسية الإدارة أو السائق.
- تدعم `HomeTab` الآن إظهار خيارات الانضمام حسب الدور: حساب المزود لا يرى «انضم كمزود» ويظل يرى «انضم كمقاول»، وحساب المقاول لا يرى «انضم كمقاول» ويظل يرى «انضم كمزود». الزائر والعميل يريان الخيارين كالسابق.
- أضيف فتح الكتالوج وطلبات العميل كشاشتين كاملتين من رئيسية حساب العمل، وأضيفت سلة طلب السعر إلى شريط المزود والمقاول لضمان اكتمال تدفق المنتجات دون نسخ مكونات المتجر.
- نُسق ملفا Flutter المستهدفان، ونجح `flutter analyze` بلا أخطاء (ست ملاحظات info موجودة في الملفات)، ثم أُعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090` وتحقق HTTP `200`. لم يُبن APK جديد لأن المستخدم لم يطلب بناء Android في هذه المهمة.

### مناقصة التسعير حسب المنتج والتصنيف — 2026-08-30

- أصبحت مطابقة كل صنف في طلب السعر تشمل جميع المزودين المعتمدين الذين لديهم منتج منشور ومتوفر يحمل الاسم نفسه أو ينتمي إلى التصنيف نفسه، مع الإبقاء على المطابقة بالمنتج أو SKU والأسعار الحديثة. يُنشأ هدف تسعير مستقل لكل منتج ولكل مزود مطابق، وعولجت الطلبات المفتوحة بالقواعد الجديدة.
- أصبح تخفيض المزود جولة مناقصة حقيقية: العرض المعدل يجب أن يكون أقل من عرض المزود المحفوظ وأقل من أقل تكلفة منافسة حالية بعد احتساب الكمية والضريبة والتوصيل. عند ظهور أقل سعر جديد يُعاد إشعار كل مزود أصبح عرضه أعلى، ويمكن تكرار الجولات حتى نهاية مهلة الصنف.
- أضيفت للإدارة صلاحية آمنة لتصحيح تصنيف المنتج أثناء المراجعة في الويب وتطبيق Flutter. يحفظ الإجراء في `audit_logs` ويؤثر مباشرة في توجيه طلبات التسعير اللاحقة.
- يقبل النظام طلب العميل خارج أوقات التسعير ويعرض له رسالة واضحة بأن العرض سيصل خلال 24 ساعة. تُحفظ الرسالة في الطلب وتظهر فور الإرسال في الويب والتطبيق.
- أصبح تجميع عرض بُنية النهائي يختار أقل عرض مؤهل لكل صنف على حدة، ويحذف من عرض العميل أي صنف لم يحصل على سعر مؤهل بدل تعطيل العرض كاملًا. إذا لم يُسعّر أي صنف فلا ينشأ عرض فارغ.
- أضيف وطُبق migration `071_category_tender_and_partial_quotes.sql` على Supabase الإنتاجي، وتطابق سجل الترحيلات المحلي والبعيد حتى `071`. نجح TypeScript وESLint وحارس الترجمة `2405 × 5` وحارس بصمات `71` migration و`git diff --check`. نجح فحص قاعدة البيانات مع تحذيرات قديمة غير مرتبطة، وتحليل Flutter بلا أخطاء مع سبع ملاحظات info قديمة.
- نُشرت واجهة الويب على Vercel بالإصدار `dpl_DDdbAoXWsxF8a7Pik1h3EpKU5wUq` بحالة `READY` وربطت بـ`https://www.buniahksa.com`. بقي Flutter Web المحلي متاحًا على `http://127.0.0.1:8090` بحالة HTTP `200`، ولم يُبن APK جديد لأن المهمة لم تطلب إصدار Android.

### فتح وجهة إشعار الإدارة مباشرة في تطبيق Flutter — 2026-08-30

- كانت بطاقة إشعار المزود تفتح طلب التسعير المرتبط، بينما كانت إشعارات الإدارة تفتح عارض نص عام حتى عندما يحتوي الإشعار على `action_url` و`entity_id` صالحين.
- أصبح الضغط على إشعار «منتج جديد بانتظار المراجعة» يحمّل المنتج المحدد ويفتح ملف مراجعته مباشرة، والضغط على إشعار «طلب انضمام مزود/مقاول» يفتح ملف طلب الانضمام المحدد مباشرة. يبقى عارض تفاصيل الإشعار مسارًا احتياطيًا للأحداث التي لا تملك وجهة تشغيلية معروفة.
- أضيف التقاط `FirebaseMessaging.onMessageOpenedApp` و`getInitialMessage`: الضغط على إشعار النظام من شريط الجوال أو شاشة القفل يعيد التطبيق إلى المسار الرئيسي ويفتح تبويب «الإشعارات» مباشرة، سواء كان التطبيق في الخلفية أو بدأ من حالة الإغلاق.
- كامل بطاقة الإشعار هي مساحة الضغط، ويُعلّم الإشعار كمقروء قبل الانتقال مع إظهار خطأ واضح إذا تعذر تحميل الوجهة. لم يتغير توجيه إشعارات تسعير المزود الذي كان يعمل مباشرة من قبل.
- نُسق `apps/bunya_app/lib/src/workspace.dart` ونجح تحليل Flutter دون أخطاء؛ بقيت ملاحظتا lint قديمتان من نوع `info`. بقي Flutter Web المحلي على `http://127.0.0.1:8090` بحالة HTTP `200`، ولم يُبن APK جديد.
- عند أول تجربة ظهر عارض النص القديم رغم صحة `action_url` و`entity_id` ووجود المنتج؛ السبب أن عملية `flutter run -d web-server` القديمة كانت لا تزال تقدم التجميعة السابقة ولم تُعد التحميل تلقائيًا. أُعيد تشغيل خادم Flutter Web بالكامل على المنفذ `8090` وتحقق HTTP `200` من التجميعة الجديدة.

### ضمان إشعار المزود بقرار مراجعة المنتج — 2026-08-30

- كان قرار اعتماد المنتج ينشئ حدث `provider.product_approved` صحيحًا، لكن إشعار المزود داخل التطبيق كان ينتظر عامل outbox الدوري. ظهر العطل في الحدث `07b2a56a-8169-4469-a663-c8670bb1df94` الذي بقي مؤقتًا `pending` بمحاولات صفر ومن دون صف في `notifications`.
- أضيف وطُبق migration `072_provider_product_review_notifications.sql`. ينشئ إشعار القبول أو الرفض أو طلب التعديل للمزود داخل نفس معاملة إنشاء الحدث، مع مفتاح مطابق لمفتاح العامل الدوري لمنع التكرار، ويعالج أحداث القرارات العالقة السابقة.
- أصبح عامل الإرسال يحفظ عنوانًا خاصًا بالقرار و`entity_type=product` بدل العنوان والنوع العامين. وفي Flutter يفتح ضغط المزود على إشعار قرار المنتج بطاقة المنتج المرتبط مباشرة.
- عولج إشعار القبول الحالي وتأكد وجوده في صندوق المزود، كما عولج حدث outbox بمحاولة واحدة وحالة `processed`. أكد Green API تسليم الطلب للمزود بحالة `submitted` ومعرف مزود ومن دون خطأ، ورابط الرسالة يستخدم `https://www.buniahksa.com/merchant/products`.
- نُشرت المنصة بالإصدار `dpl_6WrDGxnyjv6LzHZ6AwdDTH9sWmhp` وربطت بالنطاق الرسمي، وأعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090` وتحقق HTTP `200`. حارس بصمات migrations وTypeScript وESLint نجحت؛ فحص SQL العام ما زال يرصد نقص `revoke` قديمًا في migration `071`، وتحليل Flutter لا يحوي أخطاء ويعرض ملاحظتي `info` قديمتين.
- إشعار النظام أعلى شاشة الجوال لم يُرسل لهذا الحساب لأن جدول `push_subscriptions` لا يحتوي جهازًا مسجلاً للمزود، وإعداد Firebase الإنتاجي ما زال غير متاح كما هو موثق سابقًا؛ الإشعار المؤكد حاليًا هو داخل التطبيق وواتساب.

### طلبات تعديل بيانات المنتجات بعد النشر — 2026-08-30

- أضيف للمزود في منصة Next.js وتطبيق Flutter إجراء «طلب تعديل البيانات» داخل بطاقة المنتج وتفاصيله. يفتح نموذجًا كاملًا يسمح باقتراح تعديل جميع بيانات المنتج والصور والقياسات والخيارات والمواصفات والضمان والتسعير والمخزون والتوفر والتجهيز والتوصيل والمناطق، مع ملاحظة اختيارية للإدارة.
- لا يعدل الطلب النسخة المنشورة مباشرة. أضيفت وطُبقت migration `073_product_change_request_workflow.sql` لحفظ snapshot قبل/بعد، ومنع أكثر من طلب معلّق للمنتج، وتطبيق النسخة المقترحة بكل جداولها التابعة ذريًا عند الاعتماد فقط؛ الرفض يبقي المنتج الحالي بلا تغيير.
- أضيفت صفحة إدارة لقائمة الطلبات والمسار المباشر `/admin/products/changes/[id]`. تعرض المقارنة الدقيقة لكل حقل بصيغة «قبل / بعد»، مع اعتماد أو رفض وسبب القرار. يفتح إشعار الإدارة الطلب نفسه مباشرة في الويب وتطبيق Flutter.
- حدث `admin.product_change_requested` ينشئ إشعارًا داخل المنصة فورًا لكل مدير نشط، ثم يرسل البريد وواتساب عبر الموزع وOutbox إلى بيانات الإداريين الفعلية. قرارات الاعتماد والرفض تولد إشعارًا للمزود وتفتح منتجاته مباشرة.
- أضيف مسارا API المحميان `/api/provider/products/[id]/change-requests` و`/api/admin/product-change-requests/[id]/review` مع Cookie/Bearer وCORS لمعاينة Flutter. أضيفت ترجمات الويب الجديدة للغات الخمس إلى جانب العربية، ونجح حارس الترجمة `2492 × 5`.
- نجح TypeScript وESLint والبناء الإنتاجي وحارس بصمات `73` migration و`git diff --check`. تحليل Flutter بلا أخطاء مع ملاحظتي `info` قديمتين. نُشرت المنصة بالإصدار `dpl_6gtiTHba8V9ZGEkaP1Hy9jqQqD3Y` وربطت بـ`https://www.buniahksa.com`؛ أعاد المساران الجديدان `401` دون جلسة كما يجب، وأعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090` بحالة `200`.

### إصلاح اسوداد صورة المنتج بعد اعتماد التعديل — 2026-08-31

- أثبت الفحص المباشر أن صورة المنتج المعتمد في Storage سليمة: JPEG بأبعاد `447×447`، ويعيد كل من رابط الأصل والتحويل المصغر `200 image/jpeg` وبكسلات فعلية غير سوداء. لم يكن الخلل تلفًا في الملف أو فقدانًا لمساره.
- سبب الخلل أن اعتماد طلب التعديل يعيد إنشاء سجل `product_images` للنسخة المقترحة بمعرف جديد مع إبقاء `storage_path` نفسه للصورة المحتفظ بها، بينما كان Flutter يستخدم المسار وحده مفتاحًا لـ`CachedNetworkImage`؛ فأعاد سطح صورة قديمًا تالفًا/أسود بعد تحديث البيانات.
- أصبح مفتاح كاش الصورة يجمع مسار التخزين ومعرف سجل الصورة، ورُفع إصدار مفاتيح العرض إلى `v3`. أضيف `cacheNonce` مستقل للأصل والنسخة المصغرة، واستُبدلت دالة توقيع الروابط المتعددة المهملة بـ`createSignedUrlsResult` مع معالجة الملفات المفقودة صراحة.
- نجح تنسيق Dart والتحليل دون أخطاء؛ بقيت ثلاث ملاحظات `info` قديمة وغير مرتبطة. أُعيد تشغيل Flutter Web على `http://127.0.0.1:8090`، وأكد الفحص البصري أن بطاقة «بلك احمر هوردي» تعرض صورة البلك الحقيقية بدل المساحة السوداء. لم يُبن APK جديد لأن المهمة لم تطلب إصدار Android جديدًا.

### إرسال رمز توثيق العميل داخل التسجيل مباشرة — 2026-08-31

- أثبت فحص أحدث حساب جديد أن إنشاء Auth نجح، لكن لم يوجد أي صف في `phone_verification_challenges` ولا محاولة `auth.phone_verification` في سجل المزود؛ أي أن Green API لم يتلق طلبًا أصلًا. السبب سباق في Flutter: التسجيل كان ينشئ الحساب ويسجل الدخول ثم ينتظر شاشة ثانية لإرسال الرمز، فتبدل جذر التطبيق إلى شاشة التوثيق العامة قبل نقل رقم التسجيل وظهر الحقل فارغًا.
- استُخرج إصدار رمز التحقق وإرساله في خدمة خادم مشتركة `phone-verification-delivery.ts`. أصبح `/api/auth/register` يفحص توفر الرقم على واتساب بالتوازي مع فحوص التعارض، ثم ينشئ الحساب والتحدي ويرسل الرمز مباشرة عبر المسار العاجل قبل إعادة `201`. لا يعتمد التسجيل على Cron أو Outbox، وإذا فشل الإرسال يتراجع الخادم عن الحساب الجزئي حتى يستطيع العميل إعادة التسجيل بلا بريد عالق.
- أصبح الويب وFlutter يقرآن `verificationSent` من استجابة التسجيل وينتقلان مباشرة إلى خانة إدخال الرمز من دون طلب إرسال ثانٍ. يحتفظ مستودع Flutter مؤقتًا برقم التسجيل وحالة الإرسال أثناء تبدل جلسة Auth حتى لا تعود شاشة الجوال فارغة.
- حالة Green API الحية `authorized`، وفحص واتساب أعاد نتيجة متاحة. نجح اختبار إنتاجي كامل قابل للتنظيف: HTTP `201`، `verificationSent=true`، تحدٍ واحد، وسجل WhatsApp بحالة `submitted` بلا خطأ خلال نحو `4.5` ثوانٍ من بدء التسجيل؛ حُذف حساب الاختبار وتحديه وسجل مزوده بعد الفحص.
- نجح TypeScript وESLint وبناء Next.js وحارس الترجمة `2502 × 5`. تحليل Flutter بلا أخطاء مع خمس ملاحظات `info` قديمة في الملفات الواسعة. نُشرت النسخة `dpl_6ZcXugahhEC1B76xeEJaQsYGv8TW` وربطت بـ`https://www.buniahksa.com`، وأعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090` بحالة `200`. لم يُبن APK جديد.
## 2026-08-31 — Mobile RFQ submission validation feedback

- Diagnosed the apparently unresponsive Flutter RFQ submit action: validation was rejecting the request (the reported screenshot has an empty required site working-hours field), while the error was sent to a `SnackBar` hidden behind the modal bottom sheet.
- `QuoteRequestReviewSheet` now renders both validation and server errors in an accessible inline error panel immediately above the fixed submit button.
- The site working-hours field is explicitly labelled as required. No database request was created by the failed attempt.

## 2026-08-31 — Structured RFQ receipt scheduling

- Replaced free-text receipt timing in the Flutter RFQ review with native calendar/time pickers: required receipt date, required receipt time, site reception start, and site reception end. The mobile UI shows tappable schedule tiles and an automatic summary, validates that receipt is more than two hours ahead, and prevents an end time earlier than the start time.
- Added the matching structured date/time and reception-window controls to the public Next.js storefront and the authenticated customer RFQ form. Pending drafts now retain `siteHoursStart` and `siteHoursEnd` while continuing to submit the existing `working_hours` snapshot (`من HH:mm إلى HH:mm`) to the database, so no migration is required.
- Verification: targeted Flutter analysis completed without errors (only existing info notices); TypeScript, targeted ESLint, `git diff --check`, and the Vercel production build passed. Flutter Web was restarted on `http://127.0.0.1:8090`. Web deployment `dpl_5ySdy2zYtcR4sEJ37HSd3q4hZmuZ` is ready and aliased to `https://www.buniahksa.com`.

## 2026-08-31 — فتح طلب تسعير تجريبي لشركة بيك

- الطلب `RFQ-20260830-EA9A0ABB` مستهدف حصريًا إلى المزود المعتمد «شركة بيك للتطوير العقاري» (`+966508623570`) لصنف «بلك احمر هوردي»؛ لم تُضف أي جهة أخرى.
- فُتحت نافذة التسعير فورًا لمدة ثلاث ساعات، ووُحّدت مواعيد الإغلاق في طلب العميل وطلب التوريد وهدف المزود.
- أُنشئ وأُرسل حدث `provider.rfq_new` جديد بنجاح عبر الموزع (`processed`, محاولة واحدة، بلا خطأ)، وصُحح رابط إشعار المزود الحالي ليفتح تفاصيل الصنف مباشرة.
- أضيف `actionUrl` المباشر إلى معالجة أحداث RFQ للمزود في الموزع حتى لا يستبدل رابط الإشعار الصحيح مستقبلًا برابط صفحة الإشعارات العام. التحقق المستهدف بـ ESLint والبناء الإنتاجي نجح، ونُشر الإصدار `dpl_GnEGTL2YQG145d9QxsVdbFZYaG7n` وربط بـ`https://www.buniahksa.com`.
- رحلة ما بعد التسعير موجودة: تجميع عرض العميل، قبول العرض ثم الانتقال إلى صفحة Paymob، إنشاء أوامر التوريد بعد webhook نجاح الدفع، ثم إضافة/تعيين السائق وإشعار العميل. وقت هذا التحديث لم يكن المزود قد أرسل سعرًا بعد.

## 2026-08-31 — اعتماد سعر شركة بيك وإرسال عرض الاختبار

- استلم الطلب `RFQ-20260830-EA9A0ABB` رد المزود `RSP-160A633D2F`: سعر الوحدة `5.10` ريال شامل الضريبة، الكمية `1` متوفرة، ورسوم التوصيل `0`.
- بناءً على طلب الإدارة أُغلقت مهلة هذا الطلب فقط فورًا، واعتمد رد شركة بيك نهائيًا، وأنشئ اختيار التوريد وعرض العميل `BQ-4119FDD1E8` بإجمالي `5.10` ريال (`4.43` قبل الضريبة + `0.67` ضريبة) وصلاحية 48 ساعة.
- انتقل طلب العميل من `sourcing` إلى `quote_ready`، وطلب التوريد إلى `sent_to_customer`. أُرسل حدث `customer.quote_ready` بنجاح من أول محاولة بلا خطأ، وصُحح إشعار العميل الحالي لفتح `/customer/quotes/dd3a979f-e458-490b-b0ce-61a041512931` مباشرة.
- أضيف رابط عرض العميل المباشر إلى موزع جميع أحداث عروض العملاء حتى لا يُستبدل مستقبلًا برابط إشعارات عام. نجح ESLint والبناء الإنتاجي، ونُشر الإصدار `dpl_GcfbMH9G8hk4iwYmc377x8uHeuCC` وربط بـ`https://www.buniahksa.com`.

## 2026-08-31 — إخفاء عداد المنافسة بعد جاهزية العرض

- سبب ظهور عداد الثلاث ساعات بعد اعتماد السعر أن شاشة Flutter كانت تعرضه اعتمادًا على تواريخ نافذة التسعير فقط، ولم تربطه بوجود عرض نهائي. كما لم تكن حالتا `quote_ready` و`customer_review` معرفتين في شارة الحالة أو مؤشر المراحل، لذلك ظهرت «قيد المعالجة» رغم جاهزية العرض.
- أصبحت شاشة تفاصيل الطلب تعتبر وجود `bunya_customer_quotes` نهايةً للمنافسة: تخفي بطاقة العداد ونص موعد التسعير، تعرض «العرض النهائي جاهز»، وتحرك مؤشر المتابعة إلى «العرض النهائي». أضيفت تسميات صريحة لـ`quote_ready` و`customer_review`.
- طُبق السلوك نفسه في الويب: بطاقات القائمة لا تعرض العداد إلا لحالات التسعير الفعلية، وصفحة التفاصيل تعرض «أُغلقت المنافسة واعتمد العرض النهائي» وتزيل شرح وعداد نافذة المزودين عند وجود العرض.
- نجح تنسيق وتحليل Flutter دون أخطاء (خمس ملاحظات `info` قديمة)، ونجح ESLint وTypeScript والبناء الإنتاجي. أُعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090`، ونُشر الويب بالإصدار `dpl_2vLT4yfPhwctfsXbxytnsP4YK3oA` وربط بـ`https://www.buniahksa.com`.

## 2026-08-31 — زر اعتماد العرض والدفع في بطاقة Flutter

- كانت بطاقة `_OfferCard` في واجهة العميل تعرض إجمالي العرض وصلاحيته فقط، بينما إجراء Paymob موجود في وحدة مساحة العمل المنفصلة؛ لذلك لم يظهر أي زر في شاشة تفاصيل الطلب المصورة.
- أضيف معرّف عرض العميل إلى `QuoteOfferDetail` وربطت البطاقة بخدمة الدفع الموجودة `WorkspaceRepository.startQuotePayment`. يظهر الآن زر واضح بارتفاع لمس مناسب بعنوان «اعتماد العرض والمتابعة للدفع»؛ يعتمد العرض أولًا للحالات `ready/customer_review` ثم يطلب Paymob Intention ويفتح صفحة الدفع الخارجية الآمنة.
- أضيفت حالات تحميل وتعطيل عند انتهاء الصلاحية ورسالة خطأ مرئية. أصبح بدء الدفع يعيد قراءة حالة العرض قبل الاعتماد، حتى تكون إعادة المحاولة آمنة إذا تم الاعتماد وحدث فشل مؤقت عند فتح Paymob.
- نجح تنسيق وتحليل Flutter دون أخطاء (ملاحظات `info` قديمة فقط)، وأُعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090`. لم يُبن APK جديد لأن المستخدم لم يطلب إصدار Android جديدًا.

## 2026-08-31 — إصلاح فشل فتح Paymob من Flutter المحلي

- قبول العرض `BQ-4119FDD1E8` نجح بالفعل وأنشأ الطلب `ORD-20260830-82A03FEE` والفاتورة `INV-394ED5BA7E` وسجل دفع `pending` بقيمة `5.10` ريال؛ الفشل حدث بعد ذلك عند طلب جلسة Paymob.
- السبب المباشر أن Flutter Web المحلي كان مشغلًا بـ`APP_URL=http://localhost:3001` بينما المنفذ مغلق، والمنصة المحلية الفعلية تعمل على `3000`. كما أن مفاتيح Paymob موجودة في بيئة Vercel الرسمية وليست في `.env.local`، لذلك لا ينبغي تنفيذ جلسة الدفع من خادم التطوير غير المهيأ.
- أُعيد تشغيل Flutter Web على `http://127.0.0.1:8090` مع توجيه API إلى `https://www.buniahksa.com`. فحص CORS الرسمي أعاد `204` وسمح صراحة بالأصل المحلي وطلبات `POST` مع Authorization.
- أصبح فتح Paymob في Flutter Web يستخدم نفس التبويب (`_self`) لتجنب حظر النوافذ المنبثقة بعد الطلب غير المتزامن، بينما يحتفظ Android/iOS بالفتح الخارجي. وبعد قبول العرض يتغير نص الزر إلى «الدفع الآمن عبر Paymob» بدل طلب قبول العرض مرة أخرى.
- نجح تنسيق وتحليل Flutter دون أخطاء؛ بقيت ملاحظات `info` قديمة فقط.

## 2026-08-31 — إعادة العميل إلى Flutter بعد Paymob

- سبب انتقال تجربة Flutter Web إلى شاشة دخول المنصة بعد Paymob أن `redirection_url` كان دائمًا صفحة الدفع الرسمية على الويب، بصرف النظر عن الواجهة التي بدأت العملية. جلسة الدفع التجريبية بقيت `pending` وبداخلها رابط الرجوع القديم.
- أصبح Flutter Web يرسل عنوان رجوعه الحالي مع `quoteId`. تقبل API فقط الأصلين المحليين الموثوقين `http://127.0.0.1:8090` و`http://localhost:8090`، وتعيد صياغته إلى جذر التطبيق مع `payment=returned` و`quote=<id>`؛ أي قيمة أخرى تُستبدل بالرابط الرسمي، لمنع open redirect.
- خُزّن رابط الرجوع داخل Paymob session. لا تعاد استخدام جلسة pending قديمة إلا إذا كان رابط رجوعها مطابقًا؛ لذلك المحاولة التالية تنشئ Intention جديدة تعود للتطبيق بدل إعادة استخدام جلسة الويب القديمة.
- يفتح Flutter Web الدفع في التبويب نفسه ثم يرجع لنفس أصل التطبيق مع بقاء جلسة Supabase، بينما تبقى واجهات الجوال الأصلية على سلوك الفتح الخارجي الحالي إلى حين تفعيل deep links/embedded checkout لإصدارات Android وiOS.
- نجحت فحوص Flutter وESLint وTypeScript والبناء الإنتاجي. نُشرت API بالإصدار `dpl_982Db2Edu5fW8LYhtt1j6jUnPRZC` وربطت بـ`https://www.buniahksa.com`، وأُعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090`.

## 2026-08-31 — مالية المزودين وأرباح بُنية

- أضيف قسم إدارة «المالية والأرباح» في الويب وتطبيق Flutter. يعرض لكل مزود إجمالي قيمة التوريد، عمولة بُنية، صافي المستحق، الرصيد الموجود لدى المنصة، المبالغ المحجوزة للتسوية والمتاح للصرف، مع ملخص إجمالي لأرباح المنصة.
- أضيفت نسبة عمولة مستقلة لكل مزود (`providers.platform_commission_rate`) قابلة للتعديل فقط لمن يملك صلاحية `finance.manage`. كل تغيير يسجل في `audit_logs` بالقيمة السابقة والجديدة.
- طُبقت migrations `074_provider_commissions_and_finance_dashboard.sql` و`075_order_provider_financial_ledger_entries.sql`. عند نجاح الدفع ينشأ تلقائيًا قيد إجمالي توريد ثم قيد عمولة منفصل في `financial_transactions`، وتُحفظ نسبة العمولة وعمولتها كلقطة داخل metadata حتى لا تتغير العمليات السابقة عند تعديل النسبة لاحقًا. عند تحويل تسوية مزود ينشأ قيد صرف سالب تلقائيًا.
- عولجت أوامر التوريد المدفوعة السابقة آليًا. التحقق المباشر أثبت أن شركة بيك للتطوير العقاري لديها عملية واحدة بإجمالي `5.10` ر.س ورصيد `5.10` ر.س؛ النسبة الابتدائية الآمنة لكل مزود هي `0%` حتى تعتمد الإدارة نسبته.
- نجح بناء Next.js وTypeScript وESLint وحارس بصمات `75` migration وSupabase DB lint (بقيت تحذيرات قديمة في دوال المقاولين ومراجعة تعديل المنتج). تحليل Flutter بلا أخطاء مع ملاحظة `info` قديمة واحدة. نُشرت النسخة `dpl_6ax9RmWuMxD2LnKwqE3zn1qvvpXW` وربطت بـ`https://www.buniahksa.com`، وأُعيد تشغيل Flutter Web المحلي على `http://127.0.0.1:8090`. لم يُبن APK جديد.

## 2026-08-31 — نسخة Android ARM64 الخفيفة 1.0.2

- رُفع إصدار Flutter إلى `1.0.2+3` وبُني APK Release مخصص لمعمارية `arm64-v8a` فقط، مع فصل المعماريات وتشويش Dart وفصل رموز التصحيح وتصغير أيقونات Material. يستخدم التطبيق إعدادات Supabase العامة الفعلية و`APP_URL=https://www.buniahksa.com`.
- ملف التسليم هو `artifacts/Buniah-Android-arm64-v1.0.2.apk`، ونسخة التنزيل المطابقة في `public/downloads/Buniah-Android-arm64-v1.0.2.apk`. الحجم `21,054,986` بايت (نحو `20.1 MB`) وبصمة SHA-256 هي `60735DB483C86EE562F30789AA5F445006723BA8D02AC2E73696475EE7B7DCFB`.
- تحقق `aapt` من الحزمة `com.buniahksa.app` والإصدار `1.0.2` ورقم البناء `2003` والمعمارية `arm64-v8a`، وتحقق `apksigner` من توقيع APK Signature Scheme v2. الإصدار موقع حاليًا بمفتاح الاختبار الموجود في المشروع، ومخصص للتثبيت المباشر والتجربة وليس للنشر في Google Play.

## 2026-08-31 — إصلاح رفض طلب السعر للحساب الموثق متعدد الأدوار

- كان `submit_customer_rfq` يتحقق من وجود سجل `customer_profiles` فقط. مسار توثيق الجوال السابق كان ينشئ هذا السجل عند غياب الدور بالكامل، لكنه لا ينشئه لحساب موثق له دور أساسي جاهز مثل المزود؛ لذلك ظهر خطأ «يجب توثيق حساب العميل» رغم نجاح توثيق الجوال.
- migration `076_verified_customer_account_repair.sql` تجعل `initialize_customer_account` تتحقق من `auth.users.phone_confirmed_at` ثم تضيف قدرة العميل دون تغيير الدور الأساسي، وتجعل `submit_storefront_rfq` يصلح الربط تلقائيًا قبل إرسال الطلب. أصلحت migration كل الحسابات الموثقة القائمة التي ينقصها هذا الربط.
- الحساب المتأثر `ct***@gmail.com` أصبح يملك دور المزود الأساسي ودور العميل الإضافي، ولم تُعدّل أي طلبات أو عروض معتمدة. عدّل مسار إكمال توثيق الجوال ليهيئ قدرة العميل دائمًا بعد نجاح التوثيق حتى لا يتكرر الخلل.
- طُبقت migration على الإنتاج، ونجح DB lint وحارس بصمات `76` migrations وESLint وبناء Vercel. نُشر الإصدار `dpl_GWdtqqmxgmeUX8ea5mxbcDL7n53F` وربط بـ`https://www.buniahksa.com`.

## 2026-09-01 — إعادة تشغيل Flutter Web المحلي

- أُوقف خادم Flutter Web السابق على المنفذ `8090` وأُعيد تشغيله بنجاح مع `APP_URL=https://www.buniahksa.com`. تحقق طلب HTTP محلي من استجابة `200` على `http://127.0.0.1:8090`.

## 2026-09-02 — بوابة جودة الويب وFlutter قبل المتاجر

- نجح بناء Next.js `16.3.4` وTypeScript وESLint بلا أخطاء أو تحذيرات، وفحوص SQL والعقود والمسارات وبصمات 80 migration. يغطي التحقق الثابت 157 جدولًا و149 دالة و360 سياسة، و75 صفحة و35 API handler وخمس بوابات أدوار محمية.
- أضيف فحص Playwright عام قابل للتكرار لتسعة مسارات على 1440×900 و390×844. يتحقق من overflow والصور والعناوين وأسماء الأزرار وأخطاء المتصفح وHTTP 5xx وأهداف لمس الجوال وعدم تداخل مبدّل اللغة. أضيف فحص اللغات الست واتجاه RTL/LTR؛ نجحت الاختبارات الثلاثة.
- أصلحت ألوان foreground المخالفة للهوية، أحجام التحكم ومساحة أسفل نماذج الانضمام، تحذير WebGL، وملاحة Next.js الداخلية. اكتملت تغطية 2649 نص واجهة لكل من اللغات الخمس الإضافية، مع بقاء المراجعة البشرية القانونية واللغوية شرطًا قبل المتاجر.
- نجح `dart format` و`flutter analyze` بلا ملاحظات، ونجحت خمسة اختبارات Flutter جديدة للغات والاتجاه ومبدّل اللغة والثيم وأحجام التحكم.
- كشف الفحص البصري أن بناء Flutter Web الأول تم دون تعريفات الاتصال وكان يعرض شاشة نقص الإعداد. أُعيد بناء Web release بإعدادات Supabase العامة و`APP_URL` الصحيح، ثم اجتاز الفحص البصري على سطح المكتب والجوال والتمرير بلا أخطاء. أضيف `tool/build-web.ps1` لمنع تكرار البناء الناقص.
- أُعيد بناء Android App Bundle بالطريقة نفسها عبر `tool/build-appbundle.ps1` ونجح بحجم يقارب 54 MB. ما زال موقعًا بشهادة Android Debug؛ لا يصلح للرفع إلى Google Play حتى إنشاء release keystore وربط Gradle وإعادة البناء.
- اعتماديات تشغيل npm بلا ثغرات معروفة بعد ترقية Next.js وSharp وNanoid. بقيت ثلاث ملاحظات متوسطة داخل أداة Capacitor التطويرية المتعدية؛ الإصلاح الآلي المقترح كاسر ويخفض الإصدار الرئيسي، لذلك لم يطبق.
- لم يُشغّل E2E المتصل المغير للبيانات على الإنتاج لعدم وجود staging أو Supabase محلي، ولم تُختبر الأجهزة الأصلية لعدم وجود Android/iPhone أو محاكي. كذلك ما زال إعداد Firebase/APNs وApple signing/Sign in with Apple والدفع التجريبي الكامل متطلبات خارجية مانعة للاعتماد النهائي.
- التفاصيل والقرار الحالي موثقان في `docs/RELEASE_CERTIFICATION_2026-09-02.md`. لا يحتوي المرجع أو التقرير على كلمات مرور أو مفاتيح أو رموز جلسات.

## 2026-09-04 — إعادة تصميم كتالوج المنتجات بهوية بُنية

- أعيد تنظيم صفحة المنتجات في واجهة Next.js وتبويب المنتجات في Flutter ككتالوج مشتريات سريع مستلهم من نمط الأسواق المبوبة من دون نسخ هوية «حراج غزة»: بحث رئيسي، تصنيفات أفقية، منطقة التوفر، فلاتر التوصيل والتوفر والمنتجات الجديدة، وتبديل بين العرض الشبكي والقائم، بألوان بُنية الخضراء والنحاسية والرملية.
- أضيف للويب شريط تصنيفات جانبي على الشاشات الواسعة مع أعداد المنتجات وفلاتر سريعة، وحالة فراغ واضحة، وبطاقات منتجات أكثر كثافة. بقيت رحلة العمل الأصلية كما هي: فتح مواصفات المنتج وتجميع المنتجات في طلب عرض سعر واحد، لا تواصل مباشر مع بائع.
- أصبح كتالوج Flutter متجاوبًا باستخدام حد أقصى لعرض البطاقة بدل عمودين ثابتين؛ لذلك لا تتمدد بطاقة المنتج على كامل متصفح سطح المكتب. أضيف عرض قائم مناسب للجوال والويب وحالة فراغ قابلة لإعادة الضبط.
- بعد مراجعة شاشة حساب المزود، أصبح الكتالوج هو «الرئيسية» الفعلية في Flutter للعملاء والمزودين والمقاولين، ونُقلت لوحة الاختصارات السابقة للعملاء إلى تبويب «الخدمات». بذلك يظهر التصميم الجديد فور فتح التطبيق حتى داخل حساب مزود مثل شركة بيك، بدل بقائه خلف زر «مواد البناء».
- خُففت أحجام وأوزان النصوص في الكتالوج على Flutter والويب لتتبع الإيقاع البصري المدمج في مرجع حراج فلسطين مع الحفاظ على خط وألوان بُنية: عنوان الجوال 20px، بحث 13px، وفلاتر وتصنيفات قرابة 11px. أصبح العرض القائم المدمج هو الافتراضي على الجوال، واختُصر تبديل العرض إلى زر واحد بمقاس لمس آمن.
- فُعّل مرشح «كل المناطق» في كتالوج Flutter والويب بقائمة مناطق المملكة العربية السعودية الإدارية الـ13، مع ضم أي مدن أو نطاقات إضافية مسجلة على المنتجات. اختيار المنطقة يرشح المنتجات فعليًا، واختيار «كل المناطق» يعيد إظهارها جميعًا.
- لا تتضمن المهمة تغييرات قاعدة بيانات أو Supabase أو RLS أو مفاتيح. نجح `flutter analyze`، واختبارات Widget المخصصة للبحث وتبديل العرض وحد عرض البطاقة ومرشح المناطق، وTypeScript وESLint وفحص ألوان الواجهة و`git diff --check`. راجعت واجهتي الويب وFlutter بصريًا على خادمي التطوير المحليين؛ Next.js على `http://localhost:3000` وFlutter Web على `http://127.0.0.1:8090`.

### إصلاح عودة اسوداد صور المنتجات بعد التنقل

- استمرار المستطيل الأسود بعد التنقل أو تغيير خيارات الكتالوج لم يكن تلفًا في صورة المنتج ولا خطأ Runtime؛ كان مسار Flutter Web ما يزال يفك الصورة داخل سطح الرسم/الكاش الرسومي، ولذلك لم يمنع تغيير مفتاح الكاش وحده عودة الـtexture السوداء عند إعادة بناء الواجهة.
- أصبح `FastProductImage` على Flutter Web يستخدم `Image.network` باستراتيجية `WebHtmlElementStrategy.prefer` لعرض الصورة عبر عنصر المتصفح وإخراج دورة رسمها من الكاش الرسومي المسبب للمشكلة. بقي `CachedNetworkImage` على Android وiOS، وبقي الرجوع التبادلي بين رابط الأصل والصورة المصغرة وحالة الخطأ الرملية.
- نجح `flutter analyze` وثلاثة اختبارات Widget. بعد hot restart وإعادة تحميل الواجهة ظهر مكان الصورة بلون التحميل الرملي ثم ظهرت صورة «بلك احمر هوردي» سليمة، وتكرر ذلك بعد إعادة الدخول دون مستطيل أسود أو أخطاء Runtime. لم يُبن APK جديد.
