using System.IO.Compression;
using System.Xml;
using QueryPilot.SchemaProcessor.Extraction;

namespace QueryPilot.SchemaProcessor.Dacpac;

public sealed record DacpacInfo(string? DatabaseName, int EntryCount, long TotalUncompressedBytes);

/// <summary>
/// Structural checks on an untrusted .dacpac (an OPC/ZIP package) before DacFx ever sees it.
/// Nothing is extracted to disk.
/// </summary>
public static class DacpacValidator
{
    private static readonly byte[] ZipLocalHeader = [0x50, 0x4B, 0x03, 0x04];

    public static DacpacInfo Validate(byte[] content, ExtractionLimits limits)
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

        // The extension is not trusted; the content must be a ZIP.
        if (content.Length < 4 || !content.AsSpan(0, 4).SequenceEqual(ZipLocalHeader))
        {
            throw new ImportException(ErrorCodes.InvalidDacpac, "The file is not a valid .dacpac (it is not a ZIP package).");
        }

        try
        {
            using var stream = new MemoryStream(content, writable: false);
            using var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
            return Inspect(zip, limits);
        }
        catch (InvalidDataException)
        {
            throw new ImportException(ErrorCodes.InvalidDacpac, "The .dacpac package is corrupt or is not a valid ZIP archive.");
        }
    }

    private static DacpacInfo Inspect(ZipArchive zip, ExtractionLimits limits)
    {
        var entries = zip.Entries;
        if (entries.Count > limits.MaxZipEntries)
        {
            throw new ImportException(ErrorCodes.LimitsExceeded,
                $"The .dacpac contains too many entries (limit {limits.MaxZipEntries}).");
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        var buffer = new byte[81920];

        foreach (var entry in entries)
        {
            var name = entry.FullName;
            if (!IsSafeEntryName(name))
            {
                throw new ImportException(ErrorCodes.InvalidDacpac,
                    "The .dacpac contains an entry with an unsafe path and was rejected.");
            }

            if (!seen.Add(name))
            {
                throw new ImportException(ErrorCodes.InvalidDacpac, "The .dacpac contains duplicate entries.");
            }

            // Declared sizes come from the (attacker-controlled) header, so they are only a first filter...
            if (entry.Length > limits.MaxEntryBytes || (total += entry.Length) > limits.MaxUncompressedBytes)
            {
                throw new ImportException(ErrorCodes.LimitsExceeded,
                    "The .dacpac expands to more data than the allowed limit.");
            }

            // ...so every entry is also inflated into the void with hard caps on what is actually produced.
            long actual = 0;
            using (var s = entry.Open())
            {
                int read;
                while ((read = s.Read(buffer, 0, buffer.Length)) > 0)
                {
                    actual += read;
                    if (actual > limits.MaxEntryBytes || actual > entry.Length)
                    {
                        throw new ImportException(ErrorCodes.LimitsExceeded,
                            "The .dacpac expands to more data than the allowed limit.");
                    }
                }
            }

            if (actual >= limits.MinBytesForRatioCheck &&
                actual / (double)Math.Max(1, entry.CompressedLength) > limits.MaxCompressionRatio)
            {
                throw new ImportException(ErrorCodes.LimitsExceeded,
                    "The .dacpac has an abnormal compression ratio and was rejected.");
            }
        }

        if (entries.All(e => !e.FullName.Equals("model.xml", StringComparison.OrdinalIgnoreCase)))
        {
            throw new ImportException(ErrorCodes.InvalidDacpac, "The .dacpac is missing the required 'model.xml' entry.");
        }

        var metadata = entries.FirstOrDefault(e => e.FullName.Equals("DacMetadata.xml", StringComparison.OrdinalIgnoreCase));
        var origin = entries.FirstOrDefault(e => e.FullName.Equals("Origin.xml", StringComparison.OrdinalIgnoreCase));
        if (metadata is null && origin is null)
        {
            throw new ImportException(ErrorCodes.InvalidDacpac,
                "The .dacpac is missing the required 'DacMetadata.xml' (or 'Origin.xml') entry.");
        }

        return new DacpacInfo(metadata is null ? null : ReadDatabaseName(metadata), entries.Count, total);
    }

    internal static bool IsSafeEntryName(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Contains('\0') || name.Length > 1024)
        {
            return false;
        }

        if (name[0] is '/' or '\\' || (name.Length >= 2 && name[1] == ':'))
        {
            return false;
        }

        foreach (var segment in name.Split('/', '\\'))
        {
            if (segment == "..")
            {
                return false;
            }
        }

        return true;
    }

    private static string? ReadDatabaseName(ZipArchiveEntry entry)
    {
        if (entry.Length > 1024 * 1024)
        {
            return null;
        }

        try
        {
            using var stream = entry.Open();
            var settings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersInDocument = 2 * 1024 * 1024,
            };
            using var reader = XmlReader.Create(stream, settings);
            while (reader.Read())
            {
                if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "Name")
                {
                    var value = reader.ReadElementContentAsString().Trim();
                    return value.Length is > 0 and <= 256 ? value : null;
                }
            }
        }
        catch (XmlException)
        {
            // Metadata is optional for our purposes; DacFx reports real corruption when it loads the model.
        }

        return null;
    }
}
