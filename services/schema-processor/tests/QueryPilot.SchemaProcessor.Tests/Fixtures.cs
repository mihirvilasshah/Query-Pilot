using System.Text;
using Microsoft.SqlServer.Dac;
using Microsoft.SqlServer.Dac.Model;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Tests;

internal static class Fixtures
{
    public static string HospitalSql => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "TestData", "HospitalSchema.sql"));

    /// <summary>The hospital script minus constructs the DacFx model builder does not accept (SET ... at batch level).</summary>
    public static string HospitalSqlForDacpac => HospitalSql.Replace("SET ANSI_NULLS ON;\nGO", "").Replace("SET ANSI_NULLS ON;\r\nGO", "") +
        """

        CREATE PROCEDURE dbo.usp_Dynamic @tbl sysname
        AS
        BEGIN
            DECLARE @sql nvarchar(max) = N'SELECT * FROM ' + QUOTENAME(@tbl);
            EXEC (@sql);
            EXEC sp_executesql @sql;
        END;
        GO
        """;

    public static SchemaExtractionService Service(ExtractionLimits? limits = null) => new(limits ?? new ExtractionLimits());

    public static ExtractedSchema FromSql(string sql, string fileName = "script.sql", ExtractionLimits? limits = null) =>
        Service(limits).ExtractAndAnalyze("sql", fileName, Encoding.UTF8.GetBytes(sql));

    public static ExtractedSchema FromSqlBytes(byte[] bytes, string fileName = "script.sql") =>
        Service().ExtractAndAnalyze("sql", fileName, bytes);

    public static ExtractedSchema FromDacpac(byte[] dacpac, string fileName = "db.dacpac", ExtractionLimits? limits = null) =>
        Service(limits).ExtractAndAnalyze("dacpac", fileName, dacpac);

    /// <summary>Builds a real .dacpac in memory with DacFx (no database involved).</summary>
    public static byte[] BuildDacpac(string sql, string name = "HospitalDb")
    {
        using var model = new TSqlModel(SqlServerVersion.Sql160, new TSqlModelOptions());
        model.AddObjects(sql);
        using var ms = new MemoryStream();
        DacPackageExtensions.BuildPackage(ms, model, new PackageMetadata { Name = name, Version = "1.0.0" });
        return ms.ToArray();
    }

    public static SchemaObject Obj(this ExtractedSchema s, string type, string name, string? schema = null) =>
        s.Objects.Single(o => o.ObjectType == type && o.Name == name && (schema is null || o.SchemaName == schema));

    public static string NameOf(this ExtractedSchema s, Guid? id) =>
        id is null ? "" : s.Objects.Single(o => o.Id == id).DisplayName;

    public static IEnumerable<DependencyInfo> DepsFrom(this ExtractedSchema s, string type, string name) =>
        s.Dependencies.Where(d => s.Objects.Single(o => o.Id == d.SourceObjectId) is var o && o.ObjectType == type && o.Name == name);
}
