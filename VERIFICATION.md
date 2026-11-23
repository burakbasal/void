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
- `/robots.txt` and `/sitemap.xml` resolve and point to `https://void-deh.pages.dev`.
- Canonical metadata and generated Open Graph/Twitter images resolve to the `void-deh.pages.dev` origin.
- Command completion resolves `/members`, `/topic`, `/kick`, `/invite`, and `/rooms`.
- Guest `/help` now lists account, room, and messaging commands with a note that rooms require login.

A Supabase public URL and publishable key were supplied later and installed only in the ignored local `.env.local`. The static export was rebuilt against that project: the bundle embeds the intended backend, the app no longer reports “backend not configured”, and the generated CSP restricts `connect-src` to that exact HTTPS/WSS origin. A live two-account browser test still requires confirmation-enabled email accounts or an authenticated backend reset path.

## External status

- GitHub: pending authenticated CLI approval. The repository is initialized locally on `main`; no remote or public visibility change has been completed yet.
- Cloudflare: authenticated via the Wrangler device flow, the `void` Pages project was created, and the static export was deployed with `wrangler pages deploy out --project-name=void --branch=main`. The production URL is `https://void-deh.pages.dev`; the deployment reached `https://ccc95d28.void-deh.pages.dev` and the live production origin returned the VOID terminal HTML. The requested `https://void.pages.dev` name is globally held by another Cloudflare account, so Cloudflare assigned the `void-deh` suffix. `.github/workflows/deploy.yml` remains prepared for automated redeploys once repository secrets are present.
- Supabase: project `rxanzkiooragcgqilbxx` is reachable. Application tables are present, but the required public RPC functions (`room_directory`, `create_room`, `update_room_topic`, `remove_from_room`, `open_dm`) are not reachable with the publishable key. Applying/reloading the migration requires a real database password or a Supabase access token; the supplied password was a placeholder, the database host resolves only to an unreachable IPv6 address from this environment, and no dashboard session was available.

The site is publicly reachable at the assigned `void-deh.pages.dev` address, but the exact `void.pages.dev` address was not obtainable with this Cloudflare account. The GitHub repository is not yet public.
