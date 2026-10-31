using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Jobs;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Tests;

public class PipelineTests
{
    private readonly InMemoryJobRepository _repo = new();
    private readonly InMemoryFileStorage _storage = new();
    private readonly ExtractionLimits _limits = new();

    private ImportJobProcessor Processor() =>
        new(_repo, _storage, new SchemaExtractionService(_limits), _limits, NullLogger<ImportJobProcessor>.Instance);

    private async Task<(ImportJob Claimed, JobRow Row)> RunNextAsync(CancellationToken ct = default)
    {
        var job = await _repo.ClaimNextAsync("worker-1", 600, ct);
        Assert.NotNull(job);
        await Processor().ProcessAsync(job, ct);
        return (job, _repo.Jobs[job.Id]);
    }

    private ImportJob EnqueueSql(string sql, string name = "schema.sql", int maxAttempts = 3, string? sha = null)
    {
        var path = $"{Guid.NewGuid()}/{name}";
        _storage.Files[path] = Encoding.UTF8.GetBytes(sql);
        return _repo.Enqueue("sql", name, path, maxAttempts, sha);
    }

    [Fact]
    public async Task Successful_job_completes_and_reports_stages_in_order()
    {
        var job = EnqueueSql("CREATE TABLE dbo.T (Id int NOT NULL PRIMARY KEY);");

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Completed, row.Status);
        Assert.Equal(100, row.Progress);
        Assert.Null(row.LockedBy);
        Assert.True(row.Finished);
        Assert.Equal(VersionStatuses.Ready, _repo.VersionStatus[job.VersionId]);

        var stored = _repo.Versions[job.VersionId];
        Assert.Equal(1, stored.Objects);
        Assert.Equal(1, stored.Summary.Counts.Tables);
        Assert.Equal(job.OwnerId, stored.OwnerId);

        Assert.Equal(
            ["Downloading file", "Validating script", "Extracting objects", "Analyzing dependencies", "Saving metadata"],
            _repo.Progress.Select(p => p.Stage).ToArray());
        Assert.Equal(["validating", "validating", "processing", "processing", "processing"],
            _repo.Progress.Select(p => p.Status).ToArray());
        Assert.True(_repo.Progress.Select(p => p.Progress).SequenceEqual(_repo.Progress.Select(p => p.Progress).Order()));
        Assert.InRange(_repo.Progress[0].Progress, 5, 15);
        Assert.InRange(_repo.Progress[^1].Progress, 20, 90);
    }

    [Fact]
    public async Task Dacpac_job_uses_archive_stage_name()
    {
        var path = "u/db.dacpac";
        _storage.Files[path] = Fixtures.BuildDacpac("CREATE TABLE dbo.T (Id int);");
        _repo.Enqueue("dacpac", "db.dacpac", path);

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Completed, row.Status);
        Assert.Contains(_repo.Progress, p => p.Stage == "Validating archive");
    }

    [Fact]
    public async Task Warnings_produce_completed_with_warnings()
    {
        var job = EnqueueSql("CREATE TABLE dbo.T (Id int);\nGO\nCREATE TABLE dbo.T (Id int);");

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.CompletedWithWarnings, row.Status);
        Assert.Equal(WarningCodes.DuplicateDefinition, Assert.Single(row.Warnings).Code);
        Assert.Equal(VersionStatuses.ReadyWithWarnings, _repo.VersionStatus[job.VersionId]);
        Assert.Single(_repo.Versions[job.VersionId].Summary.Warnings);
    }

    [Fact]
    public async Task Permanent_failure_fails_immediately_with_a_safe_message()
    {
        var path = "u/bad.dacpac";
        _storage.Files[path] = new byte[512];
        var job = _repo.Enqueue("dacpac", "bad.dacpac", path);

        var (claimed, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Failed, row.Status);
        Assert.Equal(ErrorCodes.InvalidDacpac, row.ErrorCode);
        Assert.Equal(1, row.Attempts);                      // not retried
        Assert.Null(row.LockedBy);
        Assert.True(row.Finished);
        Assert.Equal(VersionStatuses.Failed, _repo.VersionStatus[job.VersionId]);
        Assert.DoesNotContain("   at ", row.ErrorMessage);
        Assert.DoesNotContain("Exception", row.ErrorMessage);
        Assert.False(_repo.Versions.ContainsKey(job.VersionId));
        Assert.Equal(claimed.Id, job.Id);
    }

    [Fact]
    public async Task Parse_failure_message_names_the_file_and_line()
    {
        EnqueueSql("-- header\nCREATE TABLE dbo.T (\n  Id int,\n  Name nvarchar(10),,\n);", "my schema.sql");

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Failed, row.Status);
        Assert.Equal(ErrorCodes.ParseError, row.ErrorCode);
        Assert.Contains("my schema.sql", row.ErrorMessage);
        Assert.Contains("line 4", row.ErrorMessage);
    }

    [Fact]
    public async Task Empty_file_fails_with_empty_file_code()
    {
        EnqueueSql("  \n");
        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Failed, row.Status);
        Assert.Equal(ErrorCodes.EmptyFile, row.ErrorCode);
    }

    [Fact]
    public async Task Unsupported_file_type_is_rejected()
    {
        _storage.Files["u/x.zip"] = [1, 2, 3];
        _repo.Enqueue("zip", "x.zip", "u/x.zip");

        var (_, row) = await RunNextAsync();

        Assert.Equal(ErrorCodes.UnsupportedFileType, row.ErrorCode);
        Assert.Equal(0, _storage.Downloads);
    }

    [Fact]
    public async Task Missing_storage_object_is_a_permanent_failure()
    {
        _repo.Enqueue("sql", "gone.sql", "u/gone.sql");
        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Failed, row.Status);
        Assert.Equal(ErrorCodes.FileNotFound, row.ErrorCode);
    }

    [Fact]
    public async Task Transient_storage_failure_returns_job_to_pending_keeping_attempts_then_succeeds()
    {
        var job = EnqueueSql("CREATE TABLE dbo.T (Id int);");
        _storage.Failures.Enqueue(new ImportException(ErrorCodes.StorageError, "The uploaded file could not be downloaded right now.", isTransient: true));

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Pending, row.Status);
        Assert.Equal(1, row.Attempts);
        Assert.Equal(ErrorCodes.StorageError, row.ErrorCode);
        Assert.Null(row.LockedBy);
        Assert.False(row.Finished);
        Assert.Equal("pending", _repo.VersionStatus[job.VersionId]);

        var (second, row2) = await RunNextAsync();
        Assert.Equal(2, second.Attempts);
        Assert.Equal(JobStatuses.Completed, row2.Status);
        Assert.Null(row2.ErrorCode);
    }

    [Fact]
    public async Task Transient_failure_on_the_last_attempt_fails_the_job()
    {
        var job = EnqueueSql("CREATE TABLE dbo.T (Id int);", maxAttempts: 2);
        _storage.Failures.Enqueue(new ImportException(ErrorCodes.StorageError, "down", isTransient: true));
        _storage.Failures.Enqueue(new ImportException(ErrorCodes.StorageError, "down", isTransient: true));

        await RunNextAsync();
        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Failed, row.Status);
        Assert.Equal(2, row.Attempts);
        Assert.Equal(ErrorCodes.StorageError, row.ErrorCode);
        Assert.Equal(VersionStatuses.Failed, _repo.VersionStatus[job.VersionId]);
        Assert.Null(await _repo.ClaimNextAsync("w", 600, default));
    }

    [Fact]
    public async Task Database_failure_while_saving_is_transient()
    {
        var job = EnqueueSql("CREATE TABLE dbo.T (Id int);");
        _repo.CompleteFailure = new InvalidOperationException("connection to host=db password=hunter2 failed");

        var (_, row) = await RunNextAsync();

        Assert.Equal(JobStatuses.Pending, row.Status);
        Assert.Equal(ErrorCodes.DatabaseError, row.ErrorCode);
        Assert.DoesNotContain("hunter2", row.ErrorMessage);
        Assert.DoesNotContain("password", row.ErrorMessage);
        Assert.False(_repo.Versions.ContainsKey(job.VersionId));
    }

    [Fact]
    public async Task Checksum_mismatch_is_a_permanent_failure_and_matching_checksum_passes()
    {
        const string sql = "CREATE TABLE dbo.T (Id int);";
        var good = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql))).ToLowerInvariant();

        EnqueueSql(sql, "ok.sql", sha: good);
        Assert.Equal(JobStatuses.Completed, (await RunNextAsync()).Row.Status);

        EnqueueSql(sql, "bad.sql", sha: new string('a', 64));
        var (_, row) = await RunNextAsync();
        Assert.Equal(ErrorCodes.ChecksumMismatch, row.ErrorCode);
    }

    [Fact]
    public async Task File_larger_than_limit_fails_permanently()
    {
        _limits.MaxFileBytes = 64;
        EnqueueSql(new string('x', 500) + "\nCREATE TABLE dbo.T (Id int);");

        var (_, row) = await RunNextAsync();

        Assert.Equal(ErrorCodes.FileTooLarge, row.ErrorCode);
    }

    [Fact]
    public async Task Losing_the_lock_abandons_the_job_without_overwriting_the_new_owner()
    {
        EnqueueSql("CREATE TABLE dbo.T (Id int);");
        _repo.LoseLockOnProgress = true;

        var (_, row) = await RunNextAsync();

        Assert.Equal("someone-else", row.LockedBy);
        Assert.NotEqual(JobStatuses.Failed, row.Status);
        Assert.Empty(_repo.Versions);
    }

    [Fact]
    public async Task Shutdown_releases_the_job_without_consuming_the_attempt()
    {
        EnqueueSql("CREATE TABLE dbo.T (Id int);");
        using var cts = new CancellationTokenSource();
        _storage.Failures.Enqueue(new OperationCanceledException(cts.Token));
        await cts.CancelAsync();

        var job = await _repo.ClaimNextAsync("worker-1", 600, default);
        await Processor().ProcessAsync(job!, cts.Token);

        var row = _repo.Jobs[job!.Id];
        Assert.Equal(JobStatuses.Pending, row.Status);
        Assert.Equal(0, row.Attempts);
    }

    [Fact]
    public async Task Persisting_twice_replaces_state_instead_of_duplicating_it()
    {
        var job = EnqueueSql(Fixtures.HospitalSql);

        await RunNextAsync();
        var first = _repo.Versions[job.VersionId];

        // simulate a retry of the very same version (e.g. the web app's "retry import")
        var row = _repo.Jobs[job.Id];
        row.Status = JobStatuses.Pending;
        row.Attempts = 0;
        await RunNextAsync();
        var second = _repo.Versions[job.VersionId];

        Assert.Equal(["insert", "delete", "insert"], _repo.Log.ToArray());
        Assert.Equal((first.Objects, first.Columns, first.Relationships, first.Dependencies),
                     (second.Objects, second.Columns, second.Relationships, second.Dependencies));
        Assert.Single(_repo.Versions);
        Assert.Equal(first.Summary.Counts.Tables, second.Summary.Counts.Tables);
    }

    [Fact]
    public async Task Polling_loop_processes_queued_jobs_and_stops_on_cancellation()
    {
        var a = EnqueueSql("CREATE TABLE dbo.A (Id int);");
        var b = EnqueueSql("CREATE TABLE dbo.B (Id int);");
        var options = new WorkerOptions { WorkerId = "w", PollIntervalSeconds = 1 };
        var loop = new JobPollingLoop(_repo, Processor(), options, new WorkerHeartbeat(), NullLogger<JobPollingLoop>.Instance);

        using var cts = new CancellationTokenSource();
        var running = loop.RunAsync(cts.Token);
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (_repo.Jobs.Values.Any(r => !r.Finished) && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50);
        }

        await cts.CancelAsync();
        await running.WaitAsync(TimeSpan.FromSeconds(10));

        Assert.All(_repo.Jobs.Values, r => Assert.Equal(JobStatuses.Completed, r.Status));
        Assert.True(_repo.Versions.ContainsKey(a.VersionId) && _repo.Versions.ContainsKey(b.VersionId));
    }
}
