using System.Net;
using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Worker;

/// <summary>Optional liveness endpoint (<c>GET /healthz</c>), started only when HEALTH_PORT is set.</summary>
public sealed class HealthServer(WorkerOptions options, WorkerHeartbeat heartbeat, ILogger<HealthServer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.HealthPort is not { } port)
        {
            return;
        }

        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://+:{port}/");
        try
        {
            listener.Start();
        }
        catch (Exception ex) when (ex is HttpListenerException or PlatformNotSupportedException)
        {
            logger.LogWarning("Health endpoint could not start on port {Port}: {Reason}", port, ex.Message);
            return;
        }

        logger.LogInformation("Health endpoint listening on port {Port}", port);
        await using var registration = stoppingToken.Register(listener.Stop);
        var maxSilence = TimeSpan.FromSeconds(Math.Max(60, options.PollIntervalSeconds * 20));

        while (!stoppingToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync();
            }
            catch (Exception) when (stoppingToken.IsCancellationRequested || !listener.IsListening)
            {
                break;
            }

            var healthy = context.Request.Url?.AbsolutePath == "/healthz" &&
                          DateTime.UtcNow - heartbeat.LastPollUtc < maxSilence;
            context.Response.StatusCode = context.Request.Url?.AbsolutePath != "/healthz"
                ? (int)HttpStatusCode.NotFound
                : healthy ? (int)HttpStatusCode.OK : (int)HttpStatusCode.ServiceUnavailable;
            context.Response.Close();
        }
    }
}
