# QueryPilot schema processor

.NET 10 background worker that turns an uploaded **`.dacpac`** or **`.sql` (DDL script)** into normalized schema
metadata in PostgreSQL: objects, columns, indexes, constraints, relationships and static dependencies.

* Picks up import jobs from a PostgreSQL-backed queue (`database_import_jobs`, claimed with `public.claim_import_job`).
* Downloads the file from Supabase Storage (or a local folder in development).
* Parses it **offline** (DacFx for DACPAC models, ScriptDom for T-SQL) and writes the result back in one transaction.
* **Never connects to a customer SQL Server / Azure SQL MI and never executes SQL from an upload — parsing only.**
  (`Microsoft.Data.SqlClient` is deliberately not referenced; it is reserved for Release 3 live connectivity.)

## Layout

```
QueryPilot.SchemaProcessor.slnx
src/QueryPilot.SchemaProcessor.Core     extraction, analysis, job pipeline, Npgsql repository
  Dacpac/ SqlParser/ Extraction/ DependencyAnalysis/ Models/ Services/ Jobs/
src/QueryPilot.SchemaProcessor.Worker   host (polling worker, optional /healthz) + `extract` CLI
tests/QueryPilot.SchemaProcessor.Tests  xUnit, synthetic fixtures only (DACPACs are built in-test with DacFx)
```

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | – (required) | `postgres://user:pass@host:5432/db?sslmode=require` **or** an Npgsql connection string. Direct connection; bypasses RLS. |
| `SUPABASE_URL` | – | Project URL, e.g. `https://xyz.supabase.co` (required unless `LOCAL_STORAGE_DIR`). |
| `SUPABASE_SERVICE_ROLE_KEY` | – | Service role key used for storage downloads (required unless `LOCAL_STORAGE_DIR`). Never logged. |
| `SUPABASE_STORAGE_BUCKET` | `schema-uploads` | Storage bucket holding uploads. |
| `LOCAL_STORAGE_DIR` | – | If set, files are read from `<dir>/<storage_path>` instead of Supabase (local dev / tests). |
| `WORKER_ID` | machine name + GUID | Identifies this worker in `locked_by`. |
| `POLL_INTERVAL_SECONDS` | `3` | Sleep between polls when the queue is empty. |
| `STALE_JOB_SECONDS` | `600` | A `validating`/`processing` job locked longer than this is reclaimed. Progress updates refresh the lock. |
| `MAX_FILE_BYTES` | `52428800` | Maximum upload size (50 MB) for both file types. |
| `MAX_UNCOMPRESSED_BYTES` | `524288000` | DACPAC: maximum total uncompressed size (500 MB). |
| `MAX_ZIP_ENTRIES` | `2000` | DACPAC: maximum number of ZIP entries. |
| `HEALTH_PORT` | – | If set, serves `GET /healthz` (200 while the poll loop is alive). Nothing is exposed otherwise. |

Per-entry size (300 MB) and compression ratio (200:1) limits live in `ExtractionLimits`.

## Running

```powershell
# one-off, no database: extract a file and print a summary / dump the full model as JSON
dotnet run --project src/QueryPilot.SchemaProcessor.Worker -- extract C:\path\to\db.dacpac --json out.json
dotnet run --project src/QueryPilot.SchemaProcessor.Worker -- extract C:\path\to\schema.sql

# the polling worker (local files instead of Supabase)
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres"
$env:LOCAL_STORAGE_DIR = "C:\dev\uploads"
dotnet run --project src/QueryPilot.SchemaProcessor.Worker
```

Docker (build context is this folder): `docker build -t querypilot-schema-processor .`
The image uses the Debian-based runtime (DacFx needs ICU culture data — do not enable invariant globalization) and runs as a non-root user.

## Tests

```powershell
dotnet test QueryPilot.SchemaProcessor.slnx
```

The pipeline is tested with in-memory fakes of `IImportJobRepository` and `IFileStorage`; the PostgreSQL repository
is not covered by automated tests (no database in CI here).

## How it talks to the web app

The web app (via `create_schema_version_and_job`) inserts a `database_versions` row and a `database_import_jobs` row.
The worker:

1. `select * from claim_import_job(worker_id, stale_seconds)` – atomically sets `status='validating'`, `attempts+1`, lock fields.
2. Updates `status/stage/progress` (`validating` 5–15 → `processing` 20–90; stages *Downloading file*, *Validating archive*/*script*, *Extracting objects*, *Analyzing dependencies*, *Saving metadata*).
3. In **one transaction** deletes every row of the version (dependencies → relationships → indexes → constraints → columns → objects),
   bulk-inserts the new metadata (binary `COPY`, client-generated GUIDs), updates `database_versions` (`status`, `database_name`, `summary`)
   and finishes the job (`completed` / `completed_with_warnings`, `warnings`, `finished_at`, lock cleared). Re-running a job gives identical state.
4. Failures: **permanent** (invalid/empty/oversized file, parse errors, limits, checksum mismatch, missing object) → job and version `failed`
   with `error_code` + a safe `error_message` (file name and line numbers for parse errors; never stack traces, keys or connection strings).
   **Transient** (storage/network/database) → job back to `pending` while `attempts < max_attempts`, otherwise `failed`.
   If another worker reclaimed a stale job, this worker abandons it without writing.

JSON written to `database_objects.metadata`, `database_versions.summary` and `database_import_jobs.warnings` follows
`packages/shared-types` (`ObjectMetadata`, `ImportSummary`, `ImportWarning`; camelCase keys).

### Conventions worth knowing

* `database_objects`: schemas store the schema name in `name` and `''` in `schema_name`; unqualified names get schema `dbo`.
  `definition` is the exact original statement text (from the first token to the last, including a trailing `;`), `source_file`/`source_line` are set for `.sql`.
  For DACPAC the definition is the script DacFx generates from the model (bodies verbatim); `source_file`/`source_line` are only set when the package carries a real file path.
* `database_columns.data_type` is the base type name (`nvarchar`); `max_length` is the declared length (`-1` = MAX, `1` when a char/binary type has no length), `numeric_precision`/`numeric_scale` come from `decimal/numeric/float`, and `datetime2/time/datetimeoffset` put their fractional-seconds precision in `numeric_scale`.
  `is_nullable` is `NULL` when the script does not say. Computed columns use `data_type = 'computed'`.
* Parameter `direction` is `out` for `OUTPUT` parameters and `in` otherwise.
* `database_dependencies.line` is the absolute file line for `.sql`; for DACPAC it is relative to the object's generated script.
* Duplicate `CREATE` of the same object keeps the last definition and adds a `DUPLICATE_DEFINITION` warning. `ALTER`/`CREATE OR ALTER` replace silently; an `ALTER` with no prior `CREATE` imports with `ALTER_WITHOUT_CREATE`.
* Warning codes: `PARSE_ERROR`, `UNSUPPORTED_STATEMENT`, `UNSUPPORTED_OBJECT`, `DUPLICATE_DEFINITION`, `ALTER_WITHOUT_CREATE`, `UNRESOLVED_TARGET`, `NO_SCHEMA_OBJECTS`, `SOURCE_ENCODING`, `TOO_MANY_WARNINGS`.

## Security guarantees

* Uploads are untrusted: the DACPAC ZIP magic is checked (extension ignored), required entries must exist, entry names with `..`, rooted paths, drive letters or backslash traversal are rejected,
  and entry count, total/per-entry uncompressed size and compression ratio are limited. Every entry is actually inflated (to nowhere) against those caps before DacFx sees the package.
  Nothing is extracted to disk; DacFx loads the model from memory.
* `.sql` files: size cap, NUL/binary/magic-byte detection, BOM-aware decoding (UTF-8/UTF-16 LE/BE, UTF-8 else Latin-1 fallback with a warning).
* Parsing runs on a thread with a large stack to survive deeply nested statements.
* No customer database connection, no SQL execution, no file contents in logs, secrets never logged.
* Storage paths cannot traverse out of the bucket (or `LOCAL_STORAGE_DIR`).

## Dependency analysis

Declared foreign keys → `database_relationships` (`kind='declared'`). A conservative name-based pass may add `kind='inferred'` rows
(`origin='name-based inference'`) only when no FK covers the column, the column is not part of its table's primary key, its name equals the single-column PK name of
exactly one other table, and the data types are identical.

Dependencies (`reads`, `writes`, `executes`, `calls_function`, `references`, `trigger_on`) come from ScriptDom analysis of each view/procedure/function/trigger body.
For `.sql` everything is `parsed_reference` except declared FKs and triggers (`confirmed_static`). For DACPAC, DacFx's resolved references upgrade matching rows to `confirmed_static` (`origin='dacfx'`, operations kept).
Dynamic SQL (`EXEC(@sql)`, `EXEC('…')`, `sp_executesql`) yields one `unresolved_dynamic` row per occurrence. Unresolved targets keep `target_schema`/`target_name` with the note *not found in imported schema*.

## Limitations

* Dynamic SQL is flagged, never resolved. Cross-database / linked-server references stay unresolved.
* View and table-valued-function result columns are not extracted (no data types available without a database).
* Only column-level metadata of tables is extracted; permissions, users, roles, extended properties and other DACPAC elements are reported as `UNSUPPORTED_OBJECT`.
* DDL (database/server) triggers are reported as unsupported; `DROP` statements are applied to the in-memory model, other data/session statements are ignored (data statements with a warning).
* The PostgreSQL repository could not be integration-tested in the authoring environment.
