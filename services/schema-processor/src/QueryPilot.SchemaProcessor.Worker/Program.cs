using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Jobs;
using QueryPilot.SchemaProcessor.Services;
using QueryPilot.SchemaProcessor.Worker;

// CLI mode: `extract <file> [--json out.json]` runs the pipeline without a database.
if (args.Length > 0 && args[0].Equals("extract", StringComparison.OrdinalIgnoreCase))
{
    var cliConfig = new ConfigurationBuilder().AddEnvironmentVariables().Build();
    return ExtractCommand.Run(args[1..], cliConfig);
}

if (args.Length > 0 && args[0] is "-h" or "--help" or "help")
{
    Console.WriteLine("QueryPilot schema processor");
    Console.WriteLine("  (no arguments)                         run the polling worker (see README for environment variables)");
    Console.WriteLine("  extract <file> [--json out.json]       extract a .dacpac/.sql file locally, no database needed");
    return 0;
}

var builder = Host.CreateApplicationBuilder(args);
var options = WorkerOptionsFactory.Create(builder.Configuration);
var problems = options.Validate();
if (problems.Count > 0)
{
    foreach (var p in problems)
    {
        Console.Error.WriteLine($"Configuration error: {p}");
    }

    return 1;
}

var limits = options.ToLimits();
builder.Services.AddSingleton(options);
builder.Services.AddSingleton(limits);
builder.Services.AddSingleton<ISchemaExtractionService>(new SchemaExtractionService(limits));
builder.Services.AddSingleton<WorkerHeartbeat>();
builder.Services.AddSingleton<IImportJobRepository>(sp =>
    new PostgresImportJobRepository(options.DatabaseUrl!, sp.GetRequiredService<ILogger<PostgresImportJobRepository>>()));
builder.Services.AddSingleton<IFileStorage>(sp =>
{
    if (!string.IsNullOrWhiteSpace(options.LocalStorageDir))
    {
        return new LocalFileStorage(options.LocalStorageDir);
    }

    var http = new HttpClient(new SocketsHttpHandler
    {
        ConnectTimeout = TimeSpan.FromSeconds(15),
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    })
    {
        Timeout = TimeSpan.FromMinutes(5),
    };
    return new SupabaseFileStorage(http, options, sp.GetRequiredService<ILogger<SupabaseFileStorage>>());
});
builder.Services.AddSingleton<ImportJobProcessor>();
builder.Services.AddSingleton<JobPollingLoop>();
builder.Services.AddHostedService<PollingWorker>();
if (options.HealthPort is not null)
{
    builder.Services.AddHostedService<HealthServer>();
}

await builder.Build().RunAsync();
return 0;
