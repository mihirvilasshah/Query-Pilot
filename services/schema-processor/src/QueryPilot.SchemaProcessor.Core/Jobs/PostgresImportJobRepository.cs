using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Jobs;

/// <summary>
/// PostgreSQL implementation of the job queue and metadata store. Connects directly (bypassing RLS) with the
/// worker's database role. Metadata is replaced wholesale inside a single transaction so re-runs are idempotent.
/// </summary>
public sealed class PostgresImportJobRepository : IImportJobRepository, IAsyncDisposable
{
    private const int MaxErrorMessageLength = 1000;

    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<PostgresImportJobRepository> _logger;

    public PostgresImportJobRepository(string databaseUrl, ILogger<PostgresImportJobRepository> logger)
    {
        _dataSource = NpgsqlDataSource.Create(PostgresConnectionString.Normalize(databaseUrl));
        _logger = logger;
    }

    public ValueTask DisposeAsync() => _dataSource.DisposeAsync();

    public async Task<ImportJob?> ClaimNextAsync(string workerId, int staleSeconds, CancellationToken ct)
    {
        await using var cmd = _dataSource.CreateCommand(
            """
            select id, owner_id, project_id, version_id, file_name, file_size, file_type, storage_path,
                   source_sha256, attempts, max_attempts
              from public.claim_import_job($1, $2)
            """);
        cmd.Parameters.AddWithValue(workerId);
        cmd.Parameters.AddWithValue(staleSeconds);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new ImportJob(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
            reader.GetString(4), reader.GetInt64(5), reader.GetString(6), reader.GetString(7),
            reader.IsDBNull(8) ? null : reader.GetString(8), reader.GetInt32(9), reader.GetInt32(10), workerId);
    }

    public async Task UpdateProgressAsync(ImportJob job, string status, string stage, int progress, CancellationToken ct)
    {
        await using var cmd = _dataSource.CreateCommand(
            """
            update public.database_import_jobs
               set status = $1, stage = $2, progress = $3, locked_at = now()
             where id = $4 and locked_by = $5 and status in ('validating', 'processing')
            """);
        cmd.Parameters.AddWithValue(status);
        cmd.Parameters.AddWithValue(stage);
        cmd.Parameters.AddWithValue(progress);
        cmd.Parameters.AddWithValue(job.Id);
        cmd.Parameters.AddWithValue(job.LockedBy);

        if (await cmd.ExecuteNonQueryAsync(ct) == 0)
        {
            throw new JobLockLostException(job.Id);
        }
    }

    public async Task CompleteAsync(ImportJob job, ExtractedSchema schema, ImportSummary summary,
        string jobStatus, string versionStatus, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // Take the row lock first: if another worker reclaimed the job we must not touch its version.
        await using (var lockCmd = new NpgsqlCommand(
            "select 1 from public.database_import_jobs where id = $1 and locked_by = $2 for update", conn, tx))
        {
            lockCmd.Parameters.AddWithValue(job.Id);
            lockCmd.Parameters.AddWithValue(job.LockedBy);
            if (await lockCmd.ExecuteScalarAsync(ct) is null)
            {
                throw new JobLockLostException(job.Id);
            }
        }

        foreach (var table in new[]
                 {
                     "database_dependencies", "database_relationships", "database_indexes",
                     "database_constraints", "database_columns", "database_objects",
                 })
        {
            await using var del = new NpgsqlCommand($"delete from public.{table} where version_id = $1", conn, tx);
            del.Parameters.AddWithValue(job.VersionId);
            await del.ExecuteNonQueryAsync(ct);
        }

        await CopyObjectsAsync(conn, job, schema, ct);
        await CopyColumnsAsync(conn, job, schema, ct);
        await CopyRelationshipsAsync(conn, job, schema, ct);
        await CopyIndexesAsync(conn, job, schema, ct);
        await CopyConstraintsAsync(conn, job, schema, ct);
        await CopyDependenciesAsync(conn, job, schema, ct);

        await using (var ver = new NpgsqlCommand(
            """
            update public.database_versions
               set status = $1, database_name = coalesce($2, database_name), summary = $3
             where id = $4
            """, conn, tx))
        {
            ver.Parameters.AddWithValue(versionStatus);
            ver.Parameters.Add(new NpgsqlParameter { Value = (object?)Clean(schema.DatabaseName) ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Text });
            ver.Parameters.Add(new NpgsqlParameter { Value = JsonDefaults.Serialize(summary), NpgsqlDbType = NpgsqlDbType.Jsonb });
            ver.Parameters.AddWithValue(job.VersionId);
            await ver.ExecuteNonQueryAsync(ct);
        }

        await using (var jobCmd = new NpgsqlCommand(
            """
            update public.database_import_jobs
               set status = $1, stage = 'Completed', progress = 100, warnings = $2,
                   error_code = null, error_message = null, finished_at = now(),
                   locked_at = null, locked_by = null
             where id = $3 and locked_by = $4
            """, conn, tx))
        {
            jobCmd.Parameters.AddWithValue(jobStatus);
            jobCmd.Parameters.Add(new NpgsqlParameter { Value = JsonDefaults.Serialize(summary.Warnings), NpgsqlDbType = NpgsqlDbType.Jsonb });
            jobCmd.Parameters.AddWithValue(job.Id);
            jobCmd.Parameters.AddWithValue(job.LockedBy);
            if (await jobCmd.ExecuteNonQueryAsync(ct) == 0)
            {
                throw new JobLockLostException(job.Id);
            }
        }

        await tx.CommitAsync(ct);
    }

    public async Task FailAsync(ImportJob job, string errorCode, string errorMessage, CancellationToken ct)
    {
        await using var conn = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        await using (var jobCmd = new NpgsqlCommand(
            """
            update public.database_import_jobs
               set status = 'failed', stage = 'Failed', error_code = $1, error_message = $2,
                   finished_at = now(), locked_at = null, locked_by = null
             where id = $3 and locked_by = $4
            """, conn, tx))
        {
            jobCmd.Parameters.AddWithValue(errorCode);
            jobCmd.Parameters.AddWithValue(Truncate(errorMessage));
            jobCmd.Parameters.AddWithValue(job.Id);
            jobCmd.Parameters.AddWithValue(job.LockedBy);
            if (await jobCmd.ExecuteNonQueryAsync(ct) == 0)
            {
                _logger.LogWarning("Job {JobId} was not failed because this worker no longer holds its lock", job.Id);
                return;
            }
        }

        await using (var ver = new NpgsqlCommand(
            "update public.database_versions set status = 'failed' where id = $1", conn, tx))
        {
            ver.Parameters.AddWithValue(job.VersionId);
            await ver.ExecuteNonQueryAsync(ct);
        }

        await tx.CommitAsync(ct);
    }

    public async Task RequeueAsync(ImportJob job, string errorCode, string errorMessage, bool releaseAttempt, CancellationToken ct)
    {
        await using var cmd = _dataSource.CreateCommand(
            """
            update public.database_import_jobs
               set status = 'pending', stage = 'Waiting to retry', progress = 0,
                   error_code = $1, error_message = $2, locked_at = null, locked_by = null,
                   attempts = case when $3 then greatest(attempts - 1, 0) else attempts end
             where id = $4 and locked_by = $5
            """);
        cmd.Parameters.AddWithValue(errorCode);
        cmd.Parameters.AddWithValue(Truncate(errorMessage));
        cmd.Parameters.AddWithValue(releaseAttempt);
        cmd.Parameters.AddWithValue(job.Id);
        cmd.Parameters.AddWithValue(job.LockedBy);
        if (await cmd.ExecuteNonQueryAsync(ct) == 0)
        {
            _logger.LogWarning("Job {JobId} was not requeued because this worker no longer holds its lock", job.Id);
        }
    }

    // ---------------------------------------------------------------- bulk inserts (binary COPY)

    private static string? Clean(string? s) => s?.Replace("\0", "");

    private static string Truncate(string s) => s.Length <= MaxErrorMessageLength ? s : s[..MaxErrorMessageLength];

    private static async Task TextAsync(NpgsqlBinaryImporter w, string? value)
    {
        if (value is null)
        {
            await w.WriteNullAsync();
        }
        else
        {
            await w.WriteAsync(value.Replace("\0", ""), NpgsqlDbType.Text);
        }
    }

    private static async Task IntAsync(NpgsqlBinaryImporter w, int? value)
    {
        if (value is null)
        {
            await w.WriteNullAsync();
        }
        else
        {
            await w.WriteAsync(value.Value, NpgsqlDbType.Integer);
        }
    }

    private static async Task BoolAsync(NpgsqlBinaryImporter w, bool? value)
    {
        if (value is null)
        {
            await w.WriteNullAsync();
        }
        else
        {
            await w.WriteAsync(value.Value, NpgsqlDbType.Boolean);
        }
    }

    private static Task GuidAsync(NpgsqlBinaryImporter w, Guid value) => w.WriteAsync(value, NpgsqlDbType.Uuid);

    private static async Task GuidOrNullAsync(NpgsqlBinaryImporter w, Guid? value)
    {
        if (value is null)
        {
            await w.WriteNullAsync();
        }
        else
        {
            await w.WriteAsync(value.Value, NpgsqlDbType.Uuid);
        }
    }

    private static Task TextArrayAsync(NpgsqlBinaryImporter w, IEnumerable<string> values) =>
        w.WriteAsync(values.Select(v => v.Replace("\0", "")).ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Text);

    private static Task JsonAsync(NpgsqlBinaryImporter w, string json) => w.WriteAsync(json, NpgsqlDbType.Jsonb);

    private static async Task CopyObjectsAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_objects (id, owner_id, version_id, schema_name, name, object_type, parent_object_id, definition, metadata, source_file, source_line) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var o in schema.Objects)
        {
            await w.StartRowAsync(ct);
            await GuidAsync(w, o.Id);
            await GuidAsync(w, job.OwnerId);
            await GuidAsync(w, job.VersionId);
            await TextAsync(w, o.SchemaName);
            await TextAsync(w, o.Name);
            await TextAsync(w, o.ObjectType);
            await GuidOrNullAsync(w, o.ParentObjectId);
            await TextAsync(w, o.Definition);
            await JsonAsync(w, JsonDefaults.Serialize(o.Metadata));
            await TextAsync(w, o.SourceFile);
            await IntAsync(w, o.SourceLine);
        }

        await w.CompleteAsync(ct);
    }

    private static async Task CopyColumnsAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_columns (id, owner_id, version_id, object_id, name, ordinal, data_type, max_length, numeric_precision, numeric_scale, is_nullable, default_value, is_identity, is_primary_key, is_computed, computed_expression) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var o in schema.Objects)
        {
            foreach (var c in o.Columns)
            {
                await w.StartRowAsync(ct);
                await GuidAsync(w, Guid.NewGuid());
                await GuidAsync(w, job.OwnerId);
                await GuidAsync(w, job.VersionId);
                await GuidAsync(w, o.Id);
                await TextAsync(w, c.Name);
                await IntAsync(w, c.Ordinal);
                await TextAsync(w, c.DataType);
                await IntAsync(w, c.MaxLength);
                await IntAsync(w, c.NumericPrecision);
                await IntAsync(w, c.NumericScale);
                await BoolAsync(w, c.IsNullable);
                await TextAsync(w, c.DefaultValue);
                await BoolAsync(w, c.IsIdentity);
                await BoolAsync(w, c.IsPrimaryKey);
                await BoolAsync(w, c.IsComputed);
                await TextAsync(w, c.ComputedExpression);
            }
        }

        await w.CompleteAsync(ct);
    }

    private static async Task CopyRelationshipsAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_relationships (id, owner_id, version_id, name, kind, source_object_id, target_object_id, target_schema, target_name, source_columns, target_columns, on_delete, on_update, origin) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var r in schema.Relationships)
        {
            await w.StartRowAsync(ct);
            await GuidAsync(w, r.Id);
            await GuidAsync(w, job.OwnerId);
            await GuidAsync(w, job.VersionId);
            await TextAsync(w, r.Name);
            await TextAsync(w, r.Kind);
            await GuidAsync(w, r.SourceObjectId);
            await GuidOrNullAsync(w, r.TargetObjectId);
            await TextAsync(w, r.TargetSchema);
            await TextAsync(w, r.TargetName);
            await TextArrayAsync(w, r.SourceColumns);
            await TextArrayAsync(w, r.TargetColumns);
            await TextAsync(w, r.OnDelete);
            await TextAsync(w, r.OnUpdate);
            await TextAsync(w, r.Origin);
        }

        await w.CompleteAsync(ct);
    }

    private static async Task CopyIndexesAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_indexes (id, owner_id, version_id, object_id, name, index_type, is_unique, is_primary_key, is_unique_constraint, key_columns, included_columns, filter_definition, definition) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var o in schema.Objects)
        {
            foreach (var i in o.Indexes)
            {
                await w.StartRowAsync(ct);
                await GuidAsync(w, Guid.NewGuid());
                await GuidAsync(w, job.OwnerId);
                await GuidAsync(w, job.VersionId);
                await GuidAsync(w, o.Id);
                await TextAsync(w, i.Name);
                await TextAsync(w, i.IndexType);
                await BoolAsync(w, i.IsUnique);
                await BoolAsync(w, i.IsPrimaryKey);
                await BoolAsync(w, i.IsUniqueConstraint);
                await JsonAsync(w, JsonDefaults.Serialize(i.KeyColumns));
                await TextArrayAsync(w, i.IncludedColumns);
                await TextAsync(w, i.FilterDefinition);
                await TextAsync(w, i.Definition);
            }
        }

        await w.CompleteAsync(ct);
    }

    private static async Task CopyConstraintsAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_constraints (id, owner_id, version_id, object_id, name, constraint_type, columns, expression) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var o in schema.Objects)
        {
            foreach (var c in o.Constraints)
            {
                await w.StartRowAsync(ct);
                await GuidAsync(w, Guid.NewGuid());
                await GuidAsync(w, job.OwnerId);
                await GuidAsync(w, job.VersionId);
                await GuidAsync(w, o.Id);
                await TextAsync(w, c.Name);
                await TextAsync(w, c.ConstraintType);
                await TextArrayAsync(w, c.Columns);
                await TextAsync(w, c.Expression);
            }
        }

        await w.CompleteAsync(ct);
    }

    private static async Task CopyDependenciesAsync(NpgsqlConnection conn, ImportJob job, ExtractedSchema schema, CancellationToken ct)
    {
        await using var w = await conn.BeginBinaryImportAsync(
            "COPY public.database_dependencies (id, owner_id, version_id, source_object_id, target_object_id, target_schema, target_name, target_type, kind, operations, confidence, origin, line, note) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var d in schema.Dependencies)
        {
            await w.StartRowAsync(ct);
            await GuidAsync(w, d.Id);
            await GuidAsync(w, job.OwnerId);
            await GuidAsync(w, job.VersionId);
            await GuidAsync(w, d.SourceObjectId);
            await GuidOrNullAsync(w, d.TargetObjectId);
            await TextAsync(w, d.TargetSchema);
            await TextAsync(w, d.TargetName);
            await TextAsync(w, d.TargetType);
            await TextAsync(w, d.Kind);
            await TextArrayAsync(w, d.Operations);
            await TextAsync(w, d.Confidence);
            await TextAsync(w, d.Origin);
            await IntAsync(w, d.Line);
            await TextAsync(w, d.Note);
        }

        await w.CompleteAsync(ct);
    }
}
