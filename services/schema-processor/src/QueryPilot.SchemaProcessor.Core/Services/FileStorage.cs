using System.Net;
using Microsoft.Extensions.Logging;
using QueryPilot.SchemaProcessor.Extraction;

namespace QueryPilot.SchemaProcessor.Services;

/// <summary>Downloads objects from Supabase Storage using the service role key (never logged).</summary>
public sealed class SupabaseFileStorage : IFileStorage
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _bucket;
    private readonly string _key;
    private readonly ILogger<SupabaseFileStorage> _logger;

    public SupabaseFileStorage(HttpClient http, WorkerOptions options, ILogger<SupabaseFileStorage> logger)
    {
        _http = http;
        _logger = logger;
        _baseUrl = (options.SupabaseUrl ?? throw new InvalidOperationException("SUPABASE_URL is not configured.")).TrimEnd('/');
        _key = options.SupabaseServiceRoleKey ?? throw new InvalidOperationException("SUPABASE_SERVICE_ROLE_KEY is not configured.");
        _bucket = options.StorageBucket;
    }

    public async Task<byte[]> DownloadAsync(string storagePath, long maxBytes, CancellationToken ct)
    {
        var url = BuildUrl(storagePath);
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_key}");
        request.Headers.TryAddWithoutValidation("apikey", _key);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            _logger.LogWarning("Storage request failed: {ErrorType}", ex.GetType().Name);
            throw new ImportException(ErrorCodes.StorageError, "The uploaded file could not be downloaded right now.", isTransient: true, inner: ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw await MapFailureAsync(response, ct);
            }

            if (response.Content.Headers.ContentLength is { } declared && declared > maxBytes)
            {
                throw TooLarge(maxBytes);
            }

            try
            {
                await using var body = await response.Content.ReadAsStreamAsync(ct);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int read;
                while ((read = await body.ReadAsync(chunk, ct)) > 0)
                {
                    if (buffer.Length + read > maxBytes)
                    {
                        throw TooLarge(maxBytes);
                    }

                    buffer.Write(chunk, 0, read);
                }

                return buffer.ToArray();
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException && !ct.IsCancellationRequested)
            {
                throw new ImportException(ErrorCodes.StorageError, "The uploaded file could not be downloaded right now.", isTransient: true, inner: ex);
            }
        }
    }

    private string BuildUrl(string storagePath)
    {
        var segments = storagePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(s => s is "." or ".."))
        {
            throw new ImportException(ErrorCodes.FileNotFound, "The uploaded file path is invalid.");
        }

        var encoded = string.Join('/', segments.Select(Uri.EscapeDataString));
        return $"{_baseUrl}/storage/v1/object/{Uri.EscapeDataString(_bucket)}/{encoded}";
    }

    private async Task<ImportException> MapFailureAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var status = (int)response.StatusCode;
        _logger.LogWarning("Storage download failed with HTTP {Status}", status);

        // Supabase reports a missing object as 404, or as 400 with a "not_found" body.
        var notFound = response.StatusCode == HttpStatusCode.NotFound;
        if (!notFound && response.StatusCode == HttpStatusCode.BadRequest)
        {
            try
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                notFound = text.Contains("not_found", StringComparison.OrdinalIgnoreCase) ||
                           text.Contains("Object not found", StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException)
            {
                notFound = false;
            }
        }

        if (notFound)
        {
            return new ImportException(ErrorCodes.FileNotFound, "The uploaded file could not be found in storage.");
        }

        return new ImportException(ErrorCodes.StorageError, "The uploaded file could not be downloaded right now.", isTransient: true);
    }

    private static ImportException TooLarge(long maxBytes) =>
        new(ErrorCodes.FileTooLarge, $"The file is larger than the {maxBytes / (1024 * 1024)} MB limit.");
}

/// <summary>Reads files from a local directory (local development and tests). Paths cannot escape the root.</summary>
public sealed class LocalFileStorage : IFileStorage
{
    private readonly string _root;

    public LocalFileStorage(string root)
    {
        _root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
    }

    public async Task<byte[]> DownloadAsync(string storagePath, long maxBytes, CancellationToken ct)
    {
        var full = Path.GetFullPath(Path.Combine(_root, storagePath.TrimStart('/', '\\')));
        if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
        {
            throw new ImportException(ErrorCodes.FileNotFound, "The uploaded file path is invalid.");
        }

        try
        {
            var info = new FileInfo(full);
            if (!info.Exists)
            {
                throw new ImportException(ErrorCodes.FileNotFound, "The uploaded file could not be found in storage.");
            }

            if (info.Length > maxBytes)
            {
                throw new ImportException(ErrorCodes.FileTooLarge, $"The file is larger than the {maxBytes / (1024 * 1024)} MB limit.");
            }

            return await File.ReadAllBytesAsync(full, ct);
        }
        catch (IOException ex)
        {
            throw new ImportException(ErrorCodes.StorageError, "The uploaded file could not be read.", isTransient: true, inner: ex);
        }
    }
}
