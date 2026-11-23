# VOID

A keyboard-first, real-time messaging terminal built with Next.js, TypeScript, Tailwind CSS, and Supabase Auth, PostgreSQL, and Realtime. The interface uses a black canvas, one monospace font, terminal output, and a command prompt. There are no seeded users, rooms, or conversations.

## Requirements

- Node.js 22 LTS or newer and npm.
- A dedicated Supabase project, or Docker and the Supabase CLI for a local backend.
- A browser with JavaScript, local storage, and WebSocket support.

## Run locally with a hosted Supabase backend

1. Create a dedicated Supabase project. Keep its database password and server-side secrets out of this repository.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Authenticate the Supabase CLI, link this checkout, and apply the tracked migration:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Review the target project before applying migrations. Use an empty dedicated project for initial setup.

4. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` to the project URL and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the publishable key (legacy projects call it the `anon` key, also supported via `NEXT_PUBLIC_SUPABASE_ANON_KEY`). These values are intentionally public browser configuration; PostgreSQL RLS enforces access. Never use a secret or `service_role` key for either value.
5. In Supabase Authentication URL Configuration, set the site URL to `http://127.0.0.1:3000`. Allow both `http://127.0.0.1:3000/**` and `http://localhost:3000/**` as redirect URLs, including redirects to the root page. Both local origins are supported; keep using the same one during an authentication flow. Enable email/password authentication. Keep email confirmation enabled for production and configure your own SMTP provider for reliable delivery.
6. In Supabase Realtime settings, disable **Allow public access**. VOID uses authenticated private channels. The migration installs the relevant authorization policies and adds persistent messages to the Realtime publication.
7. Start Next.js:

   ```sh
   npm run dev
   ```

8. Open [http://127.0.0.1:3000](http://127.0.0.1:3000), enter `register`, and follow the email, username, and password prompts. [http://localhost:3000](http://localhost:3000) is also supported. If email confirmation is enabled, confirm the email before logging in. Use a second browser profile to test with a second real account.

Restart the development server after changing `.env.local`. Missing backend configuration is reported explicitly; VOID never switches to a simulated backend.

Supabase's default email service only delivers confirmation and recovery mail to organization team addresses. Local testing can use your Supabase account email. Configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) before accepting registrations from other addresses; VOID preserves email verification rather than silently disabling it.

## Run with a fully local Supabase stack

Docker must be installed and running. The local backend provides PostgreSQL, Auth, Realtime, Studio, and a development email inbox.

```sh
npm ci
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` destroys the local database and reapplies migrations. Do not use it against a database containing data you need to keep. Copy the local API URL and public anon key reported by `supabase status` into `.env.local`, then run `npm run dev`. Open the local mail inbox URL printed by the CLI for confirmation and password reset messages.

Local Supabase configuration lives in `supabase/config.toml`. Use `npx supabase stop` when you no longer need the backend. Closing the Next.js process alone does not stop Docker containers.

## Using the terminal

Enter `login` or `register` at the welcome prompt. Authentication is interactive: each input is requested separately, and passwords are masked. `/cancel` abandons an unfinished flow.

| Command | Behavior |
| --- | --- |
| `/help` | Show the available commands and syntax. |
| `/rooms` | Discover rooms with topics, owners, and member counts. |
| `/create quiet-room public "a topic"` | Create and enter a public room with an optional topic. |
| `/create quiet-room private` | Create and enter an invitation-only room. |
| `/join quiet-room` | Join a public room or open a private room you already belong to. |
| `/members` | List everyone in the current room, with owner and online markers. |
| `/topic` | Show the current room topic. |
| `/topic "a new topic"` | Change the topic; only the owner may do this. `""` clears it. |
| `/invite username` | Invite a user to the current room; only its owner may invite. |
| `/kick username` | Remove a user from the current room; only its owner may do this. |
| `/leave` | Leave the current room. Owners must delete their room instead. |
| `/delete quiet-room` | Delete the current owned room by explicitly entering its exact name. |
| `/users prefix` | Discover registered usernames. |
| `/dm username` | Open a persistent direct conversation. |
| `/dm username "hello there"` | Open a direct conversation and send a message. |
| `/inbox` | Find existing direct conversations. |
| `/profile` | Show your profile. |
| `/profile username` | Show a user's public profile, including your own username. |
| `/profile username new_name` | Change your username. |
| `/profile bio "A few words."` | Update your public bio. |
| `/profile bio ""` | Clear your public bio. |
| `/history` | Load earlier messages in the active conversation. |
| `/clear` | Clear local terminal output; stored messages remain in the database. |
| `/logout` | Sign out and clear the active authenticated view. |
| `/reset` | Start the password reset flow. |
| `/password` | Set a new password after opening a recovery link. |
| `/resend person@example.com` | Request another account confirmation email for that address. |
| `/cancel` | Cancel an interactive prompt. |

Once in a room or DM, type ordinary text and press Enter to send it. Prefix a message with `//` to send a literal initial slash: `//help` sends `/help` as a message. Quotes group command arguments, and backslashes escape characters. Use Tab to complete a command, Up/Down to recall previous command input, and Ctrl+L to clear the terminal. Use `/help` for the installed application's exact command guidance. No command executes shell code.

## Data and access model

- `profiles` stores authenticated user IDs, unique usernames, bios, and creation timestamps. Email addresses and password hashes stay in Supabase Auth and are not exposed through profile discovery.
- `rooms` stores room names, visibility, and ownership. `room_members` stores membership. Public discovery does not grant message access: users join a room before reading or sending its messages.
- `messages` persists either a room message or a direct message, never both. Room messages require membership; direct messages are visible only to their sender and recipient.
- RLS protects every application table. Mutating membership and room ownership goes through narrowly scoped database functions. Client-side validation improves feedback; database constraints and permissions remain authoritative.
- Messages are limited to 10 per 10 seconds and 60 per minute per sender. Room creation is limited to 10 per hour and 25 currently owned rooms. These limits are enforced in the database, including when requests bypass the interface.
- Supabase Realtime delivers persisted message inserts under database access policies. Authenticated private channels carry transient presence and typing events. These events are hints, not proof of another user's identity or activity.
- Leaving a room immediately removes database read/write access. Supabase caches private-channel authorization for an existing connection, so ephemeral presence or typing events may remain visible to that connection until it reconnects or refreshes authorization. Message bodies are never sent over those broadcasts; persistent message delivery still uses per-row database RLS.
- The browser stores its Supabase session so authentication can survive refreshes. Treat any script execution on the application origin as security-sensitive. Never render user messages as raw HTML.
- This application does not implement end-to-end encryption. Supabase and authorized database administrators can access stored message content.

No service-role credential is needed by the running web application. The optional `SUPABASE_SERVICE_ROLE_KEY` in `.env.example` is reserved for isolated integration testing and must never be shipped to the browser, committed, or used in a production client.

`SUPABASE_DB_PASSWORD` is an optional administrative credential for database provisioning or CLI operations. A generated database password may be stored only in the ignored local `.env.local` file or a private secret manager. It is not used by the web runtime and must never receive a `NEXT_PUBLIC_` prefix or be committed.

## Verification

```sh
npm run check
npm test
npm run test:sql
npm run build
```

`npm test` uses Node's test runner and `tsx` to run command parsing and input validation tests. `npm run test:sql` applies the real migration to an isolated PGlite PostgreSQL instance and checks database permissions, RLS, membership, profile changes, and persistence. That harness supplies minimal Auth and Realtime schema stubs; it does not test Supabase Auth or WebSocket transport.

Run `npm run test:db` for actual Supabase integration checks after configuring `.env.local` with the public project values and `SUPABASE_SERVICE_ROLE_KEY` for a dedicated test project or local backend. The script creates disposable test accounts and removes them when finished. Never point this test at production. Static checks and a successful build do not establish that the external Supabase project is configured correctly. Verify account registration, confirmation, login, private-room access, persisted room messages, two-user DMs, presence, typing, refresh, and logout against the intended backend.

Integration checks can also run without an administrative key using three existing, dedicated test accounts. Set `VOID_TEST_FIXTURES_PATH` to an absolute path to a private JSON file outside the repository. The file must contain an `accounts` array of at least three distinct objects, each with `id`, `email`, `password`, and `username`. Then run `npm run test:db` with the public Supabase URL/key configured. This mode never reads the administrative key or deletes Auth accounts. It creates uniquely named rooms, deletes those rooms afterward, restores tested profile and password changes, and preserves the external accounts for their owner to remove. Append-only test DMs remain in those disposable accounts. Do not use personal accounts or commit the fixture file. Avoid using the same accounts concurrently during the run.

CI runs the type check, unit tests, isolated PostgreSQL checks, and production build without production credentials. It does not mutate a Supabase project.

## Production deployment

The target address is `https://void.pages.dev`, the free Cloudflare Pages subdomain for a Pages project named `void`. The name is global: if another Cloudflare account already owns it, choose another project name or connect a domain you own. Building or running locally never publishes anything by itself.

1. Create a production Supabase project separate from development and integration tests. Apply the migration, keep Realtime **Allow public access** disabled, configure custom SMTP, and set the site URL plus redirect URLs to `https://void.pages.dev/**`.
2. In Cloudflare, create a Pages project named `void`, or provide an API token with Pages edit permission and your account ID. Never commit either credential.
3. Add these GitHub repository secrets so the build embeds the intended backend and the workflow can publish:

   | Secret | Purpose |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Pages deployment; must not be a global key. |
   | `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account. |
   | `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase project URL. |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production public/publishable (legacy anon) key. |

   No service-role or database password is used by the web build. `NEXT_PUBLIC_SITE_URL` is fixed to `https://void.pages.dev` in the deployment workflow.
4. Push to `main` or run the **Deploy VOID to Cloudflare Pages** workflow manually. `.github/workflows/deploy.yml` verifies the app, builds the static export, generates a hash-based CSP in `out/_headers`, and deploys `out` to the `void` Pages project. The workflow reports a skipped deployment instead of failing when secrets are absent.
5. Local preview of the same output:

   ```sh
   npm ci
   npm run build
   npm run pages:dev
   ```

   `wrangler.toml` pins the compatibility date and output directory. Local `workerd` requires a current Visual C++ redistributable on Windows; a failed local runtime does not indicate a deployment failure in Cloudflare.
6. After a deployment, confirm HTTPS headers, canonical SEO metadata, `/robots.txt`, `/sitemap.xml`, registration, two-user group messaging, invitations, owner topic changes, kicking, DMs, presence, and persistence after refresh.

The static export has no server-side API routes. Supabase RLS remains the only authorization boundary; do not add a service-role key to this deployment. A standard Node deployment remains possible by removing `output: 'export'`, but the supplied Cloudflare workflow uses the static path.

## Repository hygiene

`.env.local`, other environment files, dependency directories, build output, Supabase temporary state, and logs must remain ignored. Only `.env.example` belongs in version control. If a credential is ever exposed, revoke or rotate it at its provider; deleting it from the latest commit is insufficient.
