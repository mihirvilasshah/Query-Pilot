# Architecture

## Overview

```
 Browser ──► Next.js (Vercel) ──────────────► Supabase PostgreSQL (RLS)   ◄── schema-processor (.NET, Docker)
   │           │  Route Handlers / Actions        ▲   metadata, jobs                │  claim_import_job()
   │           │  database-core (analysis)        │                                 │  DacFx + ScriptDom
   │           │  ai-core ───────────────► Gemini / OpenRouter (server side only)   │
   └──────────►│  signed upload URL ──────► Supabase Storage (private bucket) ◄─────┘ downloads with service role
```

* **Web app** (`apps/web`): UI, authentication, CRUD, retrieval for AI, SQL analysis, schema comparison, migration generation. Stateless; deployable to Vercel. Never parses large files.
* **Processing worker** (`services/schema-processor`): independent .NET 10 service. Polls a PostgreSQL-backed queue, downloads the upload, validates it, extracts metadata with Microsoft DacFx / ScriptDom, resolves dependencies and writes the result in **one transaction**. It never connects to SQL Server / Azure SQL MI.
* **Supabase**: Auth, PostgreSQL (application data + the job queue), Storage (original uploads). RLS isolates users.
* **AI**: optional, server-side only, provider-independent.

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| UI | Next.js App Router, React 19, TypeScript strict, Tailwind 4, shadcn/ui, Lucide | Server components for data-heavy pages, design tokens via CSS variables |
| Editor / diagrams | Monaco, React Flow (+dagre), Mermaid, Recharts | Theme-aware through tokens (no hardcoded colours) |
| Validation | Zod (shared between client and server) | One contract, two enforcement points |
| Database | Supabase PostgreSQL, hand-written SQL migrations, Drizzle schema for typed rows | RLS/storage policies are not expressible in Drizzle; Drizzle mirrors shapes |
| Schema parsing | DacFx + ScriptDom in .NET | The only reliable T-SQL parser; regex is not used for ingestion |
| Queue | `database_import_jobs` + `claim_import_job()` (`FOR UPDATE SKIP LOCKED`) | No Kafka/Kubernetes; trivially portable |
| AI | `ai-core` abstraction with Gemini and OpenRouter providers | Replaceable, free-tier friendly, retries/backoff/timeouts |

## Package responsibilities

| Package | Contents |
|---|---|
| `database-core` | `sql/tokenizer`, `sql/analyzer` (token-based static analysis & risk rules), `schema/diff` (pure comparison), `schema/migration` (SQL, rollback, validation queries, checklist), `schema/graph` (dependency graph, column impact, Mermaid flow), `schema/retrieval` (deterministic context for AI), `schema/docs`, `services/import-services` (Schema/Data import contracts), `drizzle/schema` |
| `ai-core` | `AiProvider` interface, `BaseAiProvider` (prompts, structured output + repair), `GeminiProvider`, `OpenRouterProvider`, `requestJson` (timeout, retry, backoff, `Retry-After`), `verifyAnswerReferences` |
| `shared-validation` | Zod schemas, upload content sniffing (`sniffFile`), `sanitizeFileName` |
| `shared-types` | Enums/labels (`DependencyConfidence`, import statuses, …) |

Business logic lives in packages and `lib/`; components are presentational. All pure logic has unit tests.

## Schema ingestion flow

1. User creates a **project**, picks a `.dacpac` / `.sql` file. The browser validates extension, size (≤ 50 MB) and **magic bytes** (`sniffFile`).
2. `POST /api/uploads/sign` validates metadata, applies a rate limit and returns a **signed upload URL** scoped to `{userId}/{projectId}/…`.
3. The browser uploads **directly to Supabase Storage** (no Vercel body limit).
4. `POST /api/uploads/complete` re-validates the first bytes server-side (ranged read), deletes rejected files, and calls `create_schema_version_and_job()` - an atomic RPC that creates the immutable **version** and a `pending` **job**.
5. The worker claims the job (`validating → processing`), validates the archive/file again (ZIP-bomb, traversal, encoding), extracts and analyses, then replaces all metadata rows for that version in a transaction and sets `completed` / `completed_with_warnings` / `failed`.
6. The UI polls `/api/import-jobs/:id` and shows progress, warnings and errors; failed jobs can be retried.

Idempotency: persistence deletes-then-inserts per `version_id` inside one transaction guarded by the job lock; re-running a job yields identical state. Retries: transient failures return the job to `pending` until `max_attempts`; stale `processing` jobs are re-claimed.

## Dependency model & confidence

Every link records *how it was found*: `confirmed_static` (DacFx model references / explicit DDL), `parsed_reference` (ScriptDom body analysis), `inferred` (name-based, only relationships), `unresolved_dynamic` (dynamic SQL). The UI never presents the graph as complete when dynamic SQL or unresolved references exist.

## AI retrieval architecture

1. `retrieveContext()` scores objects against the question (names, column names, focus object), expands through confirmed dependencies, falls back to the most connected objects for broad questions, and renders a **bounded** context block (default ≤ 12 000 chars).
2. The provider receives only that block (tagged as untrusted `<metadata>`), the question (`<user_input>`) and the last ≤ 6 messages.
3. The structured answer is validated with Zod and `verifyAnswerReferences()` removes object names that are not in the retrieved metadata; the UI shows only verified objects as links.
4. Consent gate: AI calls are refused until the user explicitly accepts that SQL/metadata is sent to the provider.

## Release 2 / 3 extension points

* `SchemaImportService` (implemented by the worker) and `DataImportService` (**interface only**, `database-core/src/services/import-services.ts`) are separate boundaries. A data snapshot always references the **exact schema version** used to interpret it.
* Planned tables (documented, not created): `data_snapshots`, `data_profiles`, `data_quality_results`, `data_comparisons`, `data_import_jobs`.
* Object storage is accessed through signed URLs, so migrating to Azure Blob Storage only changes the signing/downloading adapters.
* A future Engineering Intelligence Platform can reuse `database_objects` / `database_dependencies` as nodes and edges; object identity is `(version_id, type, schema, name)`.
