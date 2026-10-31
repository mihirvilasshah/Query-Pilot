using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Jobs;
using QueryPilot.SchemaProcessor.Services;

namespace QueryPilot.SchemaProcessor.Tests;

public class ConfigurationAndStorageTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "qp-tests-" + Guid.NewGuid().ToString("N"));

    public ConfigurationAndStorageTests() => Directory.CreateDirectory(_dir);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void Postgres_uri_is_converted_including_encoded_password_and_ssl_mode()
    {
        var cs = new NpgsqlConnectionStringBuilder(PostgresConnectionString.Normalize(
            "postgres://worker:p%40ss%3Aw%2Frd@db.example.com:6543/postgres?sslmode=require"));

        Assert.Equal("db.example.com", cs.Host);
        Assert.Equal(6543, cs.Port);
        Assert.Equal("worker", cs.Username);
        Assert.Equal("p@ss:w/rd", cs.Password);
        Assert.Equal("postgres", cs.Database);
        Assert.Equal(SslMode.Require, cs.SslMode);
    }

    [Fact]
    public void Postgres_uri_defaults_port_and_database()
    {
        var cs = new NpgsqlConnectionStringBuilder(PostgresConnectionString.Normalize("postgresql://u:p@localhost"));

        Assert.Equal("localhost", cs.Host);
        Assert.Equal(5432, cs.Port);
        Assert.Equal("postgres", cs.Database);
    }

    [Fact]
    public void Npgsql_connection_strings_are_accepted_as_is()
    {
        var cs = new NpgsqlConnectionStringBuilder(PostgresConnectionString.Normalize(
            "Host=h;Port=5433;Username=u;Password=pw;Database=d"));

        Assert.Equal((("h", 5433, "u", "pw", "d")), (cs.Host, cs.Port, cs.Username, cs.Password, cs.Database));
    }

    [Fact]
    public void Options_validation_lists_problems_without_echoing_secrets()
    {
        var options = new WorkerOptions { SupabaseServiceRoleKey = "super-secret-key" };
        var problems = options.Validate();

        Assert.Contains(problems, p => p.Contains("DATABASE_URL"));
        Assert.Contains(problems, p => p.Contains("SUPABASE_URL"));
        Assert.DoesNotContain(problems, p => p.Contains("super-secret-key"));
        Assert.Empty(new WorkerOptions { DatabaseUrl = "x", LocalStorageDir = _dir }.Validate());
    }

    [Fact]
    public void Options_defaults_match_the_documented_values()
    {
        var o = new WorkerOptions();

        Assert.Equal("schema-uploads", o.StorageBucket);
        Assert.Equal(3, o.PollIntervalSeconds);
        Assert.Equal(600, o.StaleJobSeconds);
        Assert.Equal(52_428_800, o.MaxFileBytes);
        Assert.StartsWith(Environment.MachineName, o.WorkerId);
        Assert.Equal(52_428_800, o.ToLimits().MaxFileBytes);
    }

    [Fact]
    public async Task Local_storage_reads_files_under_its_root()
    {
        Directory.CreateDirectory(Path.Combine(_dir, "owner"));
        await File.WriteAllTextAsync(Path.Combine(_dir, "owner", "a.sql"), "SELECT 1");
        var storage = new LocalFileStorage(_dir);

        Assert.Equal("SELECT 1"u8.ToArray(), await storage.DownloadAsync("owner/a.sql", 1000, default));
        Assert.Equal("SELECT 1"u8.ToArray(), await storage.DownloadAsync("/owner/a.sql", 1000, default));
    }

    [Theory]
    [InlineData("../outside.sql")]
    [InlineData("owner/../../outside.sql")]
    [InlineData("..\\outside.sql")]
    public async Task Local_storage_cannot_escape_its_root(string path)
    {
        await File.WriteAllTextAsync(Path.Combine(Path.GetDirectoryName(_dir)!, "outside.sql"), "secret");
        try
        {
            var ex = await Assert.ThrowsAsync<ImportException>(() => new LocalFileStorage(_dir).DownloadAsync(path, 1000, default));
            Assert.Equal(ErrorCodes.FileNotFound, ex.Code);
        }
        finally
        {
            File.Delete(Path.Combine(Path.GetDirectoryName(_dir)!, "outside.sql"));
        }
    }

    [Fact]
    public async Task Local_storage_enforces_size_cap_and_reports_missing_files()
    {
        await File.WriteAllBytesAsync(Path.Combine(_dir, "big.sql"), new byte[200]);
        var storage = new LocalFileStorage(_dir);

        Assert.Equal(ErrorCodes.FileTooLarge, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("big.sql", 100, default))).Code);
        Assert.Equal(ErrorCodes.FileNotFound, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("nope.sql", 100, default))).Code);
    }

    [Fact]
    public async Task Supabase_storage_sends_auth_headers_and_maps_failures()
    {
        var handler = new StubHandler();
        var options = new WorkerOptions { SupabaseUrl = "https://proj.supabase.co/", SupabaseServiceRoleKey = "KEY123", StorageBucket = "schema-uploads" };
        var storage = new SupabaseFileStorage(new HttpClient(handler), options, NullLogger<SupabaseFileStorage>.Instance);

        handler.Respond = _ => new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new ByteArrayContent("SELECT 1"u8.ToArray()) };
        var bytes = await storage.DownloadAsync("user id/a b.sql", 1000, default);

        Assert.Equal("SELECT 1"u8.ToArray(), bytes);
        Assert.Equal("https://proj.supabase.co/storage/v1/object/schema-uploads/user%20id/a%20b.sql", handler.LastRequest!.RequestUri!.AbsoluteUri);
        Assert.Equal("Bearer KEY123", handler.LastRequest.Headers.GetValues("Authorization").Single());
        Assert.Equal("KEY123", handler.LastRequest.Headers.GetValues("apikey").Single());

        handler.Respond = _ => new HttpResponseMessage(System.Net.HttpStatusCode.NotFound);
        Assert.Equal(ErrorCodes.FileNotFound, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("x.sql", 1000, default))).Code);

        handler.Respond = _ => new HttpResponseMessage(System.Net.HttpStatusCode.BadRequest) { Content = new StringContent("{\"error\":\"not_found\"}") };
        Assert.Equal(ErrorCodes.FileNotFound, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("x.sql", 1000, default))).Code);

        handler.Respond = _ => new HttpResponseMessage(System.Net.HttpStatusCode.BadGateway);
        var transient = await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("x.sql", 1000, default));
        Assert.True(transient.IsTransient);
        Assert.DoesNotContain("KEY123", transient.Message);

        handler.Respond = _ => throw new HttpRequestException("boom KEY123");
        var network = await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("x.sql", 1000, default));
        Assert.True(network.IsTransient);
        Assert.DoesNotContain("KEY123", network.Message);

        handler.Respond = _ => new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[500]) };
        Assert.Equal(ErrorCodes.FileTooLarge, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("x.sql", 100, default))).Code);

        Assert.Equal(ErrorCodes.FileNotFound, (await Assert.ThrowsAsync<ImportException>(() => storage.DownloadAsync("a/../b.sql", 100, default))).Code);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage();
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(Respond(request));
        }
    }
}
