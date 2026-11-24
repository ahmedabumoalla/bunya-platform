<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Persistent project context

Before starting any task, read `PROJECT_REFERENCE.md` in the repository root. Update it when a task is completed, a defect is diagnosed/fixed, or an architectural/operational decision is made. Never store credentials, access tokens, passwords, or session secrets in it.

## Execution efficiency

- Implement requested changes directly with the smallest practical file and command scope.
- Avoid broad repository scans, repeated reviews, browser checks, builds, and test suites unless they are necessary to diagnose the reported defect or explicitly requested.
- Prefer one targeted verification proportional to the change. Do not rebuild Android/iOS artifacts unless the user explicitly requests a new build.
- Keep progress updates and final responses concise, and never delay delivery for optional polish or speculative checks.

## Deployment size

Run `node scripts/check-deployment-size.mjs` before every production push. Keep the guard in both the package and Vercel build commands and in the GitHub workflow. Never remove, disable or bypass it or raise limits to ship. End every deployment report with the guard result and measured build time. If a deployment exceeds five minutes, stop releasing and investigate.

On 2026-11-24 the local Next.js production traces covered 163 routes, with 89 MiB largest and 980 MiB combined. The configured ceilings are 134 MiB per route and 1,470 MiB combined. The PDF renderer bundles its logo under `src/lib/quotes/assets` because Next.js applies public-file excludes after includes.

## Page speed

Run `node scripts/speed-guard/check.mjs` before pushing and include the result in the deployment report. Keep the postbuild weight check, production Lighthouse audit and ten-minute GET monitor enabled. Update measured baselines only after the user accepts the growth and record the reason. Exclude BrandaSpeedGuard and Chrome-Lighthouse visits from any new visit tracker before measuring that page.
