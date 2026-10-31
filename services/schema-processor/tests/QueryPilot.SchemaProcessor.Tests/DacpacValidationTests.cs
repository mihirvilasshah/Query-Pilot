using System.IO.Compression;
using System.Text;
using QueryPilot.SchemaProcessor.Dacpac;
using QueryPilot.SchemaProcessor.Extraction;

namespace QueryPilot.SchemaProcessor.Tests;

public class DacpacValidationTests
{
    private static byte[] Zip(Action<ZipArchive> fill)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            fill(zip);
        }

        return ms.ToArray();
    }

    private static void Add(ZipArchive zip, string name, byte[] content, CompressionLevel level = CompressionLevel.Optimal)
    {
        var entry = zip.CreateEntry(name, level);
        using var s = entry.Open();
        s.Write(content);
    }

    private static void Add(ZipArchive zip, string name, string content) => Add(zip, name, Encoding.UTF8.GetBytes(content));

    private static byte[] MinimalPackage(Action<ZipArchive>? extra = null) => Zip(z =>
    {
        Add(z, "model.xml", "<x/>");
        Add(z, "DacMetadata.xml", "<DacType xmlns=\"http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02\"><Name>MyDb</Name></DacType>");
        extra?.Invoke(z);
    });

    private static ImportException Fails(byte[] content, ExtractionLimits? limits = null) =>
        Assert.Throws<ImportException>(() => DacpacValidator.Validate(content, limits ?? new ExtractionLimits()));

    [Fact]
    public void Random_bytes_are_rejected_regardless_of_extension()
    {
        var bytes = new byte[2048];
        new Random(42).NextBytes(bytes);

        var ex = Fails(bytes);
        Assert.Equal(ErrorCodes.InvalidDacpac, ex.Code);
        Assert.False(ex.IsTransient);
    }

    [Fact]
    public void Text_file_renamed_to_dacpac_is_rejected()
    {
        Assert.Equal(ErrorCodes.InvalidDacpac, Fails(Encoding.UTF8.GetBytes("CREATE TABLE dbo.T (Id int);")).Code);
    }

    [Fact]
    public void Empty_file_is_rejected()
    {
        Assert.Equal(ErrorCodes.EmptyFile, Fails([]).Code);
    }

    [Fact]
    public void Truncated_zip_with_valid_magic_is_rejected()
    {
        var good = MinimalPackage();
        var ex = Fails(good[..(good.Length / 2)]);
        Assert.Equal(ErrorCodes.InvalidDacpac, ex.Code);
    }

    [Fact]
    public void Valid_zip_without_model_xml_is_rejected()
    {
        var zip = Zip(z => Add(z, "DacMetadata.xml", "<DacType><Name>x</Name></DacType>"));
        var ex = Fails(zip);

        Assert.Equal(ErrorCodes.InvalidDacpac, ex.Code);
        Assert.Contains("model.xml", ex.Message);
    }

    [Fact]
    public void Valid_zip_without_metadata_is_rejected()
    {
        var zip = Zip(z => Add(z, "model.xml", "<x/>"));
        var ex = Fails(zip);
        Assert.Contains("DacMetadata.xml", ex.Message);
    }

    [Fact]
    public void Origin_xml_is_accepted_in_place_of_metadata()
    {
        var zip = Zip(z =>
        {
            Add(z, "model.xml", "<x/>");
            Add(z, "Origin.xml", "<x/>");
        });

        var info = DacpacValidator.Validate(zip, new ExtractionLimits());
        Assert.Null(info.DatabaseName);
    }

    [Theory]
    [InlineData("../evil.txt")]
    [InlineData("a/../../evil.txt")]
    [InlineData("..\\evil.txt")]
    [InlineData("a\\..\\..\\evil.txt")]
    [InlineData("/etc/passwd")]
    [InlineData("\\windows\\system32\\x")]
    [InlineData("C:\\temp\\x.txt")]
    [InlineData("C:/temp/x.txt")]
    public void Zip_slip_entry_names_are_rejected(string entryName)
    {
        var zip = MinimalPackage(z => Add(z, entryName, "owned"));
        var ex = Fails(zip);

        Assert.Equal(ErrorCodes.InvalidDacpac, ex.Code);
        Assert.DoesNotContain("evil", ex.Message);
    }

    [Fact]
    public void Excessive_entry_count_is_rejected()
    {
        var zip = MinimalPackage(z =>
        {
            for (var i = 0; i < 20; i++)
            {
                Add(z, $"extra{i}.txt", "x");
            }
        });

        var ex = Fails(zip, new ExtractionLimits { MaxZipEntries = 10 });
        Assert.Equal(ErrorCodes.LimitsExceeded, ex.Code);
    }

    [Fact]
    public void Zip_bomb_exceeding_total_uncompressed_size_is_rejected()
    {
        var zip = MinimalPackage(z => Add(z, "big.bin", new byte[3 * 1024 * 1024]));
        var ex = Fails(zip, new ExtractionLimits { MaxUncompressedBytes = 1024 * 1024, MaxEntryBytes = 10 * 1024 * 1024 });

        Assert.Equal(ErrorCodes.LimitsExceeded, ex.Code);
    }

    [Fact]
    public void Single_entry_exceeding_per_entry_limit_is_rejected()
    {
        var zip = MinimalPackage(z => Add(z, "big.bin", new byte[2 * 1024 * 1024]));
        var ex = Fails(zip, new ExtractionLimits { MaxEntryBytes = 1024 * 1024 });

        Assert.Equal(ErrorCodes.LimitsExceeded, ex.Code);
    }

    [Fact]
    public void Abnormal_compression_ratio_is_rejected()
    {
        var zip = MinimalPackage(z => Add(z, "zeros.bin", new byte[2 * 1024 * 1024]));
        var limits = new ExtractionLimits { MaxCompressionRatio = 50, MinBytesForRatioCheck = 1024 };

        var ex = Fails(zip, limits);
        Assert.Equal(ErrorCodes.LimitsExceeded, ex.Code);
        Assert.Contains("compression ratio", ex.Message);
    }

    [Fact]
    public void Oversized_upload_is_rejected_before_inspection()
    {
        var ex = Fails(MinimalPackage(), new ExtractionLimits { MaxFileBytes = 10 });
        Assert.Equal(ErrorCodes.FileTooLarge, ex.Code);
    }

    [Fact]
    public void Well_formed_package_passes_and_exposes_database_name()
    {
        var info = DacpacValidator.Validate(MinimalPackage(), new ExtractionLimits());
        Assert.Equal("MyDb", info.DatabaseName);
        Assert.Equal(2, info.EntryCount);
    }

    [Fact]
    public void Real_dacfx_package_passes_validation()
    {
        var info = DacpacValidator.Validate(Fixtures.BuildDacpac("CREATE TABLE dbo.T (Id int);"), new ExtractionLimits());
        Assert.Equal("HospitalDb", info.DatabaseName);
    }

    [Fact]
    public void Package_with_valid_structure_but_garbage_model_fails_cleanly_in_extraction()
    {
        var zip = MinimalPackage();
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromDacpac(zip));

        Assert.Equal(ErrorCodes.InvalidDacpac, ex.Code);
        Assert.False(ex.IsTransient);
    }

    [Fact]
    public void Unsafe_entry_name_check_has_no_false_positives()
    {
        Assert.True(DacpacValidator.IsSafeEntryName("model.xml"));
        Assert.True(DacpacValidator.IsSafeEntryName("[Content_Types].xml"));
        Assert.True(DacpacValidator.IsSafeEntryName("a/b..c/d.txt"));
        Assert.False(DacpacValidator.IsSafeEntryName(".."));
        Assert.False(DacpacValidator.IsSafeEntryName(""));
    }
}
