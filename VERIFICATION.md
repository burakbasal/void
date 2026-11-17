# VOID verification

Verified on 17 November 2026 against a dedicated hosted Supabase project and a locally running Next.js application. No website was deployed publicly.

## Automated checks

- TypeScript: passed.
- Production build: passed.
- Command parsing, validation, and error-redaction unit tests: 16 passed.
- PostgreSQL migration and RLS assertions using PGlite: 33 passed. The Auth/Realtime schemas in this isolated SQL harness are stubs; it does not establish transport behavior.
- Real Supabase integration assertions: 91 passed. These exercised authenticated API access, private-room permissions, message persistence and delivery, online presence, typing, password changes and login, and concurrent rate limits.
- Dependency audit: zero known vulnerabilities at verification time.
- Secret hygiene: administrative and temporary test credentials absent from staged source and production browser bundles.

The live test found and fixed a Realtime startup race. The application waits for PostgreSQL change subscriptions to become active before reporting a live connection and reconciling saved history.

## Browser checks

Verified the running development and production builds in Chrome, including command help/completion, step-by-step login, invalid credentials, registration validation/cancellation, profile edits, public-room discovery, private-room invisibility and denied joins, invitations, two-way room messages and DMs, presence, typing, message history after reload, inbox, leaving/revoked access, owner deletion, and logout. No browser console errors were observed during the final production check.

The mobile viewport was verified at 390 × 844 with no horizontal overflow. The interface uses dynamic viewport height, a persistent command prompt, and 16px mobile input text.

Three disposable real Auth accounts were used for testing. They and their related profiles, rooms, messages, and credentials were removed and their absence verified. Existing user accounts were preserved. The running application contains no seeded/demo conversations or fallback backend.

## Remaining operational limits

Custom SMTP is intentionally deferred for this local-only setup. Supabase's default email service restricts confirmation and recovery email to organization team addresses. Registration validation and cancellation were exercised in the browser; the external confirmation/recovery email roundtrip was not independently verified. Configure custom SMTP before accepting users with other email addresses.

Private-channel presence authorization is cached by Supabase until reauthorization/reconnection; database RLS remains authoritative for every persisted message. Presence is an activity hint. Stored messages are not end-to-end encrypted.

The optional live integration runner requires either an administrative key for disposable test-account lifecycle management, or a private external fixture manifest with lifecycle handled separately. It is not run against a production database by CI.
