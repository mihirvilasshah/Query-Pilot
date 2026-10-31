# Release roadmap

## Release 1 - Schema Intelligence (this repository)

Schema-only imports (`.dacpac`, `.sql`), project/version management, explorers (tables, columns, views, procedures, functions, triggers, indexes/constraints), static dependency analysis with confidence levels, ER diagrams, SQL workspace/analyzer/generation, AI database assistant, schema comparison, migration planning, documentation export, persistent history. **No row data is imported and no live connections exist.** See [FEATURES.md](FEATURES.md) for the feature-by-feature status.

## Release 2 - Data Intelligence (planned, not implemented)

Inputs: BACPAC, CSV, other approved structured exports. Capabilities: row counts, NULL analysis, duplicate/distinct/distribution analysis, data-quality rules, referential-integrity validation, anomaly detection, snapshot and historical comparison, schema+data combined AI context.

Architecture already prepared:

* **Separate service boundary**: `DataImportService` contract (`validateDataFile`, `extractTableData`, `profileTableData`, `generateDataQualityReport`, `compareDataSnapshots`) next to - never inside - `SchemaImportService`.
* **New tables** (documented in DATABASE_SCHEMA.md): `data_snapshots` (always carries the exact `schema_version_id`), `data_profiles`, `data_quality_results`, `data_comparisons`, `data_import_jobs`. A project can hold schema versions without snapshots and vice versa.
* **Storage**: originals and large artefacts in object storage (signed URLs make an Azure Blob Storage move an adapter change); raw datasets **never** in PostgreSQL; profiling in a separate worker tier (reuse the queue pattern; consider DuckDB/Parquet).
* **Privacy**: column classification, masking, PII detection, retention policies, secure deletion, access controls and a *sanitised-summary-only* rule for AI context, designed before any data is accepted.

## Release 3 - Advanced Database Intelligence (future)

Optional live connections (SQL Server / Azure SQL MI via `Microsoft.Data.SqlClient`, reserved in the worker design but unused), Query Store and execution-plan analysis, index performance, query recommendations, historical change tracking, automated impact analysis. Requires a credential vault, network isolation (self-hosted collector / private link) and read-only roles; none of this exists today.

## Long-term: Engineering Intelligence Platform

`database_objects` + `database_dependencies` form a typed graph that a future platform can join with API endpoints, backend and frontend source, workflows and documentation (frontend → API → database). Stable identity is `(version_id, object_type, schema_name, name)`; links already carry `origin` and `confidence`, which generalise to code-level edges.

## Known limitations & next steps for Release 1

* Dependency analysis does not resolve dynamic SQL, cross-database/linked-server references or application code (reported as unresolved).
* View / table-valued-function result columns are not extracted from DACPACs; permissions, users and roles are reported as unsupported.
* The SQL analyzer is token-based (conservative, heuristic findings are labelled); it is not a full T-SQL parser. Non-T-SQL dialect rules are minimal.
* Row Level Security and the worker's PostgreSQL repository need an integration run against a real Supabase project (scripts provided).
* Monaco is loaded from a CDN; self-hosting the editor assets is a hardening option.
* Possible enhancements: column-level lineage via ScriptDom, saved comparison viewers, scheduled re-imports, team workspaces (shared projects), SSO.
