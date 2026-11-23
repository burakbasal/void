# VOID verification

Current checkout verified on 23 November 2026. The canonical source was `C:\Users\devbu\Downloads\void-main.zip`; an earlier static scaffold was removed before this work.

## Automated checks

- `npm run check` — TypeScript passed.
- `npm test` — 38 unit tests passed (tokenization, command parsing and help coverage, group creation forms, formatting, message routing, validation, error redaction, static-export header hardening).
- `npm run test:sql` — 56 SQL/RLS assertions passed against the committed migration in PGlite. Auth and Realtime schemas are stubs in this harness; hosted transport is not verified here.
- `npm run build` — production static export passed.
- `npm audit` — zero known vulnerabilities.
- Secret hygiene — no hardcoded API keys, service-role keys, passwords, or `.env.local` in tracked source.

Group coverage includes private/public room creation with explicit or shorthand topics, directory visibility and counts, member listing formatting, owner topic changes, realtime topic updates scoped to the open room, realtime deletion of the open room, history preservation across metadata updates, invitations, owner-only removal, membership revocation, two-way group history, topic authorization, and nonmember denial. The optional hosted runner in `tests/database.integration.mjs` additionally checks real Supabase Auth, Realtime delivery, presence, typing, and concurrency when credentials are supplied.

## Browser checks

The Cloudflare-shaped static preview from `out` was checked in Chromium:

- Lighthouse accessibility 1.00, best practices 1.00, SEO 1.00.
- No console errors and no CSP violations.
- Generated `_headers` uses hash-based CSP with no `unsafe-inline`; security headers and HSTS are present. With a backend URL at build time, `connect-src` is limited to that exact HTTPS/WSS origin.
- `/robots.txt` and `/sitemap.xml` resolve and point to `https://void.pages.dev`.
- Canonical metadata and generated Open Graph/Twitter images resolve to the `void.pages.dev` origin.
- Command completion resolves `/members`, `/topic`, `/kick`, `/invite`, and `/rooms`.
- Guest `/help` now lists account, room, and messaging commands with a note that rooms require login.

A live two-account Supabase browser test was not repeated in this environment because no Supabase project URL/key was supplied. The app reports “backend not configured” rather than simulating data.

## External status

- GitHub: `https://github.com/burakbasal/void` was not reachable through the public web/API, and no GitHub CLI token was available. The repository was initialized locally on `main` with clean source, but no remote was created and public visibility was not changed.
- Cloudflare: no API token or account ID was available. `.github/workflows/deploy.yml` and `wrangler.toml` are prepared for the free `void` Pages project targeting `https://void.pages.dev`; the workflow skips safely until required secrets exist.
- The global Pages subdomain name `void` can only be confirmed by an authenticated Cloudflare account. If it is already taken, an owned domain or another project name is required.

No claim in this document should be read as the site being publicly deployed or the GitHub repository being public.
