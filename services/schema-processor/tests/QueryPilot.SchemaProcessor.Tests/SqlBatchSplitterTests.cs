using QueryPilot.SchemaProcessor.SqlParser;

namespace QueryPilot.SchemaProcessor.Tests;

public class SqlBatchSplitterTests
{
    [Fact]
    public void Splits_on_go_and_tracks_start_lines()
    {
        var r = SqlBatchSplitter.Split("SELECT 1;\nGO\nSELECT 2;\nGO\n\nSELECT 3;");

        Assert.Equal(3, r.Batches.Count);
        Assert.Equal([1, 3, 5], r.Batches.Select(b => b.StartLine).ToArray());
        Assert.Equal("SELECT 3;", r.Batches[2].Text.Trim());
    }

    [Fact]
    public void Go_with_count_is_a_separator_and_records_the_count()
    {
        var r = SqlBatchSplitter.Split("INSERT INTO t VALUES (1)\nGO 3\nSELECT 1");

        Assert.Equal(2, r.Batches.Count);
        Assert.Equal(3, r.Batches[0].GoCount);
        Assert.Equal("SELECT 1", r.Batches[1].Text);
    }

    [Theory]
    [InlineData("go")]
    [InlineData("  GO  ")]
    [InlineData("GO -- trailing comment")]
    [InlineData("Go\r")]
    public void Go_is_case_insensitive_and_tolerates_whitespace_and_comments(string goLine)
    {
        var r = SqlBatchSplitter.Split($"SELECT 1\n{goLine}\nSELECT 2");
        Assert.Equal(2, r.Batches.Count);
    }

    [Fact]
    public void Go_inside_block_comment_string_or_bracket_is_not_a_separator()
    {
        var sql = "/* header\nGO\n*/\nSELECT 'a\nGO\nb' AS x, [weird\nGO\nname] AS y;\nSELECT \"q\nGO\" AS z;";
        var r = SqlBatchSplitter.Split(sql);

        Assert.Single(r.Batches);
        Assert.Equal(sql, r.Batches[0].Text);
    }

    [Fact]
    public void Nested_block_comments_are_handled()
    {
        var r = SqlBatchSplitter.Split("/* outer /* inner */\nGO\n still comment */\nSELECT 1\nGO\nSELECT 2");
        Assert.Equal(2, r.Batches.Count);
    }

    [Theory]
    [InlineData("GOTO label")]
    [InlineData("GO 3 x")]
    [InlineData("SELECT 1 GO")]
    [InlineData("GOO")]
    public void Lines_that_merely_contain_go_are_not_separators(string line)
    {
        var r = SqlBatchSplitter.Split($"SELECT 0\n{line}\nSELECT 2");
        Assert.Single(r.Batches);
    }

    [Fact]
    public void Escaped_quotes_do_not_end_a_string_early()
    {
        var r = SqlBatchSplitter.Split("SELECT 'it''s\nGO\nstill string' AS a\nGO\nSELECT 2");
        Assert.Equal(2, r.Batches.Count);
    }

    [Fact]
    public void Sqlcmd_directives_are_reported_and_separate_batches()
    {
        var r = SqlBatchSplitter.Split("SELECT 1\n:setvar Db Test\nSELECT 2");

        Assert.Equal(2, r.Batches.Count);
        var d = Assert.Single(r.Directives);
        Assert.Equal(2, d.Line);
    }

    [Fact]
    public void Whitespace_only_batches_are_dropped()
    {
        var r = SqlBatchSplitter.Split("\n\nGO\n  \nGO\n");
        Assert.Empty(r.Batches);
    }
}
