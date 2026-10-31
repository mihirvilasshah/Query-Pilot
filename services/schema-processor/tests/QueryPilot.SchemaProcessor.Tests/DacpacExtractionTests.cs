using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Tests;

public class DacpacExtractionTests
{
    private static readonly Lazy<ExtractedSchema> Hospital = new(() =>
        Fixtures.FromDacpac(Fixtures.BuildDacpac(Fixtures.HospitalSqlForDacpac)));

    [Fact]
    public void Database_name_comes_from_package_metadata()
    {
        Assert.Equal("HospitalDb", Hospital.Value.DatabaseName);
        Assert.Equal("dacpac", Hospital.Value.SourceType);
    }

    [Fact]
    public void Objects_of_every_supported_kind_are_extracted()
    {
        var s = Hospital.Value.BuildSummary();

        Assert.Equal(2, s.Counts.Schemas);
        Assert.Equal(4, s.Counts.Tables);
        Assert.Equal(1, s.Counts.Views);
        Assert.Equal(3, s.Counts.Procedures);
        Assert.Equal(1, s.Counts.Functions);
        Assert.Equal(1, s.Counts.Triggers);
        Assert.Equal(1, s.Counts.ForeignKeys);
        Assert.True(s.Counts.Indexes >= 5);   // 4 PK/unique-constraint backing indexes + IX_Visits_Patient
        Assert.Empty(s.Unsupported);

        var schema = Hospital.Value.Obj("schema", "clinic");
        Assert.Equal("", schema.SchemaName);
    }

    [Fact]
    public void Table_structure_is_extracted_from_the_model()
    {
        var patients = Hospital.Value.Obj("table", "Patients", "dbo");
        var cols = patients.Columns.ToDictionary(c => c.Name);

        Assert.Equal(-1, cols["FullName"].MaxLength);
        Assert.Equal((18, 2), (cols["Balance"].NumericPrecision, cols["Balance"].NumericScale));
        Assert.True(cols["PatientId"].IsIdentity);
        Assert.True(cols["PatientId"].IsPrimaryKey);
        Assert.True(cols["DoubleBal"].IsComputed);
        Assert.Equal("0", cols["Balance"].DefaultValue?.Trim('(', ')'));
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "unique" && c.Name == "UQ_Patients_Email");
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "check" && c.Name == "CK_Patients_Age");
        Assert.Contains(patients.Constraints, c => c.ConstraintType == "default" && c.Columns.SequenceEqual(["Balance"]));
        Assert.Contains(patients.Indexes, i => i.IsPrimaryKey && i.IndexType == "CLUSTERED");
        Assert.Contains(patients.Indexes, i => i.IsUniqueConstraint && i.IndexType == "NONCLUSTERED");
    }

    [Fact]
    public void Standalone_index_is_attached_to_its_table_with_details()
    {
        var visits = Hospital.Value.Obj("table", "Visits", "clinic");
        var ix = visits.Indexes.Single(i => i.Name == "IX_Visits_Patient");

        Assert.Equal("NONCLUSTERED", ix.IndexType);
        Assert.True(ix.KeyColumns.Single().Descending);
        Assert.Equal(["VisitId"], ix.IncludedColumns);
        Assert.Contains("PatientId", ix.FilterDefinition);
    }

    [Fact]
    public void Declared_foreign_key_is_resolved()
    {
        var fk = Assert.Single(Hospital.Value.Relationships, r => r.Kind == "declared");

        Assert.Equal("FK_Visits_Patients", fk.Name);
        Assert.Equal("clinic.Visits", Hospital.Value.NameOf(fk.SourceObjectId));
        Assert.Equal("dbo.Patients", Hospital.Value.NameOf(fk.TargetObjectId));
        Assert.Equal("CASCADE", fk.OnDelete);
        Assert.Equal(["PatientId"], fk.TargetColumns);
    }

    [Fact]
    public void Cross_schema_dependencies_are_confirmed_by_dacfx_and_keep_script_operations()
    {
        var s = Hospital.Value;
        var admit = s.DepsFrom("procedure", "usp_AdmitPatient").ToList();

        var insert = admit.Single(d => d.TargetName == "Visits");
        Assert.Equal("clinic", insert.TargetSchema);
        Assert.Equal(("writes", DependencyConfidences.ConfirmedStatic, "dacfx"), (insert.Kind, insert.Confidence, insert.Origin));
        Assert.Contains("insert", insert.Operations);

        var update = admit.Single(d => d.TargetName == "Patients");
        Assert.Equal(("writes", DependencyConfidences.ConfirmedStatic), (update.Kind, update.Confidence));
        Assert.Contains("update", update.Operations);
        Assert.Single(admit, d => d.TargetName == "Patients");   // merged into one row, not two

        var audit = Assert.Single(admit, d => d.Kind == "executes");
        Assert.Equal("usp_Audit", audit.TargetName);
        Assert.Equal(DependencyConfidences.ConfirmedStatic, audit.Confidence);
    }

    [Fact]
    public void Nested_procedure_function_and_view_references_are_found()
    {
        var s = Hospital.Value;
        var audit = s.DepsFrom("procedure", "usp_Audit").ToList();

        var fn = Assert.Single(audit, d => d.Kind == "calls_function");
        Assert.Equal("billing.fn_Total", s.NameOf(fn.TargetObjectId));
        Assert.Equal(DependencyConfidences.ConfirmedStatic, fn.Confidence);

        var view = Assert.Single(audit, d => d.Kind == "reads");
        Assert.Equal("dbo.vPatientVisits", s.NameOf(view.TargetObjectId));

        var viewDeps = s.DepsFrom("view", "vPatientVisits").Select(d => s.NameOf(d.TargetObjectId)).ToList();
        Assert.Contains("dbo.Patients", viewDeps);
        Assert.Contains("clinic.Visits", viewDeps);
    }

    [Fact]
    public void Triggers_link_to_their_table()
    {
        var s = Hospital.Value;
        var trigger = s.Obj("trigger", "trg_Visits_Insert", "clinic");

        Assert.Equal(["INSERT", "UPDATE"], trigger.Metadata.TriggerEvents);
        Assert.Equal("AFTER", trigger.Metadata.TriggerTiming);
        Assert.Equal(s.Obj("table", "Visits", "clinic").Id, trigger.ParentObjectId);
        var on = s.DepsFrom("trigger", "trg_Visits_Insert").Single(d => d.Kind == "trigger_on");
        Assert.Equal(DependencyConfidences.ConfirmedStatic, on.Confidence);
        Assert.Equal("dacfx", on.Origin);
    }

    [Fact]
    public void Dynamic_sql_is_flagged_not_resolved()
    {
        var s = Hospital.Value;
        var proc = s.Obj("procedure", "usp_Dynamic");

        Assert.True(proc.Metadata.HasDynamicSql);
        Assert.Equal(2, proc.Metadata.DynamicSqlCount);
        var dynamic = s.DepsFrom("procedure", "usp_Dynamic").Where(d => d.Confidence == DependencyConfidences.UnresolvedDynamic).ToList();
        Assert.Equal(2, dynamic.Count);
        Assert.All(dynamic, d => Assert.Null(d.TargetObjectId));
    }

    [Fact]
    public void Procedure_metadata_includes_parameters_and_operation_counts()
    {
        var meta = Hospital.Value.Obj("procedure", "usp_AdmitPatient").Metadata;

        Assert.Equal(["@PatientId", "@Note", "@Out"], meta.Parameters!.Select(p => p.Name).ToArray());
        Assert.Equal("out", meta.Parameters![2].Direction);
        Assert.True(meta.Parameters[1].HasDefault);
        Assert.True(meta.HasTransaction);
        Assert.Equal(1, meta.Operations!.Insert);
        Assert.Equal(1, meta.Operations.Update);
    }

    [Fact]
    public void Definitions_are_the_model_scripts()
    {
        var s = Hospital.Value;
        Assert.StartsWith("CREATE TABLE", s.Obj("table", "Patients").Definition);
        Assert.Contains("usp_Audit", s.Obj("procedure", "usp_AdmitPatient").Definition);
        Assert.All(s.Objects, o => Assert.False(string.IsNullOrWhiteSpace(o.Definition)));
    }

    [Fact]
    public void Unsupported_element_types_are_reported_in_summary_and_warnings()
    {
        var dacpac = Fixtures.BuildDacpac("""
            CREATE TABLE dbo.T (Id int NOT NULL);
            GO
            CREATE ROLE reporting;
            GO
            CREATE USER app WITHOUT LOGIN;
            GO
            """);

        var s = Fixtures.FromDacpac(dacpac);
        var summary = s.BuildSummary();

        Assert.Contains(summary.Unsupported, u => u.ObjectType == "Role" && u.Count >= 1);
        Assert.Contains(s.Warnings, w => w.Code == WarningCodes.UnsupportedObject && w.Message.Contains("Role"));
        Assert.Equal(1, summary.Counts.Tables);
    }

    [Fact]
    public void Extraction_is_deterministic()
    {
        var bytes = Fixtures.BuildDacpac(Fixtures.HospitalSqlForDacpac);
        var a = Fixtures.FromDacpac(bytes);
        var b = Fixtures.FromDacpac(bytes);

        Assert.Equal(a.Objects.Select(o => o.DisplayName), b.Objects.Select(o => o.DisplayName));
        Assert.Equal(a.Dependencies.Count, b.Dependencies.Count);
    }
}
