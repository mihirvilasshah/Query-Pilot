using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Jobs;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Runs one claimed job end to end and records its outcome. Never throws for job-level failures.</summary>
public sealed class ImportJobProcessor(
    IImportJobRepository repository,
    IFileStorage storage,
    ISchemaExtractionService extraction,
    ExtractionLimits limits,
    ILogger<ImportJobProcessor> logger)
{
    public async Task ProcessAsync(ImportJob job, CancellationToken ct)
    {
        logger.LogInformation("Processing import job {JobId} (version {VersionId}, type {FileType}, attempt {Attempt}/{Max})",
            job.Id, job.VersionId, job.FileType, job.Attempts, job.MaxAttempts);

        try
        {
            await RunAsync(job, ct);
        }
        catch (JobLockLostException)
        {
            logger.LogWarning("Job {JobId} was reclaimed by another worker; abandoning it.", job.Id);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown: give the job back without burning an attempt.
            await SafeAsync(() => repository.RequeueAsync(job, "SHUTDOWN", "The worker was stopped; the job will be retried.", true, CancellationToken.None), job);
        }
        catch (ImportException ex) when (!ex.IsTransient)
        {
            logger.LogWarning("Job {JobId} failed permanently: {Code}", job.Id, ex.Code);
            await SafeAsync(() => repository.FailAsync(job, ex.Code, ex.Message, CancellationToken.None), job);
        }
        catch (ImportException ex)
        {
            await HandleTransientAsync(job, ex.Code, ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unexpected error while processing job {JobId}", job.Id);
            await HandleTransientAsync(job, ErrorCodes.InternalError, "An unexpected error occurred while processing the file.");
        }
    }

    private async Task RunAsync(ImportJob job, CancellationToken ct)
    {
        if (job.FileType is not ("dacpac" or "sql"))
        {
            throw new ImportException(ErrorCodes.UnsupportedFileType, "Only .dacpac and .sql files can be imported.");
        }

        await repository.UpdateProgressAsync(job, JobStatuses.Validating, "Downloading file", 10, ct);
        var content = await storage.DownloadAsync(job.StoragePath, limits.MaxFileBytes, ct);
        VerifyChecksum(job, content);

        await repository.UpdateProgressAsync(job, JobStatuses.Validating,
            job.FileType == "dacpac" ? "Validating archive" : "Validating script", 15, ct);
        var upload = Guarded(() => extraction.Validate(job.FileType, job.FileName, content));

        await repository.UpdateProgressAsync(job, JobStatuses.Processing, "Extracting objects", 25, ct);
        var schema = Guarded(() => extraction.Extract(upload, ct));

        await repository.UpdateProgressAsync(job, JobStatuses.Processing, "Analyzing dependencies", 60, ct);
        Guarded(() => { extraction.Analyze(schema); return 0; });

        await repository.UpdateProgressAsync(job, JobStatuses.Processing, "Saving metadata", 85, ct);
        var summary = schema.BuildSummary();
        var hasWarnings = summary.Warnings.Count > 0;
        try
        {
            await repository.CompleteAsync(job, schema, summary,
                hasWarnings ? JobStatuses.CompletedWithWarnings : JobStatuses.Completed,
                hasWarnings ? VersionStatuses.ReadyWithWarnings : VersionStatuses.Ready, ct);
        }
        catch (Exception ex) when (ex is not (JobLockLostException or OperationCanceledException or ImportException))
        {
            logger.LogError(ex, "Saving metadata for job {JobId} failed", job.Id);
            throw new ImportException(ErrorCodes.DatabaseError, "The extracted metadata could not be saved right now.", isTransient: true, inner: ex);
        }

        logger.LogInformation("Job {JobId} finished: {Objects} objects, {Dependencies} dependencies, {Warnings} warnings",
            job.Id, schema.Objects.Count, schema.Dependencies.Count, summary.Warnings.Count);
    }

    /// <summary>Anything unexpected thrown while parsing uploaded content is a problem with that content.</summary>
    private T Guarded<T>(Func<T> step)
    {
        try
        {
            return step();
        }
        catch (Exception ex) when (ex is not (ImportException or OperationCanceledException))
        {
            logger.LogError(ex, "Extraction failed with an unexpected {ErrorType}", ex.GetType().Name);
            throw new ImportException(ErrorCodes.ExtractionFailed,
                "The file could not be processed. It may be corrupt or use unsupported constructs.", inner: ex);
        }
    }

    private static void VerifyChecksum(ImportJob job, byte[] content)
    {
        var expected = job.SourceSha256?.Trim();
        if (expected is not { Length: 64 } || !expected.All(Uri.IsHexDigit))
        {
            return;
        }

        var actual = Convert.ToHexString(SHA256.HashData(content));
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            throw new ImportException(ErrorCodes.ChecksumMismatch,
                "The uploaded file does not match its recorded checksum. Please upload it again.");
        }
    }

    private async Task HandleTransientAsync(ImportJob job, string code, string message)
    {
        if (job.Attempts < job.MaxAttempts)
        {
            logger.LogWarning("Job {JobId} hit a transient failure ({Code}); returning it to the queue (attempt {Attempt}/{Max})",
                job.Id, code, job.Attempts, job.MaxAttempts);
            await SafeAsync(() => repository.RequeueAsync(job, code, message, false, CancellationToken.None), job);
        }
        else
        {
            logger.LogError("Job {JobId} failed after {Attempts} attempts ({Code})", job.Id, job.Attempts, code);
            await SafeAsync(() => repository.FailAsync(job, code,
                $"{message} Processing was retried {job.Attempts} times without success.", CancellationToken.None), job);
        }
    }

    private async Task SafeAsync(Func<Task> action, ImportJob job)
    {
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            // If this also fails the lock goes stale and claim_import_job will pick the job up again.
            logger.LogError(ex, "Could not record the outcome of job {JobId}", job.Id);
        }
    }
}
