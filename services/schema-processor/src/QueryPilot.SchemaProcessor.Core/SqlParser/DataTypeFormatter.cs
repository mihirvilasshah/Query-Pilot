using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace QueryPilot.SchemaProcessor.SqlParser;

public sealed record DataTypeInfo(
    string BaseName,
    string Rendered,
    int? MaxLength,
    int? Precision,
    int? Scale);

/// <summary>Turns ScriptDom data type references into the column attributes the database stores.</summary>
public static class DataTypeFormatter
{
    public static DataTypeInfo Describe(DataTypeReference? type)
    {
        switch (type)
        {
            case null:
                return new DataTypeInfo("unknown", "unknown", null, null, null);

            case SqlDataTypeReference sql:
            {
                var name = sql.SqlDataTypeOption.ToString().ToLowerInvariant();
                var args = sql.Parameters.Select(p => p.Value ?? "").ToList();
                var rendered = args.Count > 0 ? $"{name}({string.Join(", ", args)})" : name;

                int? length = null, precision = null, scale = null;
                switch (sql.SqlDataTypeOption)
                {
                    case SqlDataTypeOption.Char:
                    case SqlDataTypeOption.VarChar:
                    case SqlDataTypeOption.NChar:
                    case SqlDataTypeOption.NVarChar:
                    case SqlDataTypeOption.Binary:
                    case SqlDataTypeOption.VarBinary:
                        // Declared length in characters/bytes as written; MAX is -1; SQL Server's default when omitted is 1.
                        length = args.Count == 0 ? 1 : ParseLength(args[0]);
                        break;
                    case SqlDataTypeOption.Decimal:
                    case SqlDataTypeOption.Numeric:
                        precision = args.Count > 0 ? ParseInt(args[0]) : 18;
                        scale = args.Count > 1 ? ParseInt(args[1]) : 0;
                        break;
                    case SqlDataTypeOption.Float:
                        precision = args.Count > 0 ? ParseInt(args[0]) : 53;
                        break;
                    case SqlDataTypeOption.DateTime2:
                    case SqlDataTypeOption.DateTimeOffset:
                    case SqlDataTypeOption.Time:
                        scale = args.Count > 0 ? ParseInt(args[0]) : 7;
                        break;
                }

                return new DataTypeInfo(name, rendered, length, precision, scale);
            }

            case XmlDataTypeReference:
                return new DataTypeInfo("xml", "xml", null, null, null);

            case UserDataTypeReference user:
            {
                var name = string.Join('.', user.Name.Identifiers.Select(i => i.Value));
                var args = user.Parameters.Select(p => p.Value ?? "").ToList();
                var rendered = args.Count > 0 ? $"{name}({string.Join(", ", args)})" : name;
                return new DataTypeInfo(name, rendered, null, null, null);
            }

            default:
                var fallback = type.Name is { } n ? string.Join('.', n.Identifiers.Select(i => i.Value)) : "unknown";
                return new DataTypeInfo(fallback, fallback, null, null, null);
        }
    }

    private static int? ParseLength(string text) =>
        text.Equals("max", StringComparison.OrdinalIgnoreCase) ? -1 : ParseInt(text);

    private static int? ParseInt(string text) => int.TryParse(text, out var v) ? v : null;
}
