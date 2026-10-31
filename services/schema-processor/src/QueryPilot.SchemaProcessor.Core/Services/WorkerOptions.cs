namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Strongly typed worker settings. Env var names (e.g. DATABASE_URL) are bound by the host.</summary>
public sealed class WorkerOptions
{
    public string? DatabaseUrl { get; set; }
    public string? SupabaseUrl { get; set; }
    public string? SupabaseServiceRoleKey { get; set; }
    public string StorageBucket { get; set; } = "schema-uploads";
    public string WorkerId { get; set; } = $"{Environment.MachineName}-{Guid.NewGuid():N}";
    public int PollIntervalSeconds { get; set; } = 3;
    public int StaleJobSeconds { get; set; } = 600;
    public long MaxFileBytes { get; set; } = 52_428_800;
    public long MaxUncompressedBytes { get; set; } = 500L * 1024 * 1024;
    public int MaxZipEntries { get; set; } = 2000;
    public string? LocalStorageDir { get; set; }
    public int? HealthPort { get; set; }

    public Extraction.ExtractionLimits ToLimits() => new()
    {
        MaxFileBytes = MaxFileBytes,
        MaxUncompressedBytes = MaxUncompressedBytes,
        MaxZipEntries = MaxZipEntries,
    };

    /// <summary>Returns a list of human-readable configuration problems (never including secret values).</summary>
    public IReadOnlyList<string> Validate()
    {
        var problems = new List<string>();
        if (string.IsNullOrWhiteSpace(DatabaseUrl))
        {
            problems.Add("DATABASE_URL is required.");
        }

        if (string.IsNullOrWhiteSpace(LocalStorageDir))
        {
            if (string.IsNullOrWhiteSpace(SupabaseUrl))
            {
                problems.Add("SUPABASE_URL is required unless LOCAL_STORAGE_DIR is set.");
            }

            if (string.IsNullOrWhiteSpace(SupabaseServiceRoleKey))
            {
                problems.Add("SUPABASE_SERVICE_ROLE_KEY is required unless LOCAL_STORAGE_DIR is set.");
            }
        }

        if (PollIntervalSeconds < 1)
        {
            problems.Add("POLL_INTERVAL_SECONDS must be at least 1.");
        }

        if (StaleJobSeconds < 30)
        {
            problems.Add("STALE_JOB_SECONDS must be at least 30.");
        }

        if (MaxFileBytes < 1024)
        {
            problems.Add("MAX_FILE_BYTES is too small.");
        }

        return problems;
    }
}
