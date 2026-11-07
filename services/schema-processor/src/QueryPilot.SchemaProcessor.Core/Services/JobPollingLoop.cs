using Microsoft.Extensions.Logging;
using QueryPilot.SchemaProcessor.Jobs;

namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Records liveness so an optional health endpoint can report it.</summary>
public sealed class WorkerHeartbeat
{
    private long _lastTicks = DateTime.UtcNow.Ticks;
    private int _busy;

    public DateTime LastPollUtc => new(Interlocked.Read(ref _lastTicks), DateTimeKind.Utc);

    public bool IsBusy => Volatile.Read(ref _busy) != 0;

    public void Beat() => Interlocked.Exchange(ref _lastTicks, DateTime.UtcNow.Ticks);

    internal void SetLastPollUtcForTests(DateTime utc) =>
        Interlocked.Exchange(ref _lastTicks, utc.Ticks);

    public bool IsAlive(TimeSpan maxSilence) =>
        IsBusy || DateTime.UtcNow - LastPollUtc < maxSilence;

    /// <summary>Marks the worker busy (e.g. while extracting a DACPAC) so health checks stay green.</summary>
    public IDisposable Processing()
    {
        Interlocked.Increment(ref _busy);
        Beat();
        return new BusyScope(this);
    }

    private sealed class BusyScope(WorkerHeartbeat owner) : IDisposable
    {
        private WorkerHeartbeat? _owner = owner;

        public void Dispose()
        {
            var heartbeat = Interlocked.Exchange(ref _owner, null);
            if (heartbeat is null)
            {
                return;
            }

            Interlocked.Decrement(ref heartbeat._busy);
            heartbeat.Beat();
        }
    }
}

/// <summary>Claims and processes jobs one at a time until cancelled.</summary>
public sealed class JobPollingLoop(
    IImportJobRepository repository,
    ImportJobProcessor processor,
    WorkerOptions options,
    WorkerHeartbeat heartbeat,
    ILogger<JobPollingLoop> logger)
{
    public async Task RunAsync(CancellationToken ct)
    {
        logger.LogInformation("Worker {WorkerId} started; polling every {Seconds}s", options.WorkerId, options.PollIntervalSeconds);
        var idle = TimeSpan.FromSeconds(options.PollIntervalSeconds);
        var failures = 0;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                heartbeat.Beat();
                var job = await repository.ClaimNextAsync(options.WorkerId, options.StaleJobSeconds, ct);
                failures = 0;
                if (job is null)
                {
                    await Task.Delay(idle, ct);
                    continue;
                }

                using (heartbeat.Processing())
                {
                    await processor.ProcessAsync(job, ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                failures++;
                var backoff = TimeSpan.FromSeconds(Math.Min(60, idle.TotalSeconds * Math.Pow(2, Math.Min(failures, 5))));
                logger.LogError(ex, "Polling failed ({Failures} in a row); retrying in {Seconds}s", failures, (int)backoff.TotalSeconds);
                try
                {
                    await Task.Delay(backoff, ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        logger.LogInformation("Worker {WorkerId} stopped", options.WorkerId);
    }
}
