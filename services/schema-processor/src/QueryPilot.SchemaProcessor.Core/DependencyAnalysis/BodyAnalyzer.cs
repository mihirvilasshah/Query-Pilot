using Microsoft.SqlServer.TransactSql.ScriptDom;
using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.DependencyAnalysis;

/// <summary>A multi-part name as written in SQL (any part may be absent).</summary>
public sealed record RawName(string? Server, string? Database, string? Schema, string Name)
{
    public static RawName From(SchemaObjectName n) => new(
        n.ServerIdentifier?.Value,
        n.DatabaseIdentifier?.Value,
        n.SchemaIdentifier?.Value,
        n.BaseIdentifier.Value);

    public bool IsExternal => Server is not null || Database is not null;
}

public sealed class RawReference
{
    public required RawName Name { get; init; }
    public required string Kind { get; init; }
    public HashSet<string> Operations { get; } = new(StringComparer.Ordinal);
    public int? Line { get; init; }
}

public sealed record DynamicSqlOccurrence(int? Line, string Note);

/// <summary>Facts gathered by walking one object's parsed body. Purely syntactic; nothing is executed.</summary>
public sealed class BodyAnalysis
{
    public List<RawReference> References { get; } = [];
    public List<DynamicSqlOccurrence> DynamicSql { get; } = [];
    public SortedSet<string> TemporaryTables { get; } = new(StringComparer.OrdinalIgnoreCase);
    public SortedSet<string> TableVariables { get; } = new(StringComparer.OrdinalIgnoreCase);
    public bool HasTransaction { get; set; }
    public OperationCounts Operations { get; } = new();
}

/// <summary>Walks a parsed CREATE/ALTER statement and records what it reads, writes, executes and calls.</summary>
public static class BodyAnalyzer
{
    /// <param name="lineBase">Added to ScriptDom's 1-based fragment line to get the line reported; null keeps lines relative to the fragment's script.</param>
    public static BodyAnalysis Analyze(TSqlFragment root, int? lineBase)
    {
        var ctes = new CteCollector();
        root.Accept(ctes);

        var visitor = new BodyVisitor(ctes.Names, lineBase);
        root.Accept(visitor);
        return visitor.Result;
    }

    private sealed class CteCollector : TSqlFragmentVisitor
    {
        public HashSet<string> Names { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(CommonTableExpression node) => Names.Add(node.ExpressionName.Value);
    }

    private sealed class AliasCollector : TSqlFragmentVisitor
    {
        public Dictionary<string, NamedTableReference> Aliases { get; } = new(StringComparer.OrdinalIgnoreCase);

        public override void Visit(NamedTableReference node)
        {
            if (node.Alias is not null)
            {
                Aliases[node.Alias.Value] = node;
            }
        }
    }

    // Methods on xml / hierarchyid / spatial values parse like function calls with a multi-part target.
    private static readonly HashSet<string> InstanceMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "value", "query", "exist", "nodes", "modify", "GetAncestor", "GetDescendant", "GetLevel", "GetRoot",
        "IsDescendantOf", "Read", "Reparent", "ToString", "GetReparentedValue",
    };

    private sealed class BodyVisitor(HashSet<string> ctes, int? lineBase) : TSqlFragmentVisitor
    {
        private readonly HashSet<TSqlFragment> _skipRead = [];
        public BodyAnalysis Result { get; } = new();

        private int? Line(TSqlFragment f) => lineBase is null ? f.StartLine : lineBase + f.StartLine;

        private void AddRef(SchemaObjectName name, string kind, string? operation, TSqlFragment at)
        {
            var raw = RawName.From(name);
            if (raw.Name.StartsWith('#'))
            {
                Result.TemporaryTables.Add(raw.Name);
                return;
            }

            var existing = Result.References.FirstOrDefault(r => r.Kind == kind && r.Name == raw);
            if (existing is null)
            {
                existing = new RawReference { Name = raw, Kind = kind, Line = Line(at) };
                Result.References.Add(existing);
            }

            if (operation is not null)
            {
                existing.Operations.Add(operation);
            }
        }

        public override void Visit(SchemaObjectName node)
        {
            if (node.BaseIdentifier.Value.StartsWith('#'))
            {
                Result.TemporaryTables.Add(node.BaseIdentifier.Value);
            }
        }

        public override void Visit(DeclareTableVariableBody node) => Result.TableVariables.Add(node.VariableName.Value);

        public override void Visit(NamedTableReference node)
        {
            if (_skipRead.Contains(node))
            {
                return;
            }

            var name = node.SchemaObject;
            if (name.SchemaIdentifier is null && name.DatabaseIdentifier is null &&
                (ctes.Contains(name.BaseIdentifier.Value) ||
                 name.BaseIdentifier.Value.Equals("inserted", StringComparison.OrdinalIgnoreCase) ||
                 name.BaseIdentifier.Value.Equals("deleted", StringComparison.OrdinalIgnoreCase)))
            {
                return;
            }

            AddRef(name, DependencyKinds.Reads, "select", node);
        }

        public override void Visit(SchemaObjectFunctionTableReference node) =>
            AddRef(node.SchemaObject, DependencyKinds.CallsFunction, null, node);

        private void WriteTarget(TableReference? target, FromClause? from, string operation)
        {
            if (target is not NamedTableReference nt)
            {
                return;
            }

            var name = nt.SchemaObject;
            NamedTableReference effective = nt;
            _skipRead.Add(nt);

            // UPDATE/DELETE alias FROM table alias ...: the alias stands for the real table in the FROM clause.
            if (from is not null && name.SchemaIdentifier is null && name.DatabaseIdentifier is null)
            {
                var collector = new AliasCollector();
                from.Accept(collector);
                if (collector.Aliases.TryGetValue(name.BaseIdentifier.Value, out var real))
                {
                    effective = real;
                    _skipRead.Add(real);
                }
            }

            if (effective.SchemaObject.SchemaIdentifier is null &&
                ctes.Contains(effective.SchemaObject.BaseIdentifier.Value))
            {
                return;
            }

            AddRef(effective.SchemaObject, DependencyKinds.Writes, operation, nt);
        }

        public override void Visit(InsertSpecification node)
        {
            Result.Operations.Insert++;
            WriteTarget(node.Target, null, "insert");
        }

        public override void Visit(UpdateSpecification node)
        {
            Result.Operations.Update++;
            WriteTarget(node.Target, node.FromClause, "update");
        }

        public override void Visit(DeleteSpecification node)
        {
            Result.Operations.Delete++;
            WriteTarget(node.Target, node.FromClause, "delete");
        }

        public override void Visit(MergeSpecification node)
        {
            Result.Operations.Merge++;
            WriteTarget(node.Target, null, "merge");
        }

        public override void Visit(TruncateTableStatement node) =>
            AddRef(node.TableName, DependencyKinds.Writes, "truncate", node);

        public override void Visit(BulkInsertStatement node) =>
            AddRef(node.To, DependencyKinds.Writes, "insert", node);

        public override void Visit(SelectStatement node)
        {
            Result.Operations.Select++;
            if (node.Into is not null)
            {
                AddRef(node.Into, DependencyKinds.Writes, "insert", node);
            }
        }

        public override void Visit(ExecuteSpecification node)
        {
            switch (node.ExecutableEntity)
            {
                case ExecutableProcedureReference proc:
                    var reference = proc.ProcedureReference;
                    if (reference?.ProcedureReference?.Name is { } procName)
                    {
                        if (procName.BaseIdentifier.Value.Equals("sp_executesql", StringComparison.OrdinalIgnoreCase))
                        {
                            Result.DynamicSql.Add(new DynamicSqlOccurrence(Line(node),
                                "sp_executesql runs dynamic SQL; objects it touches cannot be determined statically."));
                        }
                        else
                        {
                            AddRef(procName, DependencyKinds.Executes, "exec", node);
                        }
                    }
                    else
                    {
                        Result.DynamicSql.Add(new DynamicSqlOccurrence(Line(node),
                            "EXEC of a procedure name held in a variable; the target cannot be determined statically."));
                    }

                    break;

                case ExecutableStringList:
                    Result.DynamicSql.Add(new DynamicSqlOccurrence(Line(node),
                        "EXEC of a dynamic SQL string; objects it touches cannot be determined statically."));
                    break;
            }
        }

        public override void Visit(FunctionCall node)
        {
            if (node.CallTarget is not MultiPartIdentifierCallTarget target ||
                target.MultiPartIdentifier.Identifiers.Count is < 1 or > 3 ||
                InstanceMethods.Contains(node.FunctionName.Value))
            {
                return;
            }

            // Only schema-qualified calls can be user-defined functions; unqualified ones are built-ins.
            var parts = target.MultiPartIdentifier.Identifiers;
            var raw = new RawName(
                null,
                parts.Count == 2 ? parts[0].Value : parts.Count == 3 ? parts[1].Value : null,
                parts[^1].Value,
                node.FunctionName.Value);
            var line = Line(node);
            var existing = Result.References.FirstOrDefault(r => r.Kind == DependencyKinds.CallsFunction && r.Name == raw);
            if (existing is null)
            {
                Result.References.Add(new RawReference { Name = raw, Kind = DependencyKinds.CallsFunction, Line = line });
            }
        }

        public override void Visit(NextValueForExpression node) =>
            AddRef(node.SequenceName, DependencyKinds.References, null, node);

        public override void Visit(BeginTransactionStatement node) => Result.HasTransaction = true;

        public override void Visit(CommitTransactionStatement node) => Result.HasTransaction = true;

        public override void Visit(RollbackTransactionStatement node) => Result.HasTransaction = true;

        public override void Visit(SaveTransactionStatement node) => Result.HasTransaction = true;
    }
}
