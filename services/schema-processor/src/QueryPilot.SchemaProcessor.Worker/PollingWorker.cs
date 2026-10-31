using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Worker;

public sealed class PollingWorker(JobPollingLoop loop) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.Run(() => loop.RunAsync(stoppingToken), stoppingToken);
}
