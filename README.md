# QueryPilot

**Understand Your Database. Decode Your SQL. Make Smarter Engineering Decisions.**

QueryPilot is an AI-assisted **database & SQL intelligence workspace**. Import a SQL Server **DACPAC** or a **T-SQL DDL script** (schema only - no data) and explore every table, view, stored procedure, function and trigger; trace static dependencies; view ER diagrams; analyse SQL for risk; compare schema versions; generate migration plans; and ask an AI assistant questions that are answered from your *actual* metadata.

> Release 1 is **schema intelligence**. Data ingestion (Release 2) and live connections (Release 3) are designed for but deliberately **not implemented**. See [docs/RELEASE_ROADMAP.md](docs/RELEASE_ROADMAP.md).

## Principles

* **Deterministic first, AI second.** Parsing, dependency analysis, diffing and risk detection are code. AI only explains and supplements, and its output is checked against the metadata (hallucinated object names are stripped).
* **Nothing is executed.** Uploaded SQL is parsed, never run. Generated SQL and migrations are text for human review.
* **Honest about limits.** Dynamic SQL and external references are reported as *unresolved*; foreign keys are never invented; inferred relationships are labelled.
* **AI is optional.** Every non-AI feature works with no provider configured.
* **Private by default.** Per-user Row Level Security, private storage bucket, server-side secrets only.

## Repository layout

```
apps/web                  Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui
services/schema-processor .NET 10 worker (DacFx + ScriptDom), Docker, PostgreSQL-backed queue
packages/shared-types     Types/constants shared by web and tests
packages/shared-validation  Zod schemas, upload sniffing, file-name sanitising
packages/database-core    Drizzle schema, SQL tokenizer & analyzer, schema diff, migration generator, graph, retrieval, docs
packages/ai-core          Provider-independent AI layer (Gemini, OpenRouter, Groq), retries, reference verification
supabase/migrations       PostgreSQL schema, RLS, storage policies, RPC functions
docs/                     Architecture, security, deployment and setup guides
```

## Quick start

Prerequisites: Node.js 20.9+ (22 recommended), a free [Supabase](https://supabase.com) project, and (for imports) Docker or the .NET 10 SDK.

```bash
npm install
cp .env.example apps/web/.env.local        # fill the WEB block (Supabase URL + anon key)
# apply supabase/migrations/*.sql (see docs/LOCAL_DEVELOPMENT.md#3-create-the-database)
npm run dev                                 # http://localhost:3000
```

Run the processing worker (needed to turn uploads into metadata):

```bash
cp .env.example .env                        # fill the WORKER block
docker compose up --build schema-processor  # or: npm run worker:run
```

Full walkthrough: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md). Try it with the synthetic sample in `supabase/seed/sample-hospital-schema.sql`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development / production build / server |
| `npm run typecheck` | `tsc` in every workspace |
| `npm run lint` | ESLint (Next.js + TypeScript rules) |
| `npm test` | Unit tests (Vitest) for all TypeScript packages |
| `npm run test:e2e` | Playwright end-to-end tests against an in-memory Supabase stand-in (no accounts needed) |
| `npm run worker:build` / `worker:test` | Build / test the .NET processor |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [AI provider setup](docs/AI_PROVIDER_SETUP.md) · [Local development](docs/LOCAL_DEVELOPMENT.md) · [Vercel deployment](docs/VERCEL_DEPLOYMENT.md) · [Processing worker](docs/PROCESSING_WORKER.md) · [Security](docs/SECURITY.md) · [Roadmap](docs/RELEASE_ROADMAP.md) · [Features](docs/FEATURES.md)
