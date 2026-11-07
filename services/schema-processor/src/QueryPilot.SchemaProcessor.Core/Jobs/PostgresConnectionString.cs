using System.Web;
using Npgsql;

namespace QueryPilot.SchemaProcessor.Jobs;

/// <summary>Accepts either a postgres:// URI or an Npgsql connection string.</summary>
public static class PostgresConnectionString
{
    public static string Normalize(string databaseUrl)
    {
        var trimmed = databaseUrl.Trim();
        var builder = trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
                      trimmed.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase)
            ? FromUri(trimmed)
            : new NpgsqlConnectionStringBuilder(trimmed);

        if (string.IsNullOrEmpty(builder.ApplicationName))
        {
            builder.ApplicationName = "querypilot-schema-processor";
        }

        if (builder.CommandTimeout == 30)
        {
            builder.CommandTimeout = 120;
        }

        builder.Pooling = true;
        if (builder.MaxPoolSize == 100)
        {
            builder.MaxPoolSize = 10; // a single worker needs very few connections
        }

        // Npgsql 10 probes GSSAPI encryption by default. Slim/runtime Linux images do not
        // ship libgssapi_krb5.so.2; the probe then logs a fatal-looking error and can
        // stall the first connection. This worker authenticates with a password over SSL.
        builder.GssEncryptionMode = GssEncryptionMode.Disable;

        return builder.ConnectionString;
    }

    private static NpgsqlConnectionStringBuilder FromUri(string url)
    {
        // Uri cannot parse every legal password; take userinfo from the raw string ourselves.
        var schemeEnd = url.IndexOf("://", StringComparison.Ordinal) + 3;
        var rest = url[schemeEnd..];
        var at = rest.LastIndexOf('@');
        string? user = null, password = null;
        if (at >= 0)
        {
            var userInfo = rest[..at];
            rest = rest[(at + 1)..];
            var colon = userInfo.IndexOf(':');
            user = Uri.UnescapeDataString(colon >= 0 ? userInfo[..colon] : userInfo);
            password = colon >= 0 ? Uri.UnescapeDataString(userInfo[(colon + 1)..]) : null;
        }

        var queryStart = rest.IndexOf('?');
        var query = queryStart >= 0 ? rest[(queryStart + 1)..] : "";
        var hostPathPart = queryStart >= 0 ? rest[..queryStart] : rest;
        var slash = hostPathPart.IndexOf('/');
        var hostPort = slash >= 0 ? hostPathPart[..slash] : hostPathPart;
        var database = slash >= 0 ? Uri.UnescapeDataString(hostPathPart[(slash + 1)..]) : "postgres";

        var builder = new NpgsqlConnectionStringBuilder { Database = string.IsNullOrEmpty(database) ? "postgres" : database };
        var portIdx = hostPort.LastIndexOf(':');
        if (portIdx > 0 && int.TryParse(hostPort[(portIdx + 1)..], out var port))
        {
            builder.Host = hostPort[..portIdx];
            builder.Port = port;
        }
        else
        {
            builder.Host = hostPort;
        }

        if (user is not null)
        {
            builder.Username = user;
        }

        if (password is not null)
        {
            builder.Password = password;
        }

        var parameters = HttpUtility.ParseQueryString(query);
        if (parameters["sslmode"] is { } ssl)
        {
            builder.SslMode = ssl.ToLowerInvariant() switch
            {
                "disable" => SslMode.Disable,
                "allow" => SslMode.Allow,
                "prefer" => SslMode.Prefer,
                "verify-ca" => SslMode.VerifyCA,
                "verify-full" => SslMode.VerifyFull,
                _ => SslMode.Require,
            };
        }

        return builder;
    }
}
