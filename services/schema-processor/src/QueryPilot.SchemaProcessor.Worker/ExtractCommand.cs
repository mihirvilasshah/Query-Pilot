using System.Text.Json;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Worker;

/// <summary><c>extract &lt;file&gt; [--json out.json]</c>: runs the extraction pipeline without any database.</summary>
public static class ExtractCommand
{
    public static int Run(string[] args, IConfiguration config)
    {
        string? path = null;
        string? jsonOut = null;
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--json" && i + 1 < args.Length)
            {
                jsonOut = args[++i];
            }
            else if (path is null && !args[i].StartsWith("--", StringComparison.Ordinal))
            {
                path = args[i];
            }
            else
            {
                return Usage();
            }
        }

        if (path is null)
        {
            return Usage();
        }

        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"File not found: {path}");
            return 2;
        }

        var options = WorkerOptionsFactory.Create(config);
        var limits = options.ToLimits();
        try
        {
            var info = new FileInfo(path);
            if (info.Length > limits.MaxFileBytes)
            {
                throw new ImportException(ErrorCodes.FileTooLarge, $"The file is larger than the {limits.MaxFileBytes / (1024 * 1024)} MB limit.");
            }

            var content = File.ReadAllBytes(path);
            var fileType = DetectType(path, content);
            var schema = new SchemaExtractionService(limits).ExtractAndAnalyze(fileType, info.Name, content);

            PrintSummary(schema);
            if (jsonOut is not null)
            {
                File.WriteAllText(jsonOut, JsonSerializer.Serialize(SchemaExport.Build(schema), JsonDefaults.Indented));
                Console.WriteLine($"Full model written to {jsonOut}");
            }

            return 0;
        }
        catch (ImportException ex)
        {
            Console.Error.WriteLine($"Error [{ex.Code}]: {ex.Message}");
            return 1;
        }
    }

    private static string DetectType(string path, byte[] content)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".dacpac" => "dacpac",
            ".sql" => "sql",
            _ => content.Length >= 4 && content[0] == 0x50 && content[1] == 0x4B ? "dacpac" : "sql",
        };
    }

    private static void PrintSummary(ExtractedSchema schema)
    {
        var s = schema.BuildSummary();
        var c = s.Counts;
        Console.WriteLine($"Source: {s.SourceType}  Database: {s.DatabaseName ?? "(unknown)"}");
        Console.WriteLine($"Schemas {c.Schemas}, tables {c.Tables}, views {c.Views}, procedures {c.Procedures}, " +
                          $"functions {c.Functions}, triggers {c.Triggers}");
        Console.WriteLine($"Columns {c.Columns}, indexes {c.Indexes}, foreign keys {c.ForeignKeys}, " +
                          $"inferred relationships {schema.Relationships.Count(r => r.Kind == "inferred")}, dependencies {c.Dependencies}");
        foreach (var u in s.Unsupported)
        {
            Console.WriteLine($"Unsupported: {u.ObjectType} x{u.Count}");
        }

        Console.WriteLine($"Warnings: {s.Warnings.Count}");
        foreach (var w in s.Warnings.Take(25))
        {
            var where = w.File is null ? "" : w.Line is null ? $" ({w.File})" : $" ({w.File}:{w.Line})";
            Console.WriteLine($"  [{w.Code}] {w.Message}{where}");
        }

        if (s.Warnings.Count > 25)
        {
            Console.WriteLine($"  ... and {s.Warnings.Count - 25} more");
        }
    }

    private static int Usage()
    {
        Console.Error.WriteLine("Usage: extract <path-to-.dacpac|.sql> [--json out.json]");
        return 2;
    }
}
