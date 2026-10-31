using System.Text;

namespace QueryPilot.SchemaProcessor.SqlParser;

public sealed record DecodedSql(string Text, string EncodingName, bool UsedFallback);

/// <summary>Validates that bytes look like a SQL text file and decodes them (BOM-aware).</summary>
public static class SqlTextDecoder
{
    private static readonly (byte[] Magic, string Name)[] BinarySignatures =
    [
        ([0x50, 0x4B, 0x03, 0x04], "ZIP archive"),
        ([0x50, 0x4B, 0x05, 0x06], "ZIP archive"),
        ([0x4D, 0x5A], "Windows executable"),
        ([0x7F, 0x45, 0x4C, 0x46], "ELF executable"),
        ([0x25, 0x50, 0x44, 0x46], "PDF document"),
        ([0x1F, 0x8B], "gzip archive"),
        ([0x37, 0x7A, 0xBC, 0xAF], "7-Zip archive"),
        ([0x52, 0x61, 0x72, 0x21], "RAR archive"),
        ([0xD0, 0xCF, 0x11, 0xE0], "Office/OLE document"),
        ([0x89, 0x50, 0x4E, 0x47], "PNG image"),
        ([0xFF, 0xD8, 0xFF], "JPEG image"),
        ([0x47, 0x49, 0x46, 0x38], "GIF image"),
    ];

    public static DecodedSql Decode(ReadOnlySpan<byte> bytes)
    {
        foreach (var (magic, name) in BinarySignatures)
        {
            if (bytes.StartsWith(magic))
            {
                throw new Extraction.ImportException(
                    Extraction.ErrorCodes.InvalidSql,
                    $"The file looks like a binary file ({name}), not a SQL script.");
            }
        }

        string text;
        string encodingName;
        var fallback = false;

        if (bytes.StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }))
        {
            text = Encoding.UTF8.GetString(bytes[3..]);
            encodingName = "utf-8-bom";
        }
        else if (bytes.StartsWith(new byte[] { 0xFF, 0xFE }))
        {
            text = Encoding.Unicode.GetString(bytes[2..]);
            encodingName = "utf-16le";
        }
        else if (bytes.StartsWith(new byte[] { 0xFE, 0xFF }))
        {
            text = Encoding.BigEndianUnicode.GetString(bytes[2..]);
            encodingName = "utf-16be";
        }
        else
        {
            // Without a BOM a NUL byte means the content is not text (or is BOM-less UTF-16, which we do not guess).
            if (bytes.IndexOf((byte)0) >= 0)
            {
                throw new Extraction.ImportException(
                    Extraction.ErrorCodes.InvalidSql,
                    "The file contains binary data (NUL bytes) and cannot be read as a SQL script.");
            }

            try
            {
                text = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes);
                encodingName = "utf-8";
            }
            catch (DecoderFallbackException)
            {
                text = Encoding.Latin1.GetString(bytes);
                encodingName = "latin1";
                fallback = true;
            }
        }

        if (text.Contains('\0') || ControlCharRatio(text) > 0.02)
        {
            throw new Extraction.ImportException(
                Extraction.ErrorCodes.InvalidSql,
                "The file contains binary data and cannot be read as a SQL script.");
        }

        return new DecodedSql(text, encodingName, fallback);
    }

    private static double ControlCharRatio(string text)
    {
        if (text.Length == 0)
        {
            return 0;
        }

        var sample = text.Length > 1_000_000 ? text.AsSpan(0, 1_000_000) : text.AsSpan();
        var bad = 0;
        foreach (var c in sample)
        {
            if (char.IsControl(c) && c is not ('\r' or '\n' or '\t' or '\f' or '\v'))
            {
                bad++;
            }
        }

        return (double)bad / sample.Length;
    }
}
