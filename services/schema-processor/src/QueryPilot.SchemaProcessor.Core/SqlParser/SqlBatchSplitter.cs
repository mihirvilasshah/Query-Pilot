namespace QueryPilot.SchemaProcessor.SqlParser;

/// <param name="Text">Exact slice of the original script (never modified).</param>
/// <param name="StartLine">1-based line in the original file where <paramref name="Text"/> starts.</param>
/// <param name="GoCount">Repeat count from <c>GO n</c> (1 when absent); informational — a batch is analysed once.</param>
public sealed record SqlBatch(string Text, int StartLine, int GoCount);

public sealed record SqlcmdDirective(int Line, string Text);

public sealed record SplitResult(IReadOnlyList<SqlBatch> Batches, IReadOnlyList<SqlcmdDirective> Directives);

/// <summary>
/// Splits a T-SQL script on <c>GO</c> batch separators the way sqlcmd/SSMS do: <c>GO</c> must be alone on its line
/// (optionally with a count and a trailing comment) and is ignored inside comments, strings and bracketed identifiers.
/// </summary>
public static class SqlBatchSplitter
{
    private enum State { Normal, LineComment, BlockComment, SingleQuote, DoubleQuote, Bracket }

    public static SplitResult Split(string text)
    {
        var batches = new List<SqlBatch>();
        var directives = new List<SqlcmdDirective>();

        var state = State.Normal;
        var blockDepth = 0;
        var line = 1;
        var batchStart = 0;
        var batchStartLine = 1;
        var atLineStart = true;
        var i = 0;

        void Flush(int endExclusive, int goCount)
        {
            var slice = text.AsSpan(batchStart, endExclusive - batchStart);
            if (!slice.IsWhiteSpace())
            {
                batches.Add(new SqlBatch(slice.ToString(), batchStartLine, goCount));
            }
        }

        while (i < text.Length)
        {
            var c = text[i];

            if (state == State.Normal && atLineStart)
            {
                var lineEnd = IndexOfNewline(text, i);
                if (TryMatchGo(text, i, lineEnd, out var goCount))
                {
                    Flush(i, goCount);
                    i = lineEnd < text.Length ? lineEnd + 1 : text.Length;
                    line++;
                    batchStart = i;
                    batchStartLine = line;
                    continue;
                }

                if (TryMatchSqlcmd(text, i, lineEnd))
                {
                    Flush(i, 1);
                    directives.Add(new SqlcmdDirective(line, text[i..lineEnd].Trim()));
                    i = lineEnd < text.Length ? lineEnd + 1 : text.Length;
                    line++;
                    batchStart = i;
                    batchStartLine = line;
                    continue;
                }
            }

            atLineStart = false;

            switch (state)
            {
                case State.Normal:
                    if (c == '-' && Peek(text, i + 1) == '-')
                    {
                        state = State.LineComment;
                        i++;
                    }
                    else if (c == '/' && Peek(text, i + 1) == '*')
                    {
                        state = State.BlockComment;
                        blockDepth = 1;
                        i++;
                    }
                    else if (c == '\'')
                    {
                        state = State.SingleQuote;
                    }
                    else if (c == '"')
                    {
                        state = State.DoubleQuote;
                    }
                    else if (c == '[')
                    {
                        state = State.Bracket;
                    }
                    break;

                case State.LineComment:
                    if (c == '\n')
                    {
                        state = State.Normal;
                    }
                    break;

                case State.BlockComment:
                    if (c == '/' && Peek(text, i + 1) == '*')
                    {
                        blockDepth++;
                        i++;
                    }
                    else if (c == '*' && Peek(text, i + 1) == '/')
                    {
                        blockDepth--;
                        i++;
                        if (blockDepth == 0)
                        {
                            state = State.Normal;
                        }
                    }
                    break;

                case State.SingleQuote:
                    if (c == '\'')
                    {
                        if (Peek(text, i + 1) == '\'')
                        {
                            i++;
                        }
                        else
                        {
                            state = State.Normal;
                        }
                    }
                    break;

                case State.DoubleQuote:
                    if (c == '"')
                    {
                        if (Peek(text, i + 1) == '"')
                        {
                            i++;
                        }
                        else
                        {
                            state = State.Normal;
                        }
                    }
                    break;

                case State.Bracket:
                    if (c == ']')
                    {
                        if (Peek(text, i + 1) == ']')
                        {
                            i++;
                        }
                        else
                        {
                            state = State.Normal;
                        }
                    }
                    break;
            }

            if (i < text.Length && text[i] == '\n')
            {
                line++;
                atLineStart = true;
            }

            i++;
        }

        Flush(text.Length, 1);
        return new SplitResult(batches, directives);
    }

    private static char Peek(string text, int index) => index < text.Length ? text[index] : '\0';

    private static int IndexOfNewline(string text, int from)
    {
        var idx = text.IndexOf('\n', from);
        return idx < 0 ? text.Length : idx;
    }

    private static bool TryMatchGo(string text, int lineStart, int lineEnd, out int goCount)
    {
        goCount = 1;
        var i = lineStart;
        while (i < lineEnd && text[i] is ' ' or '\t')
        {
            i++;
        }

        if (i + 1 >= lineEnd ||
            (text[i] is not ('G' or 'g')) || (text[i + 1] is not ('O' or 'o')))
        {
            return false;
        }

        i += 2;
        if (i < lineEnd && !(char.IsWhiteSpace(text[i]) || text[i] == '-'))
        {
            return false;
        }

        while (i < lineEnd && text[i] is ' ' or '\t')
        {
            i++;
        }

        var digitsStart = i;
        while (i < lineEnd && char.IsAsciiDigit(text[i]))
        {
            i++;
        }

        if (i > digitsStart)
        {
            if (!int.TryParse(text.AsSpan(digitsStart, i - digitsStart), out goCount) || goCount < 1)
            {
                goCount = 1;
            }
        }

        while (i < lineEnd && (text[i] is ' ' or '\t' or '\r'))
        {
            i++;
        }

        // Only whitespace or a trailing "-- comment" may follow.
        return i >= lineEnd || (text[i] == '-' && Peek(text, i + 1) == '-');
    }

    private static bool TryMatchSqlcmd(string text, int lineStart, int lineEnd)
    {
        var i = lineStart;
        while (i < lineEnd && text[i] is ' ' or '\t')
        {
            i++;
        }

        if (i >= lineEnd || text[i] != ':' || i + 1 >= lineEnd || !char.IsLetter(text[i + 1]))
        {
            return false;
        }

        var word = text.AsSpan(i + 1, Math.Min(lineEnd - i - 1, 12));
        foreach (var d in new[] { "setvar", "on error", "r ", "connect", "out", "ed", "list", "reset", "quit", "exit", "help", "error", "perftrace", "xml", "serverlist" })
        {
            if (word.StartsWith(d, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
