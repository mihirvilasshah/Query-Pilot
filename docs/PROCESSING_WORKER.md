# Processing worker

`services/schema-processor` is an independent .NET 10 service. See its [README](../services/schema-processor/README.md) for projects, tests and the extraction model. This page covers operations.

## What it does

1. Calls `claim_import_job(worker_id, stale_seconds)` (service-role only; `FOR UPDATE SKIP LOCKED`). Several workers can run safely.
2. Downloads the upload from Supabase Storage (`GET /storage/v1/object/schema-uploads/{path}` with the service-role key) with a hard size cap - or from `LOCAL_STORAGE_DIR` in development.
3. **Validates**: DACPAC = ZIP magic + `model.xml` + metadata entry, entry-count / uncompressed-size / compression-ratio limits, no traversal (`..`, rooted, drive-letter names), never extracted to disk. SQL = size cap, BOM-aware decoding, binary content rejected, empty files rejected.
4. **Extracts**: DACPAC via DacFx `TSqlModel` (in memory) + ScriptDom; `.sql` via ScriptDom with a correct `GO`/`GO n` batch splitter. Original definitions are preserved by fragment offsets. Parse errors carry file and line.
5. **Analyses dependencies**: ScriptDom visitors (reads/writes/operations, EXEC, UDF calls, temp tables, table variables, transactions, dynamic SQL) merged with DacFx references; unresolved and dynamic references are kept with confidence flags.
6. **Persists** in one transaction: lock the job row, delete previous rows for the version, binary `COPY` new rows, update version + job. Re-running is idempotent.

Statuses: `pending → validating → processing → completed | completed_with_warnings | failed`. Permanent problems (invalid file, limits, parse failure with nothing parsed) fail immediately with a user-safe message; transient ones (network, storage, DB) go back to `pending` until `max_attempts` (default 3). Jobs whose worker died are re-claimed after `STALE_JOB_SECONDS`.

## Configuration

See the table in `.env.example` (WORKER block). Required: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The worker never needs, and must never be given, credentials for the customer's SQL Server / Azure SQL MI.

## Run

| Mode | Command |
|---|---|
| Local Docker | `docker compose up --build schema-processor` |
| Local .NET | `npm run worker:run` |
| CLI (no DB) | `dotnet run --no-launch-profile --project services/schema-processor/src/QueryPilot.SchemaProcessor.Worker -- extract <abs path> [--json out.json]` |
| Tests | `npm run worker:test` |

## Production hosting options

* **Azure Container Apps (recommended)** - scale-to-zero is *not* suitable (the worker polls), so use `minReplicas: 1`; `maxReplicas` 2-3 (queue is multi-worker safe). Store `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Container Apps secrets (or Key Vault references). Example:

  ```bash
  az acr build -r <acr> -t querypilot/schema-processor:1 services/schema-processor
  az containerapp create -n qp-worker -g <rg> --environment <env> \
     --image <acr>.azurecr.io/querypilot/schema-processor:1 --min-replicas 1 --max-replicas 2 \
     --secrets dburl=<DATABASE_URL> srk=<SERVICE_ROLE_KEY> \
     --env-vars DATABASE_URL=secretref:dburl SUPABASE_SERVICE_ROLE_KEY=secretref:srk \
                SUPABASE_URL=https://<ref>.supabase.co HEALTH_PORT=8080
  ```
* **Fly.io / Railway / Render background worker** - any container host works; give it outbound access to Supabase only.
* **A small VM** with `docker compose` for the cheapest setup.

Use the Supabase *connection pooler in session mode* or the direct connection string; the worker uses `COPY`, so transaction-mode poolers are not suitable.

## Monitoring & troubleshooting

* `GET /healthz` when `HEALTH_PORT` is set. Logs are structured; file contents are never logged.
* Pending jobs older than a minute ⇒ worker down or cannot connect. `select status, count(*) from database_import_jobs group by 1;`
* A job stuck in `processing` is re-claimed after `STALE_JOB_SECONDS`; after `max_attempts` it is failed with `worker_timeout`.
* Failed jobs can be retried from the UI (`retry_import_job`).

## Security notes

Treat every upload as hostile. The worker runs as non-root, in the sample compose file with a read-only root filesystem, dropped capabilities and `no-new-privileges`. SQL from uploads is only parsed (ScriptDom), never executed, and DacFx is used only to read the package model, never to deploy it.
