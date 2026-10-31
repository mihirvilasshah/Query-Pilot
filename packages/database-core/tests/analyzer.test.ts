import { describe, expect, it } from "vitest";
import { analyzeSql, splitBatches, tokenize } from "../src";

const titles = (sql: string) => analyzeSql(sql).findings.map((f) => f.title);

describe("tokenizer", () => {
  it("handles GO separators, counts and comments", () => {
    const { tokens } = tokenize("SELECT 1\nGO\nSELECT 2\nGO 3 -- three times\n-- GO\nSELECT 'GO'\n");
    const batches = splitBatches(tokens);
    expect(batches).toHaveLength(3);
    expect(batches[1]!.repeat).toBe(3);
  });

  it("does not treat GO inside strings/comments as a separator", () => {
    const { tokens } = tokenize("SELECT '\nGO\n' AS x /*\nGO\n*/");
    expect(tokens.some((t) => t.type === "go")).toBe(false);
  });

  it("supports nested block comments and escaped quotes", () => {
    const { tokens, unterminated } = tokenize("/* a /* b */ c */ SELECT 'it''s' , [we]]ird]");
    expect(unterminated).toHaveLength(0);
    expect(tokens.map((t) => t.type)).toEqual(["word", "string", "punct", "ident"]);
    expect(tokens[3]!.upper).toBe("we]ird");
  });

  it("reports unterminated strings", () => {
    expect(tokenize("SELECT 'oops").unterminated[0]?.kind).toBe("string");
  });
});

describe("statement analysis", () => {
  it("flags UPDATE and DELETE without WHERE as critical", () => {
    const r = analyzeSql("UPDATE dbo.Customer SET Status = 'x'\nDELETE FROM dbo.Orders");
    expect(r.findings.filter((f) => f.severity === "critical").map((f) => f.title)).toEqual([
      "UPDATE without WHERE",
      "DELETE without WHERE",
    ]);
    expect(r.overallRisk).toBe("critical");
  });

  it("does not flag statements with a WHERE clause", () => {
    const r = analyzeSql("BEGIN TRAN; UPDATE dbo.T SET a = 1 WHERE id = 5; DELETE FROM dbo.T WHERE id = 6; COMMIT;");
    expect(r.findings.map((f) => f.title)).toEqual([]);
    expect(r.statements.map((s) => s.kind)).toEqual(["transaction", "update", "delete", "transaction"]);
  });

  it("recognises 1=1 only WHERE clauses", () => {
    expect(titles("DELETE FROM dbo.T WHERE 1 = 1")).toContain("DELETE with always-true WHERE (1 = 1)");
    expect(titles("DELETE FROM dbo.T WHERE 1 = 1 AND id = 3")).not.toContain("DELETE with always-true WHERE (1 = 1)");
  });

  it("downgrades unfiltered writes to temp tables", () => {
    const r = analyzeSql("DELETE FROM #work");
    expect(r.findings[0]?.severity).toBe("low");
  });

  it("extracts tables, aliases and columns for UPDATE ... FROM", () => {
    const r = analyzeSql(
      "UPDATE o SET o.Total = 0, Status = 'x' FROM dbo.Orders o INNER JOIN dbo.Customer c ON c.Id = o.CustomerId WHERE c.Id = 1",
    );
    const tables = Object.fromEntries(r.tablesAffected.map((t) => [t.fullName, t]));
    expect(tables["dbo.Orders"]?.operations).toContain("update");
    expect(tables["dbo.Orders"]?.columns).toEqual(["Total", "Status"]);
    expect(tables["dbo.Customer"]?.readOnly).toBe(true);
  });

  it("handles INSERT ... SELECT, SELECT INTO and EXEC", () => {
    const r = analyzeSql(
      "INSERT INTO dbo.Archive (Id, Name) SELECT Id, Name FROM dbo.Live WHERE Id > 5\nSELECT Id INTO #t FROM dbo.Live\nEXEC dbo.DoWork @a = 1",
    );
    expect(r.statements.map((s) => s.kind)).toEqual(["insert", "select", "exec"]);
    expect(r.tablesAffected.map((t) => t.fullName).sort()).toEqual(["#t", "dbo.Archive", "dbo.Live"]);
    expect(r.routinesCalled).toEqual(["dbo.DoWork"]);
  });

  it("ignores CTE names as tables", () => {
    const r = analyzeSql("WITH x AS (SELECT Id FROM dbo.A), y AS (SELECT Id FROM x) SELECT * FROM y JOIN dbo.B ON 1=1");
    expect(r.tablesAffected.map((t) => t.fullName).sort()).toEqual(["dbo.A", "dbo.B"]);
  });

  it("detects DROP TABLE, TRUNCATE and DROP COLUMN", () => {
    const r = analyzeSql("DROP TABLE IF EXISTS dbo.Old; TRUNCATE TABLE dbo.Stage; ALTER TABLE dbo.T DROP COLUMN Legacy;");
    expect(r.findings.map((f) => f.title)).toEqual(
      expect.arrayContaining(["DROP TABLE", "TRUNCATE TABLE", "ALTER TABLE ... DROP COLUMN"]),
    );
    expect(r.statements.map((s) => s.kind)).toEqual(["drop", "truncate", "alter"]);
  });

  it("flags NULL comparisons but not assignments", () => {
    expect(titles("SELECT a FROM t WHERE b = NULL")).toContain("Comparison with NULL using = / <>");
    expect(titles("UPDATE t SET b = NULL WHERE id = 1")).not.toContain("Comparison with NULL using = / <>");
    expect(titles("DECLARE @a int; SET @a = NULL;")).not.toContain("Comparison with NULL using = / <>");
  });

  it("flags SELECT * but not COUNT(*) or EXISTS (SELECT *)", () => {
    expect(titles("SELECT * FROM t")).toContain("SELECT * usage");
    expect(titles("SELECT a.* FROM t a")).toContain("SELECT * usage");
    expect(titles("SELECT COUNT(*) FROM t")).not.toContain("SELECT * usage");
    expect(titles("IF EXISTS (SELECT * FROM t) PRINT 1")).not.toContain("SELECT * usage");
  });

  it("flags cross joins, nolock and leading wildcard", () => {
    const t = titles("SELECT a FROM x CROSS JOIN y WITH (NOLOCK) WHERE a LIKE '%abc'");
    expect(t).toEqual(expect.arrayContaining(["CROSS JOIN", "NOLOCK / READUNCOMMITTED hint", "LIKE with leading wildcard"]));
  });

  it("detects dynamic SQL built by concatenation as high risk", () => {
    const r = analyzeSql("DECLARE @n nvarchar(50) = 'x'; DECLARE @s nvarchar(max) = 'SELECT * FROM t WHERE n = ''' + @n + ''''; EXEC(@s);");
    const f = r.findings.find((x) => x.title.startsWith("Dynamic SQL built"));
    expect(f?.severity).toBe("high");
    expect(r.limitations.join(" ")).toMatch(/dynamic SQL/);
  });

  it("treats QUOTENAME-protected dynamic SQL as medium", () => {
    const r = analyzeSql("DECLARE @s nvarchar(max); SET @s = 'SELECT 1 FROM ' + QUOTENAME(@t); EXEC('SELECT 1 FROM ' + QUOTENAME(@t) + @s);");
    expect(r.findings.find((x) => x.title.startsWith("Dynamic SQL built"))?.severity).toBe("medium");
  });

  it("reports sp_executesql with parameters as informational", () => {
    const r = analyzeSql("EXEC sp_executesql N'SELECT 1 WHERE 1 = @p', N'@p int', @p = 1");
    expect(r.findings.find((x) => x.title.includes("sp_executesql"))?.severity).toBe("informational");
  });

  it("suggests a transaction for multiple writes", () => {
    const r = analyzeSql("INSERT INTO a (x) VALUES (1); INSERT INTO b (x) VALUES (2);");
    expect(r.findings.find((f) => f.title === "No explicit transaction handling")?.severity).toBe("medium");
  });

  it("produces a preview query for simple deletes", () => {
    const r = analyzeSql("DELETE FROM dbo.T WHERE Id = 4;");
    expect(r.statements[0]?.previewSql).toBe("SELECT COUNT(*) AS affected_rows FROM dbo.T WHERE Id = 4;");
  });

  it("analyses stored procedure bodies and nested statements", () => {
    const sql = `CREATE PROCEDURE dbo.Archive @days int AS
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
    BEGIN TRANSACTION;
    INSERT INTO dbo.OrderArchive (Id) SELECT Id FROM dbo.Orders WHERE Created < @days;
    DELETE FROM dbo.Orders;
    COMMIT;
  END TRY
  BEGIN CATCH
    ROLLBACK;
  END CATCH
END
GO
EXEC dbo.Archive 30`;
    const r = analyzeSql(sql);
    expect(r.batchCount).toBe(2);
    const proc = r.statements[0]!;
    expect(proc.kind).toBe("create");
    expect(proc.objectType).toBe("procedure");
    expect(proc.children.map((c) => c.kind)).toContain("delete");
    expect(r.findings.some((f) => f.title === "DELETE without WHERE" && f.severity === "critical")).toBe(true);
    expect(r.routinesCalled).toContain("dbo.Archive");
    expect(r.tablesAffected.find((t) => t.fullName === "dbo.OrderArchive")?.operations).toContain("insert");
  });

  it("handles IF/ELSE without semicolons and CASE...END", () => {
    const r = analyzeSql("IF @a = 1 UPDATE t SET x = CASE WHEN y = 1 THEN 1 ELSE 0 END WHERE id = 1 ELSE DELETE FROM t WHERE id = 2");
    expect(r.statements.map((s) => s.kind)).toEqual(["control", "update", "control", "delete"]);
  });

  it("copes with empty input", () => {
    const r = analyzeSql("   \n-- nothing here\n");
    expect(r.statements).toHaveLength(0);
    expect(r.overallRisk).toBe("informational");
  });

  it("detects classic injection payload literals", () => {
    expect(titles("SELECT 1 WHERE name = '' OR '1'='1'")).toContain("Always-true OR condition (injection pattern)");
    expect(titles("SELECT 1 WHERE a = 'x; DROP TABLE t'")).toContain("SQL injection signature in a string literal");
  });
});
