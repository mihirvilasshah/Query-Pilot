# Local development

## 1. Prerequisites

* Node.js ≥ 20.9 (22 recommended) and npm ≥ 10.9 (`npm i -g npm@latest` if you hit `edgesOut` errors with older npm)
* A Supabase project (free tier) **or** Docker Desktop + the Supabase CLI for a local stack
* For the processing worker: Docker, or the .NET 10 SDK
* Optional: a Gemini, OpenRouter or Groq API key

## 2. Install & configure

```bash
npm install
cp .env.example apps/web/.env.local
```

Fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without them the app shows a **/setup** page instead of crashing.

## 3. Create the database

Hosted project (first-time setup): open *SQL Editor* and run every file in `supabase/migrations/` in filename order (`20260101000001_core_schema.sql`, `20260101000002_rls_storage_rpc.sql`, `20260101000003_add_groq_provider.sql`, …), or link the project once and push:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Local stack: `supabase init` (skip if `supabase/` exists) → `supabase start` → `supabase db reset`.

In *Authentication → Providers → Email* you can disable "Confirm email" for local development. Add `http://localhost:3000/auth/callback` to the redirect URLs.

### Applying later migrations (hosted project)

When new files are added to `supabase/migrations/`, push only the pending ones:

```powershell
$db = "postgresql://postgres.<project-ref>:<url-encoded-db-password>@aws-1-<region>.pooler.supabase.com:5432/postgres"
npx supabase db push --db-url $db
```

Notes:

* Use the **pooler** host from *Settings → Database → Connection pooling* (for example `aws-1-eu-west-3.pooler.supabase.com`). The direct `db.<project-ref>.supabase.co` host is IPv6-only on newer Supabase projects, so it fails from IPv4-only networks.
* URL-encode special characters in the database password (`@` → `%40`, `#` → `%23`, `:` → `%3A`).
* Preview first with `supabase db push --dry-run --db-url $db`; it lists exactly which migrations would run.
* Verify afterwards with `supabase migration list --db-url $db` — each local migration must also appear in the `remote` column.
* On Windows, if the global `npm`/`npx` shim is broken, invoke npx through npm directly:
  `node "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js" --yes supabase@2.122.0 db push --db-url $db`

Alternatively, paste the migration SQL into *Dashboard → SQL Editor* and run it (useful when the CLI or direct database connection is unavailable).

## 4. Run

```bash
npm run dev          # web app on http://localhost:3000
```

### Processing worker (required for imports)

```bash
cp .env.example .env     # fill WORKER block: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
docker compose up --build schema-processor
# or without Docker:
npm run worker:run
```

`DATABASE_URL` for a hosted project is the *direct* connection string (Settings → Database); for `supabase start` it is `postgres://postgres:postgres@127.0.0.1:54322/postgres` (use `host.docker.internal` from inside Docker).

Try the CLI without any database (use an absolute path; `dotnet run` changes the working directory): `dotnet run --no-launch-profile --project services/schema-processor/src/QueryPilot.SchemaProcessor.Worker -- extract /absolute/path/to/supabase/seed/sample-hospital-schema.sql --json out.json`.

## 5. Try it

1. Register → create a project → *Database Intelligence → Import Schema* → upload `supabase/seed/sample-hospital-schema.sql`.
2. Explore tables, the ER diagram and the dependency graph; import a changed copy as version 2 and compare.
3. Optional: configure AI (see [AI_PROVIDER_SETUP.md](AI_PROVIDER_SETUP.md)).

## 6. Quality gates

```bash
npm run typecheck && npm run lint && npm test      # TypeScript, ESLint, unit tests
npm run build                                       # production build
npm run worker:test                                 # .NET tests (129)
npm run test:e2e                                    # Playwright (builds + starts the app)
```

### End-to-end tests without Supabase

`apps/web/e2e/mock-supabase/server.mjs` is an in-memory stand-in for GoTrue, PostgREST and Storage seeded with a synthetic hospital-pricing schema (two versions). Playwright builds the app against it and drives the real UI (auth, themes, explorers, graphs, analyzer, comparison, migrations, upload pipeline, AI-unconfigured behaviour). Install the browser once with `npx playwright install chromium`. Run it manually for demos: `node apps/web/e2e/mock-supabase/server.mjs` and start the app with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` (login `demo@querypilot.test` / `DemoPassw0rd1`). It is **not** a security boundary and implements no RLS - RLS is verified by SQL review and should be tested against a real Supabase project before go-live (see [SECURITY.md](SECURITY.md)).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Redirected to `/setup` | Missing `NEXT_PUBLIC_SUPABASE_*` in `apps/web/.env.local` |
| Import stays *Pending* | The worker is not running or cannot reach the database (`docker compose logs schema-processor`) |
| "AI is not set up" | No key configured (Settings → AI or env vars); everything else still works |
| Monaco editor stays "Loading editor…" | The editor loads from `cdn.jsdelivr.net`; check network/CSP |
