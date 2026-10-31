using QueryPilot.SchemaProcessor.Models;

namespace QueryPilot.SchemaProcessor.Extraction;

/// <summary>Collects warnings, capping each code so a pathological file cannot produce an enormous summary.</summary>
public sealed class WarningCollector
{
    private readonly int _perCodeLimit;
    private readonly Dictionary<string, int> _counts = new(StringComparer.Ordinal);
    private readonly List<ImportWarning> _items = [];

    public WarningCollector(int perCodeLimit = 100) => _perCodeLimit = perCodeLimit;

    public IReadOnlyList<ImportWarning> Items => _items;

    public void Add(string code, string message, string? objectName = null, string? file = null, int? line = null)
    {
        _counts.TryGetValue(code, out var n);
        _counts[code] = n + 1;
        if (n < _perCodeLimit)
        {
            _items.Add(new ImportWarning(code, message, objectName, file, line));
        }
    }

    /// <summary>Appends one summary warning per code whose cap was exceeded; call once at the end.</summary>
    public IReadOnlyList<ImportWarning> Finish()
    {
        foreach (var (code, count) in _counts)
        {
            if (count > _perCodeLimit)
            {
                _items.Add(new ImportWarning(
                    WarningCodes.TooManyWarnings,
                    $"{count - _perCodeLimit} more '{code}' warnings were omitted."));
            }
        }

        _counts.Clear();
        return _items;
    }
}
