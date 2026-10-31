using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Jobs;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Tests;

public sealed class JobRow
{
    public required ImportJob Job { get; set; }
    public string Status { get; set; } = JobStatuses.Pending;
    public string? Stage { get; set; }
    public int Progress { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public int Attempts { get; set; }
    public string? LockedBy { get; set; }
    public List<ImportWarning> Warnings { get; set; } = [];
    public bool Finished { get; set; }
}

/// <summary>Stand-in for the PostgreSQL tables of one version; Complete replaces it wholesale like the real transaction.</summary>
public sealed record StoredVersion(
    string Status,
    string? DatabaseName,
    ImportSummary Summary,
    int Objects,
    int Columns,
    int Relationships,
    int Dependencies,
    Guid OwnerId);

public sealed class InMemoryJobRepository : IImportJobRepository
{
    public Dictionary<Guid, JobRow> Jobs { get; } = [];
    public Dictionary<Guid, StoredVersion> Versions { get; } = [];
    public Dictionary<Guid, string> VersionStatus { get; } = [];
    public List<(string Status, string Stage, int Progress)> Progress { get; } = [];
    public List<string> Log { get; } = [];
    public Exception? CompleteFailure { get; set; }
    public bool LoseLockOnProgress { get; set; }

    public ImportJob Enqueue(string fileType, string fileName, string storagePath, int maxAttempts = 3, string? sha = null)
    {
        var job = new ImportJob(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), fileName, 0,
            fileType, storagePath, sha, 0, maxAttempts, "");
        Jobs[job.Id] = new JobRow { Job = job };
        VersionStatus[job.VersionId] = "pending";
        return job;
    }

    public Task<ImportJob?> ClaimNextAsync(string workerId, int staleSeconds, CancellationToken ct)
    {
        var row = Jobs.Values.FirstOrDefault(r => r.Status == JobStatuses.Pending && r.Attempts < r.Job.MaxAttempts);
        if (row is null)
        {
            return Task.FromResult<ImportJob?>(null);
        }

        row.Status = JobStatuses.Validating;
        row.Attempts++;
        row.LockedBy = workerId;
        row.ErrorCode = row.ErrorMessage = null;
        return Task.FromResult<ImportJob?>(row.Job with { Attempts = row.Attempts, LockedBy = workerId });
    }

    private JobRow Owned(ImportJob job)
    {
        var row = Jobs[job.Id];
        if (row.LockedBy != job.LockedBy)
        {
            throw new JobLockLostException(job.Id);
        }

        return row;
    }

    public Task UpdateProgressAsync(ImportJob job, string status, string stage, int progress, CancellationToken ct)
    {
        if (LoseLockOnProgress)
        {
            Jobs[job.Id].LockedBy = "someone-else";
        }

        var row = Owned(job);
        row.Status = status;
        row.Stage = stage;
        row.Progress = progress;
        Progress.Add((status, stage, progress));
        return Task.CompletedTask;
    }

    public Task CompleteAsync(ImportJob job, ExtractedSchema schema, ImportSummary summary, string jobStatus, string versionStatus, CancellationToken ct)
    {
        if (CompleteFailure is not null)
        {
            throw CompleteFailure;
        }

        var row = Owned(job);

        // delete children first, then insert — mirrors the real single transaction
        if (Versions.Remove(job.VersionId))
        {
            Log.Add("delete");
        }

        Versions[job.VersionId] = new StoredVersion(versionStatus, schema.DatabaseName, summary, schema.Objects.Count,
            schema.Objects.Sum(o => o.Columns.Count), schema.Relationships.Count, schema.Dependencies.Count, job.OwnerId);
        Log.Add("insert");
        VersionStatus[job.VersionId] = versionStatus;

        row.Status = jobStatus;
        row.Stage = "Completed";
        row.Progress = 100;
        row.Warnings = summary.Warnings;
        row.ErrorCode = row.ErrorMessage = null;
        row.LockedBy = null;
        row.Finished = true;
        return Task.CompletedTask;
    }

    public Task FailAsync(ImportJob job, string errorCode, string errorMessage, CancellationToken ct)
    {
        var row = Owned(job);
        row.Status = JobStatuses.Failed;
        row.Stage = "Failed";
        row.ErrorCode = errorCode;
        row.ErrorMessage = errorMessage;
        row.LockedBy = null;
        row.Finished = true;
        VersionStatus[job.VersionId] = VersionStatuses.Failed;
        return Task.CompletedTask;
    }

    public Task RequeueAsync(ImportJob job, string errorCode, string errorMessage, bool releaseAttempt, CancellationToken ct)
    {
        var row = Owned(job);
        row.Status = JobStatuses.Pending;
        row.Stage = "Waiting to retry";
        row.ErrorCode = errorCode;
        row.ErrorMessage = errorMessage;
        row.LockedBy = null;
        if (releaseAttempt)
        {
            row.Attempts = Math.Max(0, row.Attempts - 1);
        }

        return Task.CompletedTask;
    }
}

public sealed class InMemoryFileStorage : IFileStorage
{
    public Dictionary<string, byte[]> Files { get; } = [];
    public Queue<Exception> Failures { get; } = new();
    public int Downloads { get; private set; }

    public Task<byte[]> DownloadAsync(string storagePath, long maxBytes, CancellationToken ct)
    {
        Downloads++;
        if (Failures.TryDequeue(out var failure))
        {
            throw failure;
        }

        if (!Files.TryGetValue(storagePath, out var bytes))
        {
            throw new ImportException(ErrorCodes.FileNotFound, "The uploaded file could not be found in storage.");
        }

        if (bytes.Length > maxBytes)
        {
            throw new ImportException(ErrorCodes.FileTooLarge, "too large");
        }

        return Task.FromResult(bytes);
    }
}
