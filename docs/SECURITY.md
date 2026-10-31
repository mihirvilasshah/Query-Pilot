# Security

## Threat model (summary)

| Asset | Threat | Mitigation |
|---|---|---|
| Another user's schemas/scripts/history | Horizontal access | Supabase **RLS on every table** (`owner_id = auth.uid()`), parent-ownership checks on inserts, RPCs that re-verify ownership, ownership-prefixed storage paths, DB-level rate limits. Tests: `supabase/tests/rls_isolation.sql` |
| Uploaded files | Malicious DACPAC/SQL (ZIP bombs, zip-slip, binary disguised as SQL) | Extension **and** magic-byte checks (browser, API, worker); 50 MB cap; entry-count / size / ratio limits; traversal names rejected; DACPAC never extracted to disk; worker is separate, non-root, no SQL Server access |
| Customer databases | Execution of uploaded or generated SQL | **Nothing is ever executed.** Uploaded SQL is parsed (ScriptDom/tokenizer); AI-generated SQL and migrations are text with "requires human review" banners; destructive migration statements are commented out by default |
| Secrets | Key leakage | Service-role key and AI keys are server-only; `NEXT_PUBLIC_` only for URL + anon key; user keys AES-256-GCM encrypted in a table with no client grants; keys never logged, echoed or stored in browser storage; `.env*` git-ignored |
| Confidential metadata | Leakage to AI providers | Consent gate (explicit, revocable, audited), minimised retrieved context, untrusted-data tagging, warning in UI and docs; AI optional |
| AI output | Hallucinated objects, prompt injection | Names verified against retrieved metadata and removed otherwise; metadata/SQL tagged as data; AI cannot trigger actions (it only returns text) |
| Web app | XSS, CSRF, open redirect, injection | React escaping; Markdown rendered without raw HTML; CSP + `X-Frame-Options`, `nosniff`, HSTS, strict referrer; `SameSite=Lax` cookies; `safeNext()` allow-list for redirects; zod validation on every input; PostgREST parameterised filters with LIKE-escaping |
| Abuse | Scraping / cost | Per-user fixed-window rate limits (uploads, analysis, AI, key changes), upload quotas via size caps, bounded retries |

## Authentication & sessions

Supabase Auth (email/password, reset by email). The proxy (`proxy.ts`) refreshes the session and calls `auth.getUser()` (validated with the Auth server - never trust `getSession()` server-side). Unauthenticated users are redirected; `/api/*` handlers authenticate themselves and return 401. Login errors are generic (no account enumeration); password reset always reports success. Password policy: ≥ 10 characters with upper, lower and digit (also enforce in Supabase Auth settings; enable leaked-password protection and MFA if your plan allows).

## Data protection

* Private bucket `schema-uploads`; signed upload URLs only; rejected uploads are deleted immediately; deleting a project deletes its files first, then cascades all rows (**secure deletion**; also delete backups according to your retention policy).
* `audit_logs` record imports, retries, comparisons/migrations, consent changes and key save/removal (no secret values).
* `ai_requests` stores only provider/model/status/latency/token counts.
* Release 2 preparation: sensitive-column classification, masking, PII detection, retention and sanitised AI context are designed to hang off the same ownership/RLS model; **no row data is ingested in Release 1** and raw data would never be sent to AI automatically.

## Verification status - read before go-live

| Control | Verified how |
|---|---|
| Parsing, analysis, diff, migration, retrieval, AI error handling, crypto, validation | Automated unit tests (TypeScript and .NET) |
| Auth redirects, themes, upload rejection, AI-unconfigured behaviour, UI flows | Playwright against an in-memory Supabase stand-in |
| **RLS policies, storage policies, RPC functions, queue SQL** | **SQL reviewed and syntax-checked with `pglast`; isolation script provided but must be run against a real Supabase/PostgreSQL before production** (`psql -f supabase/tests/rls_isolation.sql`). The mock backend implements no RLS |
| Worker PostgreSQL repository (claim / COPY / transaction) | Compiles and is exercised through fakes; **integration-test it against a real database before production** |

Recommended before launch: run the RLS script, run an import end-to-end against a real project, enable Supabase leaked-password protection, set up log alerts for `failed` jobs, rotate keys that ever touched a development machine, and consider a third-party penetration test.

**Dependencies:** `npm audit --omit=dev` reports two *low* advisories in `katex` (a Mermaid dependency; its "trust" settings are not enabled and Mermaid runs with `securityLevel: "strict"`). `dompurify` is pinned to a patched release via `overrides`. The Monaco npm package is not bundled (the editor loads from the CDN). Re-run the audit in CI and update regularly.

## Reporting

Report vulnerabilities privately to the maintainers; do not open public issues containing exploit details.
