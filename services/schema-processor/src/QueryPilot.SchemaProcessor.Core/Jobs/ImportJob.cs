using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Jobs;

/// <summary>A claimed row of <c>database_import_jobs</c>.</summary>
public sealed record ImportJob(
    Guid Id,
    Guid OwnerId,
    Guid ProjectId,
    Guid VersionId,
    string FileName,
    long FileSize,
    string FileType,
    string StoragePath,
    string? SourceSha256,
    int Attempts,
    int MaxAttempts,
    string LockedBy);

public static class JobStatuses
{
    public const string Pending = "pending";
    public const string Validating = "validating";
    public const string Processing = "processing";
    public const string Completed = "completed";
    public const string CompletedWithWarnings = "completed_with_warnings";
    public const string Failed = "failed";
}

public static class VersionStatuses
{
    public const string Ready = "ready";
    public const string ReadyWithWarnings = "ready_with_warnings";
    public const string Failed = "failed";
}

/// <summary>Thrown when this worker no longer owns the job (another worker reclaimed it as stale).</summary>
public sealed class JobLockLostException(Guid jobId)
    : Exception($"Job {jobId} is no longer locked by this worker.");

public interface IImportJobRepository
{
    /// <summary>Atomically claims the next runnable job (status becomes 'validating', attempts+1) or returns null.</summary>
    Task<ImportJob?> ClaimNextAsync(string workerId, int staleSeconds, CancellationToken ct);

    /// <summary>Updates status/stage/progress and refreshes the lock heartbeat. Throws <see cref="JobLockLostException"/>.</summary>
    Task UpdateProgressAsync(ImportJob job, string status, string stage, int progress, CancellationToken ct);

    /// <summary>
    /// Replaces all metadata of the job's version with <paramref name="schema"/> and finalizes version + job,
    /// all in one transaction. Re-running yields identical state.
    /// </summary>
    Task CompleteAsync(ImportJob job, ExtractedSchema schema, ImportSummary summary, string jobStatus, string versionStatus, CancellationToken ct);

    /// <summary>Permanent failure: job and version become 'failed'.</summary>
    Task FailAsync(ImportJob job, string errorCode, string errorMessage, CancellationToken ct);

    /// <summary>Transient failure: job returns to 'pending' so it is claimed again.</summary>
    Task RequeueAsync(ImportJob job, string errorCode, string errorMessage, bool releaseAttempt, CancellationToken ct);
}
