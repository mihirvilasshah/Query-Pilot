using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Worker;

/// <summary>Binds the documented environment variables (or same-named appsettings keys) to <see cref="WorkerOptions"/>.</summary>
public static class WorkerOptionsFactory
{
    public static WorkerOptions Create(IConfiguration config)
    {
        var options = new WorkerOptions
        {
            DatabaseUrl = Value(config, "DATABASE_URL"),
            SupabaseUrl = Value(config, "SUPABASE_URL"),
            SupabaseServiceRoleKey = Value(config, "SUPABASE_SERVICE_ROLE_KEY"),
            LocalStorageDir = Value(config, "LOCAL_STORAGE_DIR"),
        };

        if (Value(config, "SUPABASE_STORAGE_BUCKET") is { } bucket)
        {
            options.StorageBucket = bucket;
        }

        if (Value(config, "WORKER_ID") is { } workerId)
        {
            options.WorkerId = workerId;
        }

        options.PollIntervalSeconds = Int(config, "POLL_INTERVAL_SECONDS", options.PollIntervalSeconds);
        options.StaleJobSeconds = Int(config, "STALE_JOB_SECONDS", options.StaleJobSeconds);
        options.MaxFileBytes = Long(config, "MAX_FILE_BYTES", options.MaxFileBytes);
        options.MaxUncompressedBytes = Long(config, "MAX_UNCOMPRESSED_BYTES", options.MaxUncompressedBytes);
        options.MaxZipEntries = Int(config, "MAX_ZIP_ENTRIES", options.MaxZipEntries);
        if (Value(config, "HEALTH_PORT") is { } port && int.TryParse(port, out var p) && p is > 0 and < 65536)
        {
            options.HealthPort = p;
        }

        return options;
    }

    private static string? Value(IConfiguration config, string key) =>
        string.IsNullOrWhiteSpace(config[key]) ? null : config[key]!.Trim();

    private static int Int(IConfiguration config, string key, int fallback) =>
        int.TryParse(Value(config, key), out var v) ? v : fallback;

    private static long Long(IConfiguration config, string key, long fallback) =>
        long.TryParse(Value(config, key), out var v) ? v : fallback;
}
