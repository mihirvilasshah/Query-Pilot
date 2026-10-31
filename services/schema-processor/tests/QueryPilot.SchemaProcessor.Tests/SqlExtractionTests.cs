using System.Text;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;
using QueryPilot.SchemaProcessor.SqlParser;

namespace QueryPilot.SchemaProcessor.Tests;

public class SqlExtractionTests
{
    // ---------------------------------------------------------------- input validation

    [Theory]
    [InlineData("")]
    [InlineData("   \r\n\t  ")]
    public void Empty_or_whitespace_file_is_rejected(string content)
    {
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromSql(content));
        Assert.Equal(ErrorCodes.EmptyFile, ex.Code);
        Assert.False(ex.IsTransient);
    }

    [Fact]
    public void File_with_only_go_lines_counts_as_empty()
    {
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromSql("GO\nGO\n"));
        Assert.Equal(ErrorCodes.EmptyFile, ex.Code);
    }

    [Fact]
    public void Binary_looking_content_is_rejected()
    {
        byte[] nul = [0x43, 0x52, 0x00, 0x45, 0x41, 0x54, 0x45];
        Assert.Equal(ErrorCodes.InvalidSql, Assert.Throws<ImportException>(() => Fixtures.FromSqlBytes(nul)).Code);

        byte[] zip = [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00];
        Assert.Equal(ErrorCodes.InvalidSql, Assert.Throws<ImportException>(() => Fixtures.FromSqlBytes(zip)).Code);

        byte[] exe = [0x4D, 0x5A, 0x90, 0x00, 0x03];
        Assert.Equal(ErrorCodes.InvalidSql, Assert.Throws<ImportException>(() => Fixtures.FromSqlBytes(exe)).Code);
    }

    [Fact]
    public void Oversized_script_is_rejected()
    {
        var limits = new ExtractionLimits { MaxFileBytes = 100 };
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromSql(new string('-', 500), limits: limits));
        Assert.Equal(ErrorCodes.FileTooLarge, ex.Code);
    }

    [Fact]
    public void Utf16_le_with_bom_is_decoded()
    {
        var sql = "CREATE TABLE dbo.Wide (Id int NOT NULL, Name nvarchar(10) NULL);";
        var bytes = Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(sql)).ToArray();

        var schema = Fixtures.FromSqlBytes(bytes);

        Assert.Equal(["Id", "Name"], schema.Obj("table", "Wide").Columns.Select(c => c.Name).ToArray());
        Assert.Equal(sql, schema.Obj("table", "Wide").Definition);
    }

    [Fact]
    public void Utf16_be_and_utf8_bom_are_decoded()
    {
        var sql = "CREATE TABLE dbo.T1 (Id int);";
        var be = Encoding.BigEndianUnicode.GetPreamble().Concat(Encoding.BigEndianUnicode.GetBytes(sql)).ToArray();
        var u8 = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sql)).ToArray();

        Assert.Equal(sql, Fixtures.FromSqlBytes(be).Obj("table", "T1").Definition);
        Assert.Equal(sql, Fixtures.FromSqlBytes(u8).Obj("table", "T1").Definition);
    }

    [Fact]
    public void Invalid_utf8_without_bom_falls_back_to_latin1_with_a_warning()
    {
        var bytes = Encoding.Latin1.GetBytes("CREATE TABLE dbo.Caf\u00e9 (Id int); -- caf\u00e9\n");
        var schema = Fixtures.FromSqlBytes(bytes);

        Assert.Contains(schema.Warnings, w => w.Code == WarningCodes.SourceEncoding);
        Assert.Equal("Caf\u00e9", Assert.Single(schema.Objects).Name);
    }

    // ---------------------------------------------------------------- batches

    [Fact]
    public void Multiple_batches_with_go_and_go_n_are_all_processed()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.A (Id int);
            GO
            CREATE TABLE dbo.B (Id int);
            GO 3
            CREATE TABLE dbo.C (Id int);
            """);

        Assert.Equal(["A", "B", "C"], schema.Objects.Select(o => o.Name).ToArray());
        Assert.Empty(schema.Warnings);
    }

    [Fact]
    public void Go_inside_comments_and_strings_does_not_break_a_procedure()
    {
        var schema = Fixtures.FromSql("""
            /*
            GO
            */
            CREATE PROCEDURE dbo.usp_Strings
            AS
            BEGIN
                -- GO
                SELECT 'GO
            GO
            ' AS Literal;
            END;
            """);

        var proc = schema.Obj("procedure", "usp_Strings");
        Assert.Contains("SELECT 'GO", proc.Definition);
        Assert.Empty(schema.Warnings);
    }

    [Fact]
    public void Statements_in_one_batch_are_all_applied()
    {
        var schema = Fixtures.FromSql("CREATE TABLE dbo.A (Id int); CREATE TABLE dbo.B (Id int);");
        Assert.Equal(2, schema.Objects.Count);
    }

    // ---------------------------------------------------------------- parse errors

    [Fact]
    public void Syntax_error_reports_file_and_absolute_line()
    {
        var sql = "CREATE TABLE dbo.Good (Id int);\nGO\n\nCREATE TABLE dbo.Bad (Id int,, );\nGO\nCREATE TABLE dbo.AlsoGood (Id int);";

        var schema = Fixtures.FromSql(sql, "broken.sql");

        Assert.Equal(["Good", "AlsoGood"], schema.Objects.Select(o => o.Name).ToArray());
        var warning = Assert.Single(schema.Warnings, w => w.Code == WarningCodes.ParseError);
        Assert.Equal("broken.sql", warning.File);
        Assert.Equal(4, warning.Line);
        Assert.Contains("line 4", warning.Message);
    }

    [Fact]
    public void Error_on_a_later_line_of_a_batch_is_offset_correctly()
    {
        var sql = "-- one\n-- two\nGO\n-- three\nCREATE TABLE dbo.T (\n  Id int,\n  Name nvarchar(10) NOT NULL,,\n);";
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromSql(sql, "x.sql"));

        Assert.Equal(ErrorCodes.ParseError, ex.Code);
        Assert.Contains("x.sql", ex.Message);
        Assert.Contains("line 7", ex.Message);
    }

    [Fact]
    public void Script_where_nothing_parses_fails_permanently()
    {
        var ex = Assert.Throws<ImportException>(() => Fixtures.FromSql("this is not sql at all;;; ((("));
        Assert.Equal(ErrorCodes.ParseError, ex.Code);
        Assert.False(ex.IsTransient);
    }

    // ---------------------------------------------------------------- tables, columns, constraints

    [Fact]
    public void Column_type_details_are_extracted()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.Types (
                A nvarchar(max) NOT NULL,
                B nvarchar(50) NULL,
                C decimal(18,2) NOT NULL,
                D varchar(10),
                E int IDENTITY(1,1) NOT NULL,
                F datetime2(3) NULL,
                G varbinary(max),
                H float,
                I char,
                J uniqueidentifier NOT NULL DEFAULT (NEWID()),
                K AS (C * 2) PERSISTED
            );
            """);
        var cols = schema.Obj("table", "Types").Columns.ToDictionary(c => c.Name);

        Assert.Equal(("nvarchar", -1, (int?)null, (int?)null), (cols["A"].DataType, cols["A"].MaxLength, cols["A"].NumericPrecision, cols["A"].NumericScale));
        Assert.Equal(50, cols["B"].MaxLength);
        Assert.Equal(true, cols["B"].IsNullable);
        Assert.Equal((18, 2, (int?)null), (cols["C"].NumericPrecision, cols["C"].NumericScale, cols["C"].MaxLength));
        Assert.Null(cols["D"].IsNullable);
        Assert.True(cols["E"].IsIdentity);
        Assert.False(cols["E"].IsNullable);
        Assert.Equal(3, cols["F"].NumericScale);
        Assert.Equal(-1, cols["G"].MaxLength);
        Assert.Equal(53, cols["H"].NumericPrecision);
        Assert.Equal(1, cols["I"].MaxLength);
        Assert.Equal("(NEWID())", cols["J"].DefaultValue);
        Assert.True(cols["K"].IsComputed);
        Assert.Equal("(C * 2)", cols["K"].ComputedExpression);
        Assert.Equal(Enumerable.Range(1, 11), schema.Obj("table", "Types").Columns.Select(c => c.Ordinal));
    }

    [Fact]
    public void Inline_and_table_level_constraints_are_structured()
    {
        var schema = Fixtures.FromSql(Fixtures.HospitalSql);
        var patients = schema.Obj("table", "Patients");

        Assert.True(patients.Columns.Single(c => c.Name == "PatientId").IsPrimaryKey);
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "primary_key" && c.Name == "PK_Patients" && c.Columns.SequenceEqual(["PatientId"]));
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "unique" && c.Name == "UQ_Patients_Email");
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "check" && c.Expression == "Age >= 0" && c.Columns.SequenceEqual(["Age"]));
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "default" && c.Expression == "(0)" && c.Columns.SequenceEqual(["Balance"]));
        Assert.Equal("(0)", patients.Columns.Single(c => c.Name == "Balance").DefaultValue);

        var pkIndex = patients.Indexes.Single(i => i.IsPrimaryKey);
        Assert.Equal("CLUSTERED", pkIndex.IndexType);
        Assert.Equal("PK_Patients", pkIndex.Name);
        var uq = patients.Indexes.Single(i => i.IsUniqueConstraint);
        Assert.Equal("NONCLUSTERED", uq.IndexType);
        Assert.True(uq.IsUnique);

        var visits = schema.Obj("table", "Visits", "clinic");
        Assert.Equal("CLUSTERED", visits.Indexes.Single(i => i.IsPrimaryKey).IndexType);
    }

    [Fact]
    public void Indexes_capture_keys_includes_filter_and_type()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.T (Id int NOT NULL, A int, B int, C int);
            GO
            CREATE UNIQUE CLUSTERED INDEX IX_T_A ON dbo.T (A ASC, B DESC);
            CREATE NONCLUSTERED INDEX IX_T_C ON dbo.T (C) INCLUDE (A, B) WHERE C IS NOT NULL;
            CREATE NONCLUSTERED COLUMNSTORE INDEX CS_T ON dbo.T (A, B);
            """);
        var t = schema.Obj("table", "T");

        var a = t.Indexes.Single(i => i.Name == "IX_T_A");
        Assert.True(a.IsUnique);
        Assert.Equal("CLUSTERED", a.IndexType);
        Assert.Equal(["A", "B"], a.KeyColumns.Select(k => k.Name).ToArray());
        Assert.Null(a.KeyColumns[0].Descending);
        Assert.True(a.KeyColumns[1].Descending);

        var c = t.Indexes.Single(i => i.Name == "IX_T_C");
        Assert.Equal(["A", "B"], c.IncludedColumns);
        Assert.Equal("C IS NOT NULL", c.FilterDefinition);

        Assert.Equal("NONCLUSTERED COLUMNSTORE", t.Indexes.Single(i => i.Name == "CS_T").IndexType);
    }

    [Fact]
    public void Alter_table_statements_are_applied_in_order_and_create_text_is_kept()
    {
        var create = "CREATE TABLE dbo.Orders (OrderId int NOT NULL, CustomerId int NULL, Note varchar(20) NULL, Legacy int)";
        var schema = Fixtures.FromSql($"""
            {create};
            GO
            ALTER TABLE dbo.Orders ADD CONSTRAINT PK_Orders PRIMARY KEY CLUSTERED (OrderId);
            ALTER TABLE dbo.Orders ADD CONSTRAINT UQ_Orders_Note UNIQUE (Note);
            ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders CHECK (OrderId > 0);
            ALTER TABLE dbo.Orders ADD CONSTRAINT DF_Orders_Note DEFAULT ('n/a') FOR Note;
            ALTER TABLE dbo.Orders ADD CONSTRAINT FK_Orders_Cust FOREIGN KEY (CustomerId) REFERENCES dbo.Customers (CustomerId) ON UPDATE SET NULL;
            ALTER TABLE dbo.Orders ADD Created datetime2 NOT NULL;
            ALTER TABLE dbo.Orders ALTER COLUMN Note varchar(200) NOT NULL;
            ALTER TABLE dbo.Orders DROP COLUMN Legacy;
            GO
            CREATE TABLE dbo.Customers (CustomerId int NOT NULL PRIMARY KEY);
            """);
        var orders = schema.Obj("table", "Orders");

        Assert.Equal(create + ";", orders.Definition);
        Assert.Equal(["OrderId", "CustomerId", "Note", "Created"], orders.Columns.Select(c => c.Name).ToArray());
        Assert.Equal([1, 2, 3, 4], orders.Columns.Select(c => c.Ordinal).ToArray());
        Assert.True(orders.Columns[0].IsPrimaryKey);
        Assert.Equal(200, orders.Columns[2].MaxLength);
        Assert.False(orders.Columns[2].IsNullable);
        Assert.Equal("('n/a')", orders.Columns[2].DefaultValue);
        Assert.Contains(orders.Constraints, c => c.Name == "CK_Orders");

        var fk = Assert.Single(schema.Relationships, r => r.Kind == "declared");
        Assert.Equal("FK_Orders_Cust", fk.Name);
        Assert.Equal("SET NULL", fk.OnUpdate);
        Assert.Equal("NO ACTION", fk.OnDelete);
        Assert.Equal(schema.Obj("table", "Customers").Id, fk.TargetObjectId);
        Assert.Equal(["CustomerId"], fk.TargetColumns);
    }

    [Fact]
    public void Drop_constraint_removes_structured_rows()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.T (Id int NOT NULL CONSTRAINT PK_T PRIMARY KEY, V int CONSTRAINT DF_T DEFAULT 1);
            GO
            ALTER TABLE dbo.T DROP CONSTRAINT PK_T;
            ALTER TABLE dbo.T DROP CONSTRAINT DF_T;
            """);
        var t = schema.Obj("table", "T");

        Assert.Empty(t.Constraints);
        Assert.Empty(t.Indexes);
        Assert.False(t.Columns[0].IsPrimaryKey);
        Assert.Null(t.Columns[1].DefaultValue);
    }

    [Fact]
    public void Alter_of_unknown_table_warns_instead_of_failing()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.Known (Id int);
            GO
            ALTER TABLE dbo.Missing ADD CONSTRAINT PK_M PRIMARY KEY (Id);
            """);

        var w = Assert.Single(schema.Warnings, x => x.Code == WarningCodes.UnresolvedTarget);
        Assert.Equal(3, w.Line);
    }

    // ---------------------------------------------------------------- programmable objects

    [Fact]
    public void Procedure_definition_is_preserved_byte_for_byte()
    {
        const string proc = "CREATE   PROCEDURE  dbo.usp_Odd   @A int /* inline */ ,\n\t@B varchar(10) = 'x'\nAS\n-- a comment\nBEGIN\n    SET NOCOUNT ON;   \n    SELECT @A,   @B;\nEND";
        var schema = Fixtures.FromSql($"/* leading */\r\n{proc}\r\nGO\r\n");

        var p = schema.Obj("procedure", "usp_Odd");
        Assert.Equal(proc, p.Definition);
        Assert.Equal(2, p.SourceLine);
        Assert.Equal("script.sql", p.SourceFile);
    }

    [Fact]
    public void Definitions_keep_exact_text_including_comments_for_all_object_kinds()
    {
        var sql = Fixtures.HospitalSql;
        var schema = Fixtures.FromSql(sql);
        foreach (var o in schema.Objects.Where(o => o.ObjectType is "table" or "view" or "procedure" or "function" or "trigger"))
        {
            Assert.Contains(o.Definition!, sql);
            Assert.StartsWith("CREATE", o.Definition);
        }
    }

    [Fact]
    public void Procedure_parameters_and_function_metadata_are_extracted()
    {
        var schema = Fixtures.FromSql(Fixtures.HospitalSql);

        var p = schema.Obj("procedure", "usp_AdmitPatient").Metadata;
        Assert.Collection(p.Parameters!,
            a => Assert.Equal(("@PatientId", "int", "in", false), (a.Name, a.DataType, a.Direction, a.HasDefault)),
            b => Assert.Equal(("@Note", "nvarchar(50)", "in", true, "N'none'"), (b.Name, b.DataType, b.Direction, b.HasDefault, b.DefaultValue)),
            c => Assert.Equal(("@Out", "int", "out"), (c.Name, c.DataType, c.Direction)));
        Assert.True(p.HasTransaction);

        var f = schema.Obj("function", "fn_Total", "billing").Metadata;
        Assert.Equal("scalar", f.FunctionType);
        Assert.Equal("decimal(18, 2)", f.ReturnType);
    }

    [Fact]
    public void Table_valued_function_kinds_are_distinguished()
    {
        var schema = Fixtures.FromSql("""
            CREATE FUNCTION dbo.fn_Inline(@Id int) RETURNS TABLE AS RETURN (SELECT @Id AS Id);
            GO
            CREATE FUNCTION dbo.fn_Multi(@Id int) RETURNS @r TABLE (Id int) AS BEGIN INSERT @r VALUES (@Id); RETURN; END;
            GO
            CREATE VIEW dbo.vBound WITH SCHEMABINDING AS SELECT 1 AS One;
            """);

        Assert.Equal("inline_table_valued", schema.Obj("function", "fn_Inline").Metadata.FunctionType);
        var multi = schema.Obj("function", "fn_Multi").Metadata;
        Assert.Equal("multi_statement_table_valued", multi.FunctionType);
        Assert.Equal(["@r"], multi.TableVariables);
        Assert.True(schema.Obj("view", "vBound").Metadata.IsSchemaBound);
    }

    [Fact]
    public void Create_or_alter_and_alter_replace_definitions()
    {
        var schema = Fixtures.FromSql("""
            CREATE PROCEDURE dbo.p1 AS SELECT 1;
            GO
            ALTER PROCEDURE dbo.p1 AS SELECT 2;
            GO
            CREATE OR ALTER PROCEDURE dbo.p1 AS SELECT 3;
            GO
            CREATE OR ALTER VIEW dbo.v1 AS SELECT 1 AS A;
            """);

        Assert.Equal("CREATE OR ALTER PROCEDURE dbo.p1 AS SELECT 3;", schema.Obj("procedure", "p1").Definition);
        Assert.Equal(2, schema.Objects.Count);
        Assert.Empty(schema.Warnings);
    }

    [Fact]
    public void Alter_without_create_imports_with_a_warning()
    {
        var schema = Fixtures.FromSql("ALTER VIEW dbo.vOnly AS SELECT 1 AS A;");

        Assert.Equal("ALTER VIEW dbo.vOnly AS SELECT 1 AS A;", schema.Obj("view", "vOnly").Definition);
        Assert.Contains(schema.Warnings, w => w.Code == WarningCodes.AlterWithoutCreate && w.Line == 1);
    }

    [Fact]
    public void Duplicate_create_keeps_the_last_definition_and_warns()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.Dup (A int);
            GO
            CREATE TABLE dbo.Dup (B varchar(5), C int);
            GO
            """);

        var dup = schema.Obj("table", "Dup");
        Assert.Equal(["B", "C"], dup.Columns.Select(c => c.Name).ToArray());
        var w = Assert.Single(schema.Warnings);
        Assert.Equal(WarningCodes.DuplicateDefinition, w.Code);
        Assert.Equal(3, w.Line);
        Assert.Single(schema.Objects);
    }

    [Fact]
    public void Trigger_metadata_and_parent_link_are_set()
    {
        var schema = Fixtures.FromSql(Fixtures.HospitalSql);
        var trigger = schema.Obj("trigger", "trg_Visits_Insert", "clinic");

        Assert.Equal(["INSERT", "UPDATE"], trigger.Metadata.TriggerEvents);
        Assert.Equal("AFTER", trigger.Metadata.TriggerTiming);
        Assert.Equal("Visits", trigger.Metadata.TriggerParent!.Name);
        Assert.Equal(schema.Obj("table", "Visits", "clinic").Id, trigger.ParentObjectId);

        var dep = schema.DepsFrom("trigger", "trg_Visits_Insert").Single(d => d.Kind == "trigger_on");
        Assert.Equal(DependencyConfidences.ConfirmedStatic, dep.Confidence);
        Assert.Equal(trigger.ParentObjectId, dep.TargetObjectId);
    }

    [Fact]
    public void Instead_of_trigger_timing_is_reported()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.T (Id int);
            GO
            CREATE VIEW dbo.V AS SELECT Id FROM dbo.T;
            GO
            CREATE TRIGGER dbo.trg_V ON dbo.V INSTEAD OF INSERT AS BEGIN SET NOCOUNT ON; END;
            """);
        Assert.Equal("INSTEAD OF", schema.Obj("trigger", "trg_V").Metadata.TriggerTiming);
    }

    [Fact]
    public void Sequences_types_and_synonyms_are_imported_as_objects()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.T (Id int);
            GO
            CREATE SEQUENCE dbo.Seq1 START WITH 1;
            GO
            CREATE TYPE dbo.Phone FROM varchar(20) NOT NULL;
            GO
            CREATE TYPE dbo.IdList AS TABLE (Id int);
            GO
            CREATE SYNONYM dbo.SynT FOR dbo.T;
            """);

        Assert.Equal("sequence", schema.Obj("sequence", "Seq1").ObjectType);
        Assert.Equal(2, schema.Objects.Count(o => o.ObjectType == "type"));
        var dep = Assert.Single(schema.DepsFrom("synonym", "SynT"));
        Assert.Equal("references", dep.Kind);
        Assert.Equal(schema.Obj("table", "T").Id, dep.TargetObjectId);
    }

    [Fact]
    public void Schema_objects_use_name_with_empty_schema_name()
    {
        var schema = Fixtures.FromSql("CREATE SCHEMA clinic AUTHORIZATION dbo;");
        var s = Assert.Single(schema.Objects);
        Assert.Equal(("schema", "", "clinic"), (s.ObjectType, s.SchemaName, s.Name));
    }

    // ---------------------------------------------------------------- unsupported statements

    [Fact]
    public void Unsupported_and_data_statements_are_warned_not_dropped_silently()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.T (Id int);
            GO
            INSERT INTO dbo.T VALUES (1);
            GO
            CREATE LOGIN app WITH PASSWORD = 'x';
            GO
            GRANT SELECT ON dbo.T TO public;
            """);

        Assert.Equal(3, schema.Warnings.Count(w => w.Code == WarningCodes.UnsupportedStatement && w.Line is 3 or 5 or 7));
        Assert.Contains(schema.Warnings, w => w.Code == WarningCodes.UnsupportedStatement && w.Line == 3 && w.Message.Contains("not schema"));
        Assert.Contains(schema.Warnings, w => w.Line == 5 && w.Message.Contains("CREATE LOGIN"));
        Assert.Contains(schema.Warnings, w => w.Line == 7);
        Assert.Single(schema.Objects);
    }

    [Fact]
    public void Common_session_statements_do_not_warn()
    {
        var schema = Fixtures.FromSql("""
            USE [HospitalDb];
            GO
            SET ANSI_NULLS ON;
            SET QUOTED_IDENTIFIER ON;
            GO
            CREATE TABLE dbo.T (Id int);
            """);

        Assert.Empty(schema.Warnings);
        Assert.Equal("HospitalDb", schema.DatabaseName);
    }

    [Fact]
    public void Script_without_schema_objects_succeeds_with_a_warning()
    {
        var schema = Fixtures.FromSql("-- only a comment\n");
        Assert.Contains(schema.Warnings, w => w.Code == WarningCodes.NoSchemaObjects);
    }

    // ---------------------------------------------------------------- relationships

    [Fact]
    public void Missing_foreign_keys_stay_missing_unless_the_strict_inference_rule_applies()
    {
        var schema = Fixtures.FromSql("""
            CREATE TABLE dbo.Country (CountryId int NOT NULL PRIMARY KEY, Name varchar(50));
            CREATE TABLE dbo.City    (CityId int NOT NULL PRIMARY KEY, CountryId int NOT NULL, Name varchar(50));
            CREATE TABLE dbo.Region  (RegionId int NOT NULL PRIMARY KEY, CountryId bigint NULL);        -- type mismatch
            CREATE TABLE dbo.Declared(DeclaredId int NOT NULL PRIMARY KEY, CountryId int NOT NULL,
                CONSTRAINT FK_D FOREIGN KEY (CountryId) REFERENCES dbo.Country (CountryId));          -- declared wins
            CREATE TABLE dbo.Linker  (CountryId int NOT NULL, CityId int NOT NULL, PRIMARY KEY (CountryId, CityId)); -- part of PK
            CREATE TABLE dbo.Alpha   (Id int NOT NULL PRIMARY KEY);
            CREATE TABLE dbo.Beta    (Id int NOT NULL PRIMARY KEY);
            CREATE TABLE dbo.Gamma   (GammaId int PRIMARY KEY, Id int NOT NULL);                       -- ambiguous target
            """);

        var inferred = schema.Relationships.Where(r => r.Kind == "inferred").ToList();
        var single = Assert.Single(inferred, r => schema.NameOf(r.SourceObjectId) == "dbo.City");
        Assert.Equal("dbo.Country", schema.NameOf(single.TargetObjectId));
        Assert.Equal("name-based inference", single.Origin);
        Assert.Equal(["CountryId"], single.SourceColumns);

        Assert.DoesNotContain(inferred, r => schema.NameOf(r.SourceObjectId) is "dbo.Region" or "dbo.Declared" or "dbo.Gamma");
        Assert.DoesNotContain(inferred, r => schema.NameOf(r.SourceObjectId) == "dbo.Linker");
        Assert.Single(schema.Relationships, r => r.Kind == "declared");
        Assert.All(schema.Relationships.Where(r => r.Kind == "declared"), r => Assert.NotEqual("name-based inference", r.Origin));
    }

    [Fact]
    public void Declared_fk_to_missing_table_keeps_target_names_unresolved()
    {
        var schema = Fixtures.FromSql("CREATE TABLE dbo.T (Id int, X int, CONSTRAINT FK_X FOREIGN KEY (X) REFERENCES ext.Other (OtherId) ON DELETE CASCADE);");

        var r = Assert.Single(schema.Relationships);
        Assert.Null(r.TargetObjectId);
        Assert.Equal(("ext", "Other"), (r.TargetSchema, r.TargetName));
        Assert.Equal("CASCADE", r.OnDelete);
        var dep = Assert.Single(schema.Dependencies);
        Assert.Equal(DependencyConfidences.ParsedReference, dep.Confidence);
        Assert.Equal("not found in imported schema", dep.Note);
    }

    // ---------------------------------------------------------------- summary

    [Fact]
    public void Summary_counts_match_the_extracted_model()
    {
        var schema = Fixtures.FromSql(Fixtures.HospitalSql);
        var s = schema.BuildSummary();

        Assert.Equal("sql", s.SourceType);
        Assert.Equal(2, s.Counts.Schemas);
        Assert.Equal(4, s.Counts.Tables);
        Assert.Equal(1, s.Counts.Views);
        Assert.Equal(2, s.Counts.Procedures);
        Assert.Equal(1, s.Counts.Functions);
        Assert.Equal(1, s.Counts.Triggers);
        Assert.Equal(schema.Objects.Sum(o => o.Columns.Count), s.Counts.Columns);
        Assert.Equal(1, s.Counts.ForeignKeys);
        Assert.Equal(schema.Dependencies.Count, s.Counts.Dependencies);
        Assert.Contains("Dynamic SQL references are not resolved.", s.Limitations);
    }

    [Fact]
    public void Summary_json_uses_camel_case_keys_matching_shared_types()
    {
        var json = JsonDefaults.Serialize(Fixtures.FromSql(Fixtures.HospitalSql).BuildSummary());

        Assert.Contains("\"sourceType\":\"sql\"", json);
        Assert.Contains("\"foreignKeys\":1", json);
        Assert.Contains("\"unsupported\":[]", json);
        Assert.Contains("\"limitations\":[", json);
        Assert.DoesNotContain("SourceType", json);
    }

    [Fact]
    public void Object_metadata_json_matches_shared_types_shape()
    {
        var proc = Fixtures.FromSql(Fixtures.HospitalSql).Obj("procedure", "usp_Audit");
        var json = JsonDefaults.Serialize(proc.Metadata);

        Assert.Contains("\"temporaryTables\":[\"#scratch\"]", json);
        Assert.Contains("\"tableVariables\":[\"@t\"]", json);
        Assert.Contains("\"operations\":{\"select\":2,\"insert\":0,\"update\":0,\"delete\":0,\"merge\":0}", json);
        Assert.Contains("\"hasDynamicSql\":false", json);
        Assert.DoesNotContain("triggerParent", json);
    }
}
