namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Reads uploaded files. Implementations must enforce <c>maxBytes</c> while reading.</summary>
public interface IFileStorage
{
    /// <exception cref="Extraction.ImportException">Permanent (missing/too large) or transient (network/5xx) failures.</exception>
    Task<byte[]> DownloadAsync(string storagePath, long maxBytes, CancellationToken ct);
}
