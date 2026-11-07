using QueryPilot.SchemaProcessor.Dacpac;
using QueryPilot.SchemaProcessor.DependencyAnalysis;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.SqlParser;

namespace QueryPilot.SchemaProcessor.Extraction;

/// <summary>Result of the cheap structural validation step; carries what the extraction step needs.</summary>
public sealed record ValidatedUpload(string FileType, string FileName, byte[] Content, DacpacInfo? Dacpac, DecodedSql? Sql);

public interface ISchemaExtractionService
{
    ValidatedUpload Validate(string fileType, string fileName, byte[] content);

    ExtractedSchema Extract(ValidatedUpload upload, CancellationToken cancellationToken);

    void Analyze(ExtractedSchema schema);
}

/// <summary>
/// Orchestrates validation → extraction → analysis. Parsing runs on a thread with a large stack so deeply
/// nested (possibly hostile) SQL cannot overflow the worker's stack.
/// </summary>
public sealed class SchemaExtractionService(ExtractionLimits limits) : ISchemaExtractionService
{
    // Large enough for hostile/deep ScriptDom recursion; small enough for 512 MiB hosts (Render free).
    private const int StackBytes = 16 * 1024 * 1024;

    public ExtractionLimits Limits { get; } = limits;

    public ValidatedUpload Validate(string fileType, string fileName, byte[] content) =>
        RunOnLargeStack(() => fileType switch
        {
            "dacpac" => new ValidatedUpload(fileType, fileName, content, DacpacValidator.Validate(content, Limits), null),
            "sql" => new ValidatedUpload(fileType, fileName, content, null, SqlScriptExtractor.Validate(content, Limits)),
            _ => throw new ImportException(ErrorCodes.UnsupportedFileType,
                "Only .dacpac and .sql files can be imported."),
        });

    public ExtractedSchema Extract(ValidatedUpload upload, CancellationToken cancellationToken) =>
        RunOnLargeStack(() => upload.FileType switch
        {
            "dacpac" => new DacpacExtractor().Extract(upload.FileName, upload.Content, upload.Dacpac!, cancellationToken),
            "sql" => new SqlScriptExtractor().Extract(upload.FileName, upload.Sql!),
            _ => throw new ImportException(ErrorCodes.UnsupportedFileType, "Only .dacpac and .sql files can be imported."),
        });

    public void Analyze(ExtractedSchema schema) => RunOnLargeStack(() =>
    {
        SchemaAnalyzer.Analyze(schema);
        return 0;
    });

    /// <summary>Convenience for the CLI and tests: all three steps in one call.</summary>
    public ExtractedSchema ExtractAndAnalyze(string fileType, string fileName, byte[] content, CancellationToken cancellationToken = default)
    {
        var schema = Extract(Validate(fileType, fileName, content), cancellationToken);
        Analyze(schema);
        return schema;
    }

    private static T RunOnLargeStack<T>(Func<T> work)
    {
        T? result = default;
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                result = work();
            }
            catch (Exception ex)
            {
                error = ex;
            }
        }, StackBytes);
        thread.Start();
        thread.Join();

        if (error is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();
        }

        return result!;
    }
}
