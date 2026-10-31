using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Tests;

public class DependencyAnalysisTests
{
    private static ExtractedSchema Parse(string body, string extra = "") =>
        Fixtures.FromSql($$"""
            CREATE TABLE dbo.Orders (Id int, Total money);
            GO
            CREATE TABLE dbo.Archive (Id int);
            GO
            CREATE TABLE audit.Log (Id int);
            GO
            CREATE FUNCTION dbo.fn_Tax(@x money) RETURNS money AS BEGIN RETURN @x * 0.1; END;
            GO
            CREATE PROCEDURE dbo.usp_Helper AS SELECT 1;
            GO
            {{extra}}
            CREATE PROCEDURE dbo.usp_Subject AS
            BEGIN
            {{body}}
            END;
            """);

    private static IReadOnlyList<DependencyInfo> Deps(ExtractedSchema s) => s.DepsFrom("procedure", "usp_Subject").ToList();

    [Fact]
    public void Read_write_operations_are_classified_per_table()
    {
        var s = Parse("""
            SELECT * FROM dbo.Orders o JOIN audit.Log l ON l.Id = o.Id;
            INSERT INTO dbo.Archive (Id) SELECT Id FROM dbo.Orders;
            DELETE FROM dbo.Orders WHERE Id = 1;
            TRUNCATE TABLE audit.Log;
            """);
        var deps = Deps(s);

        var archive = deps.Single(d => d.TargetName == "Archive");
        Assert.Equal("writes", archive.Kind);
        Assert.Equal(["insert"], archive.Operations);

        var orders = deps.Where(d => d.TargetName == "Orders").ToDictionary(d => d.Kind);
        Assert.Equal(["select"], orders["reads"].Operations);
        Assert.Equal(["delete"], orders["writes"].Operations);

        Assert.Equal(["select"], deps.Single(d => d.TargetName == "Log" && d.Kind == "reads").Operations);
        Assert.Equal(["truncate"], deps.Single(d => d.TargetName == "Log" && d.Kind == "writes").Operations);
        Assert.All(deps, d => Assert.Equal(DependencyConfidences.ParsedReference, d.Confidence));
        Assert.All(deps, d => Assert.Equal("scriptdom", d.Origin));

        var ops = s.Obj("procedure", "usp_Subject").Metadata.Operations!;
        Assert.Equal((1, 1, 0, 1, 0), (ops.Select, ops.Insert, ops.Update, ops.Delete, ops.Merge));
    }

    [Fact]
    public void Update_through_an_alias_targets_the_real_table_and_merge_is_a_write()
    {
        var s = Parse("""
            UPDATE o SET Total = 0 FROM dbo.Orders o JOIN dbo.Archive a ON a.Id = o.Id;
            MERGE dbo.Archive AS t USING dbo.Orders AS src ON t.Id = src.Id
              WHEN NOT MATCHED THEN INSERT (Id) VALUES (src.Id);
            """);
        var deps = Deps(s);

        var orders = deps.Where(d => d.TargetName == "Orders").ToList();
        Assert.Contains(orders, d => d.Kind == "writes" && d.Operations.SequenceEqual(["update"]));
        Assert.Contains(orders, d => d.Kind == "reads");
        var archive = deps.Where(d => d.TargetName == "Archive").ToList();
        Assert.Contains(archive, d => d.Kind == "writes" && d.Operations.Contains("merge"));
        Assert.DoesNotContain(deps, d => d.TargetName == "o" || d.TargetName == "t");
        Assert.Equal(1, s.Obj("procedure", "usp_Subject").Metadata.Operations!.Merge);
    }

    [Fact]
    public void Ctes_temp_tables_and_table_variables_are_not_dependencies()
    {
        var s = Parse("""
            DECLARE @tv TABLE (Id int);
            CREATE TABLE #tmp (Id int);
            SELECT Id INTO ##global FROM dbo.Orders;
            WITH cte AS (SELECT Id FROM dbo.Archive)
            SELECT c.Id FROM cte c JOIN #tmp t ON t.Id = c.Id JOIN @tv v ON v.Id = c.Id;
            """);
        var deps = Deps(s);
        var meta = s.Obj("procedure", "usp_Subject").Metadata;

        Assert.DoesNotContain(deps, d => d.TargetName is "cte" or "#tmp" or "##global" or "tv");
        Assert.Equal(["##global", "#tmp"], meta.TemporaryTables);
        Assert.Equal(["@tv"], meta.TableVariables);
        Assert.Contains(deps, d => d.TargetName == "Archive" && d.Kind == "reads");
        Assert.Contains(deps, d => d.TargetName == "Orders" && d.Kind == "reads");
    }

    [Fact]
    public void Exec_and_function_calls_are_recorded_and_builtins_are_not()
    {
        var s = Parse("""
            DECLARE @rc int;
            EXEC @rc = dbo.usp_Helper;
            SELECT dbo.fn_Tax(Total), GETDATE(), COUNT(*), UPPER('a') FROM dbo.Orders;
            """);
        var deps = Deps(s);

        var exec = deps.Single(d => d.Kind == "executes");
        Assert.Equal(("usp_Helper", "procedure"), (exec.TargetName, exec.TargetType));
        Assert.Equal(["exec"], exec.Operations);
        Assert.NotNull(exec.TargetObjectId);

        var fn = deps.Single(d => d.Kind == "calls_function");
        Assert.Equal("fn_Tax", fn.TargetName);
        Assert.NotNull(fn.TargetObjectId);
        Assert.Equal(1, deps.Count(d => d.Kind == "calls_function"));
    }

    [Fact]
    public void Nested_procedure_calls_form_a_chain()
    {
        var s = Fixtures.FromSql("""
            CREATE PROCEDURE dbo.usp_C AS SELECT 1;
            GO
            CREATE PROCEDURE dbo.usp_B AS EXEC dbo.usp_C;
            GO
            CREATE PROCEDURE dbo.usp_A AS EXEC dbo.usp_B;
            """);

        Assert.Equal("usp_B", s.NameOf(s.DepsFrom("procedure", "usp_A").Single().TargetObjectId).Split('.')[1]);
        Assert.Equal("usp_C", s.NameOf(s.DepsFrom("procedure", "usp_B").Single().TargetObjectId).Split('.')[1]);
    }

    [Fact]
    public void Dynamic_sql_produces_one_unresolved_row_per_occurrence()
    {
        var s = Parse("""
            DECLARE @sql nvarchar(max) = N'SELECT 1';
            EXEC (@sql);
            EXEC ('SELECT * FROM dbo.Orders');
            EXEC sp_executesql @sql;
            """);

        var dynamic = Deps(s).Where(d => d.Confidence == DependencyConfidences.UnresolvedDynamic).ToList();
        Assert.Equal(3, dynamic.Count);
        Assert.All(dynamic, d =>
        {
            Assert.Equal("executes", d.Kind);
            Assert.Null(d.TargetObjectId);
            Assert.NotNull(d.Note);
            Assert.NotNull(d.Line);
        });
        Assert.Equal(3, dynamic.Select(d => d.Line).Distinct().Count());
        Assert.DoesNotContain(Deps(s), d => d.TargetName == "sp_executesql");

        var meta = s.Obj("procedure", "usp_Subject").Metadata;
        Assert.True(meta.HasDynamicSql);
        Assert.Equal(3, meta.DynamicSqlCount);
    }

    [Fact]
    public void Unresolved_references_keep_names_and_get_a_note()
    {
        var s = Parse("""
            SELECT * FROM OtherDb.dbo.Remote;
            SELECT * FROM dbo.DoesNotExist;
            SELECT * FROM sys.objects;
            EXEC dbo.usp_Missing;
            """);
        var deps = Deps(s);

        var remote = deps.Single(d => d.TargetName == "Remote");
        Assert.Null(remote.TargetObjectId);
        Assert.Contains("not found in imported schema", remote.Note);
        Assert.Contains("OtherDb", remote.Note);
        Assert.Equal(DependencyConfidences.ParsedReference, remote.Confidence);

        Assert.Equal("not found in imported schema", deps.Single(d => d.TargetName == "DoesNotExist").Note);
        Assert.Contains(deps, d => d.TargetName == "objects" && d.TargetObjectId is null);
        var missing = deps.Single(d => d.TargetName == "usp_Missing");
        Assert.Equal("procedure", missing.TargetType);
    }

    [Fact]
    public void Unqualified_names_resolve_to_dbo_then_to_a_unique_match_else_stay_unresolved()
    {
        var s = Fixtures.FromSql("""
            CREATE SCHEMA a; 
            GO
            CREATE SCHEMA b;
            GO
            CREATE TABLE dbo.InDbo (Id int);
            CREATE TABLE a.OnlyInA (Id int);
            CREATE TABLE a.Both (Id int);
            CREATE TABLE b.Both (Id int);
            GO
            CREATE VIEW dbo.vAll AS
            SELECT x.Id FROM InDbo x
            UNION ALL SELECT y.Id FROM OnlyInA y
            UNION ALL SELECT z.Id FROM Both z;
            """);
        var deps = s.DepsFrom("view", "vAll").ToList();

        Assert.Equal("dbo.InDbo", s.NameOf(deps.Single(d => d.TargetName == "InDbo").TargetObjectId));
        Assert.Equal("a.OnlyInA", s.NameOf(deps.Single(d => d.TargetName == "OnlyInA").TargetObjectId));
        var both = deps.Single(d => d.TargetName == "Both");
        Assert.Null(both.TargetObjectId);
        Assert.Contains("ambiguous", both.Note);
    }

    [Fact]
    public void Name_resolution_is_case_insensitive()
    {
        var s = Parse("SELECT * FROM DBO.ORDERS;");
        var dep = Deps(s).Single(d => d.Kind == "reads");
        Assert.NotNull(dep.TargetObjectId);
        Assert.Equal("Orders", dep.TargetName);
    }

    [Fact]
    public void View_dependencies_and_sequence_references_are_found()
    {
        var s = Fixtures.FromSql("""
            CREATE SEQUENCE dbo.OrderSeq START WITH 1;
            GO
            CREATE TABLE dbo.T (Id int);
            GO
            CREATE VIEW dbo.V AS SELECT Id, NEXT VALUE FOR dbo.OrderSeq AS N FROM dbo.T;
            """);
        var deps = s.DepsFrom("view", "V").ToList();

        Assert.Contains(deps, d => d.Kind == "reads" && d.TargetName == "T" && d.TargetObjectId is not null);
        Assert.Contains(deps, d => d.Kind == "references" && d.TargetName == "OrderSeq" && d.TargetObjectId is not null);
    }
}
