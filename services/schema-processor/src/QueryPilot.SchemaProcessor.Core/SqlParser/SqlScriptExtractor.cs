using Microsoft.SqlServer.TransactSql.ScriptDom;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.SqlParser;

/// <summary>
/// Extracts schema metadata from a T-SQL DDL script. The script is only parsed (ScriptDom), never executed.
/// </summary>
public sealed class SqlScriptExtractor
{
    public ExtractedSchema Extract(string fileName, byte[] content, ExtractionLimits limits) =>
        Extract(fileName, Validate(content, limits));

    /// <summary>Size, emptiness and binary checks plus BOM-aware decoding.</summary>
    public static DecodedSql Validate(byte[] content, ExtractionLimits limits)
    {
        if (content.Length > limits.MaxFileBytes)
        {
            throw new ImportException(ErrorCodes.FileTooLarge,
                $"The file is larger than the {limits.MaxFileBytes / (1024 * 1024)} MB limit.");
        }

        if (content.Length == 0)
        {
            throw new ImportException(ErrorCodes.EmptyFile, "The file is empty.");
        }

        var decoded = SqlTextDecoder.Decode(content);
        if (string.IsNullOrWhiteSpace(decoded.Text))
        {
            throw new ImportException(ErrorCodes.EmptyFile, "The file is empty.");
        }

        return decoded;
    }

    public ExtractedSchema Extract(string fileName, DecodedSql decoded)
    {
        var warnings = new WarningCollector();
        var schema = new ExtractedSchema { SourceType = "sql", FileName = fileName };
        if (decoded.UsedFallback)
        {
            warnings.Add(WarningCodes.SourceEncoding,
                "The file is not valid UTF-8 and has no byte-order mark; it was read as Latin-1, so some characters may be wrong.",
                null, fileName);
        }

        var split = SqlBatchSplitter.Split(decoded.Text);
        foreach (var d in split.Directives)
        {
            warnings.Add(WarningCodes.UnsupportedStatement,
                $"SQLCMD directive '{Shorten(d.Text)}' was ignored.", null, fileName, d.Line);
        }

        if (split.Batches.Count == 0)
        {
            throw new ImportException(ErrorCodes.EmptyFile, "The file contains no SQL statements.");
        }

        var builder = new SchemaBuilder(schema, warnings);
        var parser = new TSql170Parser(initialQuotedIdentifiers: true);
        var failedBatches = 0;
        var parsedBatches = 0;
        var errorSummaries = new List<string>();

        foreach (var batch in split.Batches)
        {
            using var reader = new StringReader(batch.Text);
            var fragment = parser.Parse(reader, out var errors);
            if (errors.Count > 0)
            {
                failedBatches++;
                foreach (var e in errors)
                {
                    var line = batch.StartLine + e.Line - 1;
                    warnings.Add(WarningCodes.ParseError,
                        $"Syntax error at line {line}, column {e.Column}: {e.Message}", null, fileName, line);
                    if (errorSummaries.Count < 5)
                    {
                        errorSummaries.Add($"line {line}, column {e.Column}: {e.Message}");
                    }
                }

                continue;
            }

            var statements = ((TSqlScript)fragment).Batches.SelectMany(b => b.Statements).ToList();
            if (statements.Count > 0)
            {
                parsedBatches++;
            }

            var ctx = new StatementContext(batch.Text, fileName, batch.StartLine - 1);
            foreach (var statement in statements)
            {
                try
                {
                    builder.Apply(statement, ctx);
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                {
                    warnings.Add(WarningCodes.UnsupportedStatement,
                        "This statement could not be analyzed and was ignored.", null, fileName, ctx.Line(statement));
                }
            }
        }

        if (failedBatches > 0 && parsedBatches == 0)
        {
            throw new ImportException(ErrorCodes.ParseError,
                $"The SQL script '{fileName}' could not be parsed: {string.Join("; ", errorSummaries)}.");
        }

        if (schema.Objects.Count == 0)
        {
            warnings.Add(WarningCodes.NoSchemaObjects,
                "No schema objects (tables, views, procedures, ...) were found in the script.", null, fileName);
        }

        schema.Warnings.AddRange(warnings.Finish());
        return schema;
    }

    private static string Shorten(string text) => text.Length <= 60 ? text : text[..60] + "...";
}
