# Opening an unmatched project to contractor offers

Migrations 113 and 114 are live. On November 24 the requested project was published without a submission cutoff and verified for all six eligible contractor accounts.

`publish_open_project_opportunities(uuid)` requires an active administrator with `projects.manage`. It converts an open, exhausted request without previous invitations into a listing with no submission deadline. Repeating the command is safe. Eligible contractors see the project through their opportunities page. Newly approved accounts are added on subsequent search-worker passes.

Contractors use the existing opportunity list and proposal form. Published project fields retain the existing safe RPC projection: no customer identity/contact fields. Multiple contractors can submit offers independently. The customer continues reviewing offers in sequence; rejection/expiry advances to the next valid offer. Award closes the request and further submissions; pause/resume and requested revisions remain supported. Existing automatic matching remains the default for every other project.

## Verification

`tests/contractor-project-search-sql.mjs` executes actual migrations092 and113 in isolated PGlite.23 scenarios cover existing sequential behavior, admin-only opt-in, no messages on publication, mismatched contractor access, excluded accounts, multiple submissions, draft/revision flows, rejection/award, pause/resume, expired/revoked offers, ownership, private helpers and enrollment of newly approved contractors. SQL static validation and immutable migration hashes also pass. Exact inputs, runtime, execution times and logs: `tmp/open-project-evidence.json`. No UI/source deployment or browser inspection is needed for this RPC-compatible change.

## Historical rollout of migration 113 (superseded by 114 for deadlines)

1. Complete the pending CLI browser-login session using the account with buniah project access; verify the linked project independently.
2. Read current function definitions/permissions, requested project state/deadline, opportunity/proposal counts and security advisors. Compare current functions to migration092 before replacement; investigate any drift.
3. Rehearse113 inside a transaction and roll it back, without publishing a real project or generating business records.
4. Apply ONLY113 and record its migration history.104 and112 are independent pending work and must not be swept into this action.113 does not require112.
5. Revalidate the requested project and invoke `publish_open_project_opportunities` under the authorized administrator identity. If its deadline has elapsed, resolve a new deadline with the owner before extending it.
6. Verify the existing opportunity RPC under approved and excluded contractor identities, publication audit, unchanged project requirements and zero new outbound events from publication. Do not submit real test proposals or send messages.

No credentials, login URLs/codes or private customer details belong in this document.
