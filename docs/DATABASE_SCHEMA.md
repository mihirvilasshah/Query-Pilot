# Database schema

Source of truth: [`supabase/migrations`](../supabase/migrations) (hand-written SQL). [`packages/database-core/src/drizzle/schema.ts`](../packages/database-core/src/drizzle/schema.ts) mirrors the tables for typed rows. Conventions: UUID primary keys, `created_at`/`updated_at` (trigger-maintained) on every table, `text + CHECK` instead of PG enums, `owner_id` on every row so RLS is an equality check.

## Release 1 tables

| Table | Purpose | Written by |
|---|---|---|
| `profiles` | Display name; auto-created on signup (`handle_new_user`) | trigger / user |
| `user_preferences` | Theme, default dialect, AI provider/model, **AI consent** | user |
| `user_ai_credentials` | AES-256-GCM encrypted per-user provider keys. **No RLS policies**: only the server (service role) can read/write | server |
| `database_projects` | One logical database being analysed | user |
| `database_versions` | Immutable schema version (per import); status `pending/ready/ready_with_warnings/failed`, import summary | RPC / worker |
| `database_import_jobs` | PostgreSQL-backed queue: status, stage, progress, attempts, locks, warnings, errors | RPC / worker |
| `database_objects` | Schemas, tables, views, procedures, functions, triggers, … with **original definition**, metadata JSON, source file/line | worker |
| `database_columns` | Columns with type, declared length (-1 = MAX), precision/scale, nullability, default, identity, PK | worker |
| `database_relationships` | **Declared** foreign keys (`kind='declared'`) and clearly separate name-based inferences (`kind='inferred'`) | worker |
| `database_indexes` | Indexes incl. PK/unique backing indexes | worker |
| `database_constraints` | PK / unique / check / default constraints *(extra table: FKs live in relationships)* | worker |
| `database_dependencies` | Object→object links with `kind`, `operations`, `confidence`, `origin`, line, note | worker |
| `schema_comparisons` | Stored diff summary between two versions of a project | user |
| `migration_plans` | Generated migration/rollback SQL and plan JSON (never executed) | user |
| `sql_scripts`, `sql_script_versions` | Script library with immutable version history | user |
| `sql_analyses` | Static analysis results (+ optional AI supplement) | user |
| `ai_conversations`, `ai_messages` | Database assistant conversations (structured answers + verified object refs) | user |
| `ai_requests` | One row per AI call (provider, model, status, latency, tokens). **No prompts, responses or keys** | server |
| `query_history` | Unified history of explanations, generations, analyses, comparisons, migrations, conversations | server |
| `audit_logs` | Security-relevant events (imports, key saves, consent, deletions) | server |
| `rate_limits` | Fixed-window counters used by `check_rate_limit()` | RPC only |

## Row Level Security

RLS is enabled on **every** table. Policies use `owner_id = (select auth.uid())`; inserts that reference a parent (`project_id`, `version_id`, `script_id`, `conversation_id`) also verify the parent belongs to the caller. Extracted metadata tables grant clients **select/delete only** - they are written by the worker over a privileged connection. Clients can update only `database_versions.label` (column grant). Storage policies restrict the private `schema-uploads` bucket to `{auth.uid()}/{ownedProjectId}/…` paths.

## Functions (RPC)

| Function | Caller | Notes |
|---|---|---|
| `create_schema_version_and_job` | authenticated | Verifies project ownership and path prefix, allocates the next version number, creates version + job + audit row atomically |
| `retry_import_job` | authenticated | Owner only, failed jobs only |
| `check_rate_limit` | authenticated | Per-user fixed window |
| `dashboard_stats` | authenticated | Counts from the **latest ready version** of each project so re-imports never inflate totals |
| `claim_import_job` | **service role only** | `FOR UPDATE SKIP LOCKED`, reclaims stale jobs, fails exhausted ones |

## Planned Release 2 entities (documented only - not created)

`data_snapshots` (project, **schema_version_id**, source format, storage path), `data_profiles`, `data_quality_results`, `data_comparisons`, `data_import_jobs`. Snapshots reference the exact schema version that interprets them; neither side assumes the other exists. Raw datasets live in object storage and a separate processing tier, never in PostgreSQL.
