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
        // Align with job-lock staleness: DACPAC extraction routinely exceeds 60s, and
        // platforms such as Render restart the instance if /healthz returns 503.
        var maxSilence = TimeSpan.FromSeconds(Math.Max(options.StaleJobSeconds, options.PollIntervalSeconds * 20));

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

            var path = context.Request.Url?.AbsolutePath;
            if (path != "/healthz")
            {
                context.Response.StatusCode = (int)HttpStatusCode.NotFound;
                context.Response.Close();
                continue;
            }

            var healthy = heartbeat.IsAlive(maxSilence);
            context.Response.StatusCode = healthy ? (int)HttpStatusCode.OK : (int)HttpStatusCode.ServiceUnavailable;
            context.Response.ContentType = "text/plain";
            var body = healthy ? "ok"u8.ToArray() : "unhealthy"u8.ToArray();
            context.Response.ContentLength64 = body.Length;
            try
            {
                await context.Response.OutputStream.WriteAsync(body, stoppingToken);
            }
            catch (Exception) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                // Client disconnected; keep serving health checks.
            }
            finally
            {
                try { context.Response.Close(); } catch { /* already closed */ }
            }
        }
    }
}
