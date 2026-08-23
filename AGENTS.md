<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Persistent project context

Before starting any task, read `PROJECT_REFERENCE.md` in the repository root. Update it when a task is completed, a defect is diagnosed/fixed, or an architectural/operational decision is made. Never store credentials, access tokens, passwords, or session secrets in it.

## Execution efficiency

- Implement requested changes directly with the smallest practical file and command scope.
- Avoid broad repository scans, repeated reviews, browser checks, builds, and test suites unless they are necessary to diagnose the reported defect or explicitly requested.
- Prefer one targeted verification proportional to the change. Do not rebuild Android/iOS artifacts unless the user explicitly requests a new build.
- Keep progress updates and final responses concise, and never delay delivery for optional polish or speculative checks.
