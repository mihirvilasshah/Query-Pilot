using System.Text.RegularExpressions;
using Microsoft.SqlServer.TransactSql.ScriptDom;
using QueryPilot.SchemaProcessor.DependencyAnalysis;
using QueryPilot.SchemaProcessor.Extraction;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.SqlParser;

/// <summary>Where a parsed statement came from, so offsets can be turned back into original text and file lines.</summary>
/// <param name="Text">The exact text that was handed to the parser (statement offsets are relative to it).</param>
/// <param name="File">Source file name, or null when the text was regenerated (DACPAC).</param>
/// <param name="LineBase">Line of <paramref name="Text"/>'s first line minus one; null when lines are not meaningful.</param>
public sealed record StatementContext(string Text, string? File, int? LineBase)
{
    public int? Line(TSqlFragment f) => LineBase is null ? null : LineBase + f.StartLine;

    public string TextOf(TSqlFragment f) => Text.Substring(f.StartOffset, f.FragmentLength);
}

/// <summary>
/// Applies parsed DDL statements, in order, to an in-memory <see cref="ExtractedSchema"/>.
/// Nothing here executes SQL; statements are only read.
/// </summary>
public sealed partial class SchemaBuilder(ExtractedSchema schema, WarningCollector warnings)
{
    private enum Mode { Create, Alter, CreateOrAlter }

    private readonly Dictionary<string, SchemaObject> _byKey = new(StringComparer.OrdinalIgnoreCase);

    public int SchemaStatements { get; private set; }

    public int IgnoredStatements { get; private set; }

    private static string Key(string type, string schemaName, string name) => $"{type}|{schemaName}|{name}";

    public SchemaObject? Find(string type, string schemaName, string name) =>
        _byKey.GetValueOrDefault(Key(type, schemaName, name));

    private SchemaObject? FindRelation(string schemaName, string name) =>
        Find(ObjectTypes.Table, schemaName, name) ?? Find(ObjectTypes.View, schemaName, name);

    private static (string Schema, string Name) Split(SchemaObjectName n) =>
        (n.SchemaIdentifier?.Value ?? "dbo", n.BaseIdentifier.Value);

    public void Apply(TSqlStatement statement, StatementContext ctx)
    {
        switch (statement)
        {
            case CreateSchemaStatement s:
                Define(ObjectTypes.Schema, "", s.Name.Value, s, ctx, Mode.Create);
                SchemaStatements++;
                break;

            case CreateTableStatement s:
                CreateTable(s, ctx);
                break;

            case AlterTableAddTableElementStatement s:
                AlterTableAdd(s, ctx);
                break;

            case AlterTableAlterColumnStatement s:
                AlterColumn(s, ctx);
                break;

            case AlterTableDropTableElementStatement s:
                AlterTableDrop(s, ctx);
                break;

            case CreateIndexStatement s:
                CreateIndex(s, ctx);
                break;

            case CreateColumnStoreIndexStatement s:
                CreateColumnStoreIndex(s, ctx);
                break;

            case ViewStatementBody s:
                CreateView(s, ctx);
                break;

            case ProcedureStatementBody s:
                CreateProcedure(s, ctx);
                break;

            case FunctionStatementBody s:
                CreateFunction(s, ctx);
                break;

            case TriggerStatementBody s:
                CreateTrigger(s, ctx);
                break;

            case CreateSequenceStatement s:
            {
                var (sch, name) = Split(s.Name);
                Define(ObjectTypes.Sequence, sch, name, s, ctx, Mode.Create);
                SchemaStatements++;
                break;
            }

            case CreateTypeStatement s:
            {
                var (sch, name) = Split(s.Name);
                Define(ObjectTypes.Type, sch, name, s, ctx, Mode.Create);
                SchemaStatements++;
                break;
            }

            case CreateSynonymStatement s:
                CreateSynonym(s, ctx);
                break;

            case CreateDatabaseStatement s:
                schema.DatabaseName ??= s.DatabaseName.Value;
                IgnoredStatements++;
                break;

            case UseStatement s:
                if (schema.DatabaseName is null &&
                    !s.DatabaseName.Value.Equals("master", StringComparison.OrdinalIgnoreCase) &&
                    !s.DatabaseName.Value.Equals("tempdb", StringComparison.OrdinalIgnoreCase))
                {
                    schema.DatabaseName = s.DatabaseName.Value;
                }

                IgnoredStatements++;
                break;

            case IfStatement s:
                Apply(s.ThenStatement, ctx);
                if (s.ElseStatement is not null)
                {
                    Apply(s.ElseStatement, ctx);
                }

                break;

            case BeginEndBlockStatement s:
                foreach (var inner in s.StatementList.Statements)
                {
                    Apply(inner, ctx);
                }

                break;

            case DropTableStatement s:
                DropAll(ObjectTypes.Table, s.Objects);
                break;

            case DropViewStatement s:
                DropAll(ObjectTypes.View, s.Objects);
                break;

            case DropProcedureStatement s:
                DropAll(ObjectTypes.Procedure, s.Objects);
                break;

            case DropFunctionStatement s:
                DropAll(ObjectTypes.Function, s.Objects);
                break;

            case DropTriggerStatement s:
                DropAll(ObjectTypes.Trigger, s.Objects);
                break;

            case DropSequenceStatement s:
                DropAll(ObjectTypes.Sequence, s.Objects);
                break;

            case DropSynonymStatement s:
                DropAll(ObjectTypes.Synonym, s.Objects);
                break;

            case DropTypeStatement s:
                DropAll(ObjectTypes.Type, [s.Name]);
                break;

            case DropSchemaStatement s:
                Remove(Find(ObjectTypes.Schema, "", s.Schema.BaseIdentifier.Value));
                IgnoredStatements++;
                break;

            case DropIndexStatement s:
                DropIndexes(s);
                break;

            case PredicateSetStatement or SetCommandStatement or PrintStatement or DeclareVariableStatement
                or SetVariableStatement or SetTransactionIsolationLevelStatement:
                IgnoredStatements++;
                break;

            case InsertStatement or UpdateStatement or DeleteStatement or SelectStatement or MergeStatement
                or TruncateTableStatement or ExecuteStatement:
                IgnoredStatements++;
                warnings.Add(WarningCodes.UnsupportedStatement,
                    $"{Friendly(statement)} is a data/execution statement, not schema; it was ignored.",
                    null, ctx.File, ctx.Line(statement));
                break;

            default:
            {
                IgnoredStatements++;
                var friendly = Friendly(statement);
                schema.Unsupported[friendly] = schema.Unsupported.GetValueOrDefault(friendly) + 1;
                warnings.Add(WarningCodes.UnsupportedStatement,
                    $"{friendly} is not supported and was ignored.", null, ctx.File, ctx.Line(statement));
                break;
            }
        }
    }

    private static string Friendly(TSqlStatement statement)
    {
        var name = statement.GetType().Name;
        if (name.EndsWith("Statement", StringComparison.Ordinal))
        {
            name = name[..^"Statement".Length];
        }

        return PascalWords().Replace(name, " $1").Trim().ToUpperInvariant();
    }

    [GeneratedRegex("(?<!^)([A-Z])")]
    private static partial Regex PascalWords();

    // ------------------------------------------------------------------ object registry

    private SchemaObject Define(string type, string schemaName, string name, TSqlStatement statement,
        StatementContext ctx, Mode mode)
    {
        var key = Key(type, schemaName, name);
        var obj = new SchemaObject
        {
            ObjectType = type,
            SchemaName = schemaName,
            Name = name,
            Definition = ctx.TextOf(statement),
            SourceFile = ctx.File,
            SourceLine = ctx.Line(statement),
        };

        if (_byKey.TryGetValue(key, out var old))
        {
            if (mode == Mode.Create)
            {
                warnings.Add(WarningCodes.DuplicateDefinition,
                    $"{type} '{obj.DisplayName}' is defined more than once; the last definition was kept.",
                    obj.DisplayName, ctx.File, ctx.Line(statement));
            }

            var index = schema.Objects.IndexOf(old);
            schema.Objects[index] = obj;
        }
        else
        {
            if (mode == Mode.Alter)
            {
                warnings.Add(WarningCodes.AlterWithoutCreate,
                    $"{type} '{obj.DisplayName}' is altered but no CREATE was found; it was imported from the ALTER statement.",
                    obj.DisplayName, ctx.File, ctx.Line(statement));
            }

            schema.Objects.Add(obj);
        }

        _byKey[key] = obj;
        return obj;
    }

    private void Remove(SchemaObject? obj)
    {
        if (obj is null)
        {
            return;
        }

        schema.Objects.Remove(obj);
        _byKey.Remove(Key(obj.ObjectType, obj.SchemaName, obj.Name));
    }

    private void DropAll(string type, IEnumerable<SchemaObjectName> names)
    {
        foreach (var n in names)
        {
            var (sch, name) = Split(n);
            Remove(Find(type, sch, name));
        }

        IgnoredStatements++;
    }

    private void DropIndexes(DropIndexStatement s)
    {
        foreach (var clause in s.DropIndexClauses)
        {
            switch (clause)
            {
                case DropIndexClause { Object: not null } c:
                {
                    var (sch, name) = Split(c.Object);
                    FindRelation(sch, name)?.Indexes.RemoveAll(i => i.Name.Equals(c.Index.Value, StringComparison.OrdinalIgnoreCase) && !i.IsPrimaryKey && !i.IsUniqueConstraint);
                    break;
                }
                case BackwardsCompatibleDropIndexClause { Index: not null } b:
                {
                    var (sch, name) = Split(b.Index);
                    FindRelation(sch, name)?.Indexes.RemoveAll(i => i.Name.Equals(b.Index.BaseIdentifier.Value, StringComparison.OrdinalIgnoreCase) && !i.IsPrimaryKey && !i.IsUniqueConstraint);
                    break;
                }
            }
        }

        IgnoredStatements++;
    }

    // ------------------------------------------------------------------ tables

    private void CreateTable(CreateTableStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.SchemaObjectName);
        var table = Define(ObjectTypes.Table, sch, name, s, ctx, Mode.Create);
        SchemaStatements++;

        AddElements(table, s.Definition, ctx);
    }

    private void AddElements(SchemaObject table, TableDefinition definition, StatementContext ctx)
    {
        foreach (var cd in definition.ColumnDefinitions)
        {
            AddColumn(table, cd, ctx);
        }

        foreach (var c in definition.TableConstraints)
        {
            ApplyConstraint(table, c, null, ctx);
        }

        foreach (var ix in definition.Indexes)
        {
            AddInlineIndex(table, ix, ctx);
        }

        Renumber(table);
    }

    private static void Renumber(SchemaObject table)
    {
        for (var i = 0; i < table.Columns.Count; i++)
        {
            table.Columns[i].Ordinal = i + 1;
        }
    }

    private static ColumnInfo? FindColumn(SchemaObject table, string name) =>
        table.Columns.FirstOrDefault(c => c.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    private static void ApplyType(ColumnInfo col, DataTypeReference? type)
    {
        var info = DataTypeFormatter.Describe(type);
        col.DataType = info.BaseName;
        col.MaxLength = info.MaxLength;
        col.NumericPrecision = info.Precision;
        col.NumericScale = info.Scale;
    }

    private void AddColumn(SchemaObject table, ColumnDefinition cd, StatementContext ctx)
    {
        var col = new ColumnInfo { Name = cd.ColumnIdentifier.Value };
        if (cd.ComputedColumnExpression is not null)
        {
            col.IsComputed = true;
            col.ComputedExpression = ctx.TextOf(cd.ComputedColumnExpression);
            col.DataType = "computed";
        }
        else
        {
            ApplyType(col, cd.DataType);
        }

        if (cd.IdentityOptions is not null)
        {
            col.IsIdentity = true;
            col.IsNullable = false;
        }

        var existing = FindColumn(table, col.Name);
        if (existing is not null)
        {
            table.Columns[table.Columns.IndexOf(existing)] = col;
        }
        else
        {
            table.Columns.Add(col);
        }

        if (cd.DefaultConstraint is not null)
        {
            AddDefault(table, cd.DefaultConstraint, col.Name, ctx);
        }

        foreach (var c in cd.Constraints)
        {
            ApplyConstraint(table, c, col.Name, ctx);
        }

        if (cd.Index is not null)
        {
            AddInlineIndex(table, cd.Index, ctx, col.Name);
        }
    }

    private void ApplyConstraint(SchemaObject table, ConstraintDefinition c, string? inlineColumn, StatementContext ctx)
    {
        switch (c)
        {
            case NullableConstraintDefinition n when inlineColumn is not null:
                if (FindColumn(table, inlineColumn) is { } col && col.IsNullable != false)
                {
                    col.IsNullable = n.Nullable;
                }

                break;

            case UniqueConstraintDefinition u:
            {
                var keys = u.Columns.Count > 0
                    ? u.Columns.Select(KeyOf).ToList()
                    : inlineColumn is null ? [] : [new IndexKeyColumn { Name = inlineColumn }];
                var clustered = u.Clustered ?? (u.IndexType?.IndexTypeKind is IndexTypeKind.Clustered ? true : null);
                AddKeyConstraint(table, u.ConstraintIdentifier?.Value, u.IsPrimaryKey, clustered, keys, ctx.TextOf(u));
                break;
            }

            case CheckConstraintDefinition ch:
            {
                var cols = ReferencedColumns(table, ch.CheckCondition, inlineColumn);
                table.Constraints.Add(new ConstraintInfo
                {
                    Name = ch.ConstraintIdentifier?.Value,
                    ConstraintType = ConstraintTypes.Check,
                    Columns = cols,
                    Expression = ctx.TextOf(ch.CheckCondition),
                });
                break;
            }

            case ForeignKeyConstraintDefinition fk:
                AddForeignKey(table, fk, inlineColumn);
                break;

            case DefaultConstraintDefinition d:
                AddDefault(table, d, d.Column?.Value ?? inlineColumn, ctx);
                break;
        }
    }

    private static IndexKeyColumn KeyOf(ColumnWithSortOrder c) => new()
    {
        Name = c.Column.MultiPartIdentifier.Identifiers[^1].Value,
        Descending = c.SortOrder == SortOrder.Descending ? true : null,
    };

    private static List<string> ReferencedColumns(SchemaObject table, TSqlFragment expression, string? inlineColumn)
    {
        var collector = new ColumnRefCollector();
        expression.Accept(collector);
        var result = new List<string>();
        foreach (var n in collector.Names)
        {
            var match = FindColumn(table, n);
            if (match is not null && !result.Contains(match.Name, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(match.Name);
            }
        }

        if (result.Count == 0 && inlineColumn is not null)
        {
            result.Add(inlineColumn);
        }

        return result;
    }

    private sealed class ColumnRefCollector : TSqlFragmentVisitor
    {
        public List<string> Names { get; } = [];

        public override void Visit(ColumnReferenceExpression node)
        {
            if (node.MultiPartIdentifier is { Identifiers.Count: > 0 } id)
            {
                Names.Add(id.Identifiers[^1].Value);
            }
        }
    }

    private void AddDefault(SchemaObject table, DefaultConstraintDefinition d, string? column, StatementContext ctx)
    {
        var expression = ctx.TextOf(d.Expression);
        if (column is not null && FindColumn(table, column) is { } col)
        {
            col.DefaultValue = expression;
        }

        table.Constraints.Add(new ConstraintInfo
        {
            Name = d.ConstraintIdentifier?.Value,
            ConstraintType = ConstraintTypes.Default,
            Columns = column is null ? [] : [column],
            Expression = expression,
        });
    }

    private static void AddKeyConstraint(SchemaObject table, string? name, bool primary, bool? clustered,
        List<IndexKeyColumn> keys, string definition)
    {
        if (primary)
        {
            // A table has one primary key; a later one replaces the earlier definition.
            table.Constraints.RemoveAll(c => c.ConstraintType == ConstraintTypes.PrimaryKey);
            table.Indexes.RemoveAll(i => i.IsPrimaryKey);
            foreach (var c in table.Columns)
            {
                c.IsPrimaryKey = false;
            }
        }

        var columnNames = keys.Select(k => k.Name).ToList();
        table.Constraints.Add(new ConstraintInfo
        {
            Name = name,
            ConstraintType = primary ? ConstraintTypes.PrimaryKey : ConstraintTypes.Unique,
            Columns = columnNames,
        });

        var isClustered = clustered ?? primary;
        table.Indexes.Add(new IndexInfo
        {
            Name = name ?? (primary ? $"PK_{table.Name}" : $"UQ_{table.Name}_{string.Join('_', columnNames)}"),
            IndexType = isClustered ? "CLUSTERED" : "NONCLUSTERED",
            IsUnique = true,
            IsPrimaryKey = primary,
            IsUniqueConstraint = !primary,
            KeyColumns = keys,
            Definition = definition,
        });

        if (primary)
        {
            foreach (var n in columnNames)
            {
                if (FindColumn(table, n) is { } col)
                {
                    col.IsPrimaryKey = true;
                    col.IsNullable = false;
                }
            }
        }
    }

    private void AddInlineIndex(SchemaObject table, IndexDefinition ix, StatementContext ctx, string? inlineColumn = null)
    {
        var keys = ix.Columns.Count > 0
            ? ix.Columns.Select(KeyOf).ToList()
            : inlineColumn is null ? [] : [new IndexKeyColumn { Name = inlineColumn }];
        var clustered = ix.IndexType?.IndexTypeKind;
        var name = ix.Name?.Value ?? $"IX_{table.Name}_{string.Join('_', keys.Select(k => k.Name))}";
        table.Indexes.RemoveAll(i => i.Name.Equals(name, StringComparison.OrdinalIgnoreCase) && !i.IsPrimaryKey && !i.IsUniqueConstraint);
        table.Indexes.Add(new IndexInfo
        {
            Name = name,
            IndexType = clustered switch
            {
                IndexTypeKind.Clustered => "CLUSTERED",
                IndexTypeKind.ClusteredColumnStore => "CLUSTERED COLUMNSTORE",
                IndexTypeKind.NonClusteredColumnStore => "NONCLUSTERED COLUMNSTORE",
                _ => "NONCLUSTERED",
            },
            IsUnique = ix.Unique,
            KeyColumns = keys,
            Definition = ctx.TextOf(ix),
        });
    }

    private void AddForeignKey(SchemaObject table, ForeignKeyConstraintDefinition fk, string? inlineColumn)
    {
        var source = fk.Columns.Count > 0
            ? fk.Columns.Select(c => c.Value).ToList()
            : inlineColumn is null ? [] : [inlineColumn];
        var (targetSchema, targetName) = Split(fk.ReferenceTableName);
        var info = new ForeignKeyInfo
        {
            Name = fk.ConstraintIdentifier?.Value,
            SourceColumns = source,
            TargetSchema = targetSchema,
            TargetName = targetName,
            TargetColumns = fk.ReferencedTableColumns.Select(c => c.Value).ToList(),
            OnDelete = Action(fk.DeleteAction),
            OnUpdate = Action(fk.UpdateAction),
        };

        if (info.Name is not null)
        {
            table.ForeignKeys.RemoveAll(f => string.Equals(f.Name, info.Name, StringComparison.OrdinalIgnoreCase));
        }

        table.ForeignKeys.Add(info);
    }

    private static string Action(DeleteUpdateAction action) => action switch
    {
        DeleteUpdateAction.Cascade => "CASCADE",
        DeleteUpdateAction.SetNull => "SET NULL",
        DeleteUpdateAction.SetDefault => "SET DEFAULT",
        _ => "NO ACTION",
    };

    private void AlterTableAdd(AlterTableAddTableElementStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.SchemaObjectName);
        var table = Find(ObjectTypes.Table, sch, name);
        if (table is null)
        {
            warnings.Add(WarningCodes.UnresolvedTarget,
                $"ALTER TABLE targets '{sch}.{name}', which was not defined in this file; the change was ignored.",
                $"{sch}.{name}", ctx.File, ctx.Line(s));
            return;
        }

        SchemaStatements++;
        AddElements(table, s.Definition, ctx);
    }

    private void AlterColumn(AlterTableAlterColumnStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.SchemaObjectName);
        var table = Find(ObjectTypes.Table, sch, name);
        var col = table is null ? null : FindColumn(table, s.ColumnIdentifier.Value);
        if (table is null || col is null)
        {
            warnings.Add(WarningCodes.UnresolvedTarget,
                $"ALTER COLUMN targets '{sch}.{name}.{s.ColumnIdentifier.Value}', which was not defined in this file; the change was ignored.",
                $"{sch}.{name}", ctx.File, ctx.Line(s));
            return;
        }

        SchemaStatements++;
        if (s.DataType is not null)
        {
            ApplyType(col, s.DataType);
        }

        switch (s.AlterTableAlterColumnOption)
        {
            case AlterTableAlterColumnOption.Null:
                col.IsNullable = true;
                break;
            case AlterTableAlterColumnOption.NotNull:
                col.IsNullable = false;
                break;
        }
    }

    private void AlterTableDrop(AlterTableDropTableElementStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.SchemaObjectName);
        var table = Find(ObjectTypes.Table, sch, name);
        if (table is null)
        {
            warnings.Add(WarningCodes.UnresolvedTarget,
                $"ALTER TABLE targets '{sch}.{name}', which was not defined in this file; the change was ignored.",
                $"{sch}.{name}", ctx.File, ctx.Line(s));
            return;
        }

        SchemaStatements++;
        foreach (var element in s.AlterTableDropTableElements)
        {
            var target = element.Name.Value;
            if (element.TableElementType == TableElementType.Column)
            {
                table.Columns.RemoveAll(c => c.Name.Equals(target, StringComparison.OrdinalIgnoreCase));
                foreach (var cons in table.Constraints)
                {
                    cons.Columns.RemoveAll(c => c.Equals(target, StringComparison.OrdinalIgnoreCase));
                }

                table.Constraints.RemoveAll(c => c.Columns.Count == 0 && c.ConstraintType is ConstraintTypes.PrimaryKey or ConstraintTypes.Unique);
                table.ForeignKeys.RemoveAll(f => f.SourceColumns.Contains(target, StringComparer.OrdinalIgnoreCase));
            }
            else
            {
                var removed = table.Constraints.FirstOrDefault(c => string.Equals(c.Name, target, StringComparison.OrdinalIgnoreCase));
                table.Constraints.RemoveAll(c => string.Equals(c.Name, target, StringComparison.OrdinalIgnoreCase));
                table.ForeignKeys.RemoveAll(f => string.Equals(f.Name, target, StringComparison.OrdinalIgnoreCase));
                table.Indexes.RemoveAll(i => i.Name.Equals(target, StringComparison.OrdinalIgnoreCase) && (i.IsPrimaryKey || i.IsUniqueConstraint));

                if (removed?.ConstraintType == ConstraintTypes.PrimaryKey)
                {
                    foreach (var c in table.Columns)
                    {
                        c.IsPrimaryKey = false;
                    }
                }
                else if (removed?.ConstraintType == ConstraintTypes.Default)
                {
                    foreach (var c in removed.Columns)
                    {
                        if (FindColumn(table, c) is { } col)
                        {
                            col.DefaultValue = null;
                        }
                    }
                }
            }
        }

        Renumber(table);
    }

    // ------------------------------------------------------------------ indexes

    private void CreateIndex(CreateIndexStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.OnName);
        var target = FindRelation(sch, name);
        if (target is null)
        {
            warnings.Add(WarningCodes.UnresolvedTarget,
                $"Index '{s.Name.Value}' targets '{sch}.{name}', which was not defined in this file; the index was ignored.",
                $"{sch}.{name}", ctx.File, ctx.Line(s));
            return;
        }

        SchemaStatements++;
        var index = new IndexInfo
        {
            Name = s.Name.Value,
            IndexType = s.Clustered == true ? "CLUSTERED" : "NONCLUSTERED",
            IsUnique = s.Unique,
            KeyColumns = s.Columns.Select(KeyOf).ToList(),
            IncludedColumns = s.IncludeColumns.Select(c => c.MultiPartIdentifier.Identifiers[^1].Value).ToList(),
            FilterDefinition = s.FilterPredicate is null ? null : ctx.TextOf(s.FilterPredicate),
            Definition = ctx.TextOf(s),
        };
        AddOrReplaceIndex(target, index);
    }

    private void CreateColumnStoreIndex(CreateColumnStoreIndexStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.OnName);
        var target = FindRelation(sch, name);
        if (target is null)
        {
            warnings.Add(WarningCodes.UnresolvedTarget,
                $"Columnstore index '{s.Name.Value}' targets '{sch}.{name}', which was not defined in this file; the index was ignored.",
                $"{sch}.{name}", ctx.File, ctx.Line(s));
            return;
        }

        SchemaStatements++;
        AddOrReplaceIndex(target, new IndexInfo
        {
            Name = s.Name.Value,
            IndexType = s.Clustered == true ? "CLUSTERED COLUMNSTORE" : "NONCLUSTERED COLUMNSTORE",
            KeyColumns = s.Columns.Select(c => new IndexKeyColumn { Name = c.MultiPartIdentifier.Identifiers[^1].Value }).ToList(),
            FilterDefinition = s.FilterPredicate is null ? null : ctx.TextOf(s.FilterPredicate),
            Definition = ctx.TextOf(s),
        });
    }

    private static void AddOrReplaceIndex(SchemaObject target, IndexInfo index)
    {
        target.Indexes.RemoveAll(i => i.Name.Equals(index.Name, StringComparison.OrdinalIgnoreCase) && !i.IsPrimaryKey && !i.IsUniqueConstraint);
        target.Indexes.Add(index);
    }

    // ------------------------------------------------------------------ programmable objects

    private static Mode ModeOf(TSqlStatement s) => s switch
    {
        CreateOrAlterViewStatement or CreateOrAlterProcedureStatement or CreateOrAlterFunctionStatement
            or CreateOrAlterTriggerStatement => Mode.CreateOrAlter,
        AlterViewStatement or AlterProcedureStatement or AlterFunctionStatement or AlterTriggerStatement => Mode.Alter,
        _ => Mode.Create,
    };

    private void CreateView(ViewStatementBody s, StatementContext ctx)
    {
        var (sch, name) = Split(s.SchemaObjectName);
        var view = Define(ObjectTypes.View, sch, name, s, ctx, ModeOf(s));
        SchemaStatements++;
        view.Metadata.IsSchemaBound = s.ViewOptions.Any(o => o.OptionKind == ViewOptionKind.SchemaBinding) ? true : null;
        view.Body = BodyAnalyzer.Analyze(s, ctx.LineBase);
    }

    private static List<ParameterMetadata> Parameters(IEnumerable<ProcedureParameter> parameters, StatementContext ctx) =>
        parameters.Select(p => new ParameterMetadata
        {
            Name = p.VariableName.Value,
            DataType = DataTypeFormatter.Describe(p.DataType).Rendered,
            Direction = p.Modifier == ParameterModifier.Output ? "out" : "in",
            HasDefault = p.Value is not null,
            DefaultValue = p.Value is null ? null : ctx.TextOf(p.Value),
        }).ToList();

    private void CreateProcedure(ProcedureStatementBody s, StatementContext ctx)
    {
        var (sch, name) = Split(s.ProcedureReference.Name);
        var proc = Define(ObjectTypes.Procedure, sch, name, s, ctx, ModeOf(s));
        SchemaStatements++;
        proc.Metadata.Parameters = Parameters(s.Parameters, ctx);
        proc.Body = BodyAnalyzer.Analyze(s, ctx.LineBase);
    }

    private void CreateFunction(FunctionStatementBody s, StatementContext ctx)
    {
        var (sch, name) = Split(s.Name);
        var fn = Define(ObjectTypes.Function, sch, name, s, ctx, ModeOf(s));
        SchemaStatements++;
        fn.Metadata.Parameters = Parameters(s.Parameters, ctx);
        fn.Metadata.IsSchemaBound = s.Options.OfType<FunctionOption>().Any(o => o.OptionKind == FunctionOptionKind.SchemaBinding) ? true : null;
        switch (s.ReturnType)
        {
            case ScalarFunctionReturnType scalar:
                fn.Metadata.FunctionType = "scalar";
                fn.Metadata.ReturnType = DataTypeFormatter.Describe(scalar.DataType).Rendered;
                break;
            case SelectFunctionReturnType:
                fn.Metadata.FunctionType = "inline_table_valued";
                fn.Metadata.ReturnType = "TABLE";
                break;
            case TableValuedFunctionReturnType:
                fn.Metadata.FunctionType = "multi_statement_table_valued";
                fn.Metadata.ReturnType = "TABLE";
                break;
            default:
                fn.Metadata.FunctionType = "unknown";
                break;
        }

        fn.Body = BodyAnalyzer.Analyze(s, ctx.LineBase);
    }

    private void CreateTrigger(TriggerStatementBody s, StatementContext ctx)
    {
        if (s.TriggerObject.TriggerScope != TriggerScope.Normal)
        {
            IgnoredStatements++;
            var friendly = "DDL TRIGGER";
            schema.Unsupported[friendly] = schema.Unsupported.GetValueOrDefault(friendly) + 1;
            warnings.Add(WarningCodes.UnsupportedStatement,
                $"DDL (database/server scoped) trigger '{s.Name.BaseIdentifier.Value}' is not supported and was ignored.",
                s.Name.BaseIdentifier.Value, ctx.File, ctx.Line(s));
            return;
        }

        var (sch, name) = Split(s.Name);
        var trigger = Define(ObjectTypes.Trigger, sch, name, s, ctx, ModeOf(s));
        SchemaStatements++;
        var (parentSchema, parentName) = Split(s.TriggerObject.Name);
        trigger.Metadata.TriggerParent = new TriggerParent { Schema = parentSchema, Name = parentName };
        trigger.Metadata.TriggerEvents = s.TriggerActions.Select(a => a.TriggerActionType.ToString().ToUpperInvariant()).Distinct().ToList();
        trigger.Metadata.TriggerTiming = s.TriggerType == TriggerType.InsteadOf ? "INSTEAD OF" : "AFTER";
        trigger.Body = BodyAnalyzer.Analyze(s, ctx.LineBase);
    }

    private void CreateSynonym(CreateSynonymStatement s, StatementContext ctx)
    {
        var (sch, name) = Split(s.Name);
        var synonym = Define(ObjectTypes.Synonym, sch, name, s, ctx, Mode.Create);
        SchemaStatements++;
        var body = new BodyAnalysis();
        body.References.Add(new RawReference
        {
            Name = RawName.From(s.ForName),
            Kind = DependencyKinds.References,
            Line = ctx.Line(s),
        });
        synonym.Body = body;
    }
}
