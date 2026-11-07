# Vercel deployment

The Next.js app (`apps/web`) is stateless: no local file persistence, no long-running work. Large uploads go straight to Supabase Storage; parsing happens in the separate worker.

## 1. Supabase

1. Create a project; apply all files in `supabase/migrations/` in filename order (see [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md#3-create-the-database)).
2. *Authentication → URL configuration*: set **Site URL** to your production URL and add `https://YOUR-APP.vercel.app/auth/callback` (and preview URLs) to **Redirect URLs**.
3. *Storage*: the migration creates the private `schema-uploads` bucket (50 MB limit - the free-tier maximum; raise it on paid plans and in `MAX_UPLOAD_BYTES`).
4. Confirm RLS is enabled on all tables (*Table Editor* shows the shield) - the migration does this.

## 2. Vercel project

1. Import the Git repository. **Root Directory:** `apps/web`. Framework: Next.js. Enable *"Include source files outside of the Root Directory"* (monorepo packages).
2. Install command: `cd ../.. && npm install` · Build command: `npm run build` (runs `next build`) · Node.js 20.x or 22.x.
3. Environment variables (Production + Preview):

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | required; also used to build the CSP `connect-src` |
| `NEXT_PUBLIC_APP_URL` | public | `https://your-domain` (email links) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | only for per-user encrypted AI keys |
| `CREDENTIAL_ENCRYPTION_KEY` | **secret** | 32-byte base64 |
| `AI_DEFAULT_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `AI_ALLOW_PAID_MODELS` | secret / config | all optional |

Never expose the service-role key with a `NEXT_PUBLIC_` prefix. `NEXT_PUBLIC_*` values are inlined at **build** time: redeploy after changing them.

## 3. Serverless limits

* AI/compare/migration routes declare `maxDuration = 60` (Hobby plan allows up to 60 s). AI provider calls have a 45 s timeout and bounded retries, so they fail cleanly instead of hanging.
* The request body limit (4.5 MB) is irrelevant for uploads (direct-to-Storage). Only JSON ≤ 2 MB (scripts) and ≤ 500 KB (SQL to analyse) pass through functions.
* Dashboards and explorers paginate PostgREST (1000-row pages) and avoid loading definitions for list views.

## 4. Processing worker

Deploy separately - see [PROCESSING_WORKER.md](PROCESSING_WORKER.md). Production is not complete until the worker is running: uploads stay *Pending* without it.

## 5. Post-deploy checklist

- [ ] Register, confirm email, sign in on production
- [ ] Create a project, upload `supabase/seed/sample-hospital-schema.sql`, see it complete
- [ ] Toggle light/dark; open ER diagram and dependency graph
- [ ] `GET /api/health` returns `{"status":"ok","supabaseConfigured":true}`
- [ ] A second account cannot see the first account's projects (RLS)
- [ ] Browser devtools: no service-role key or AI key in any bundle or response
- [ ] (Optional) AI: save consent, run *Explain* on a table

## 6. Preview deployments

Preview URLs need to be listed in Supabase redirect URLs. Use a separate Supabase project (or at least bucket prefix) for previews so test uploads never mix with production.
