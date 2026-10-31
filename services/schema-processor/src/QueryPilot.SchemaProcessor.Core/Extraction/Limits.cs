namespace QueryPilot.SchemaProcessor.Extraction;

/// <summary>Size/shape limits applied to untrusted uploads.</summary>
public sealed class ExtractionLimits
{
    public long MaxFileBytes { get; set; } = 50L * 1024 * 1024;
    public long MaxUncompressedBytes { get; set; } = 500L * 1024 * 1024;
    public long MaxEntryBytes { get; set; } = 300L * 1024 * 1024;
    public int MaxZipEntries { get; set; } = 2000;
    public int MaxCompressionRatio { get; set; } = 200;

    /// <summary>Entries smaller than this are exempt from the ratio check (tiny files compress absurdly well legitimately).</summary>
    public long MinBytesForRatioCheck { get; set; } = 1024 * 1024;
}

/// <summary>
/// A failure with a stable code and a message that is safe to show to the end user
/// (no stack traces, connection strings, keys or file contents).
/// </summary>
public class ImportException : Exception
{
    public ImportException(string code, string userMessage, bool isTransient = false, Exception? inner = null)
        : base(userMessage, inner)
    {
        Code = code;
        IsTransient = isTransient;
    }

    public string Code { get; }
    public bool IsTransient { get; }
}

public static class ErrorCodes
{
    public const string UnsupportedFileType = "UNSUPPORTED_FILE_TYPE";
    public const string EmptyFile = "EMPTY_FILE";
    public const string FileTooLarge = "FILE_TOO_LARGE";
    public const string InvalidDacpac = "INVALID_DACPAC";
    public const string InvalidSql = "INVALID_SQL_FILE";
    public const string ParseError = "PARSE_ERROR";
    public const string LimitsExceeded = "LIMITS_EXCEEDED";
    public const string ChecksumMismatch = "CHECKSUM_MISMATCH";
    public const string FileNotFound = "FILE_NOT_FOUND";
    public const string StorageError = "STORAGE_ERROR";
    public const string DatabaseError = "DATABASE_ERROR";
    public const string ExtractionFailed = "EXTRACTION_FAILED";
    public const string InternalError = "INTERNAL_ERROR";
}
