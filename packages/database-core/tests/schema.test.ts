import { describe, expect, it } from "vitest";
import {
  diffSchemas,
  generateMigration,
  type SchemaSnapshot,
  type SnapColumn,
  type SnapObject,
} from "../src";

let seq = 0;
const col = (name: string, dataType: string, extra: Partial<SnapColumn> = {}): SnapColumn => ({
  name, ordinal: ++seq, dataType, maxLength: null, precision: null, scale: null, nullable: true,
  defaultValue: null, identity: false, primaryKey: false, computed: false, computedExpression: null, ...extra,
});
const table = (schema: string, name: string, columns: SnapColumn[]): SnapObject => ({
  id: `${schema}.${name}`, schema, name, type: "table", definition: null, metadata: {}, columns,
});
const proc = (name: string, definition: string): SnapObject => ({
  id: `p.${name}`, schema: "dbo", name, type: "procedure", definition, metadata: {}, columns: [],
});
const snap = (objects: SnapObject[], extra: Partial<SchemaSnapshot> = {}): SchemaSnapshot => ({
  objects, relationships: [], indexes: [], constraints: [], ...extra,
});

const customerV1 = () =>
  table("dbo", "Customer", [
    col("Id", "int", { primaryKey: true, nullable: false, identity: true }),
    col("Name", "nvarchar", { maxLength: 100, nullable: false }),
    col("Legacy", "varchar", { maxLength: 10 }),
  ]);

describe("diffSchemas", () => {
  it("detects added / removed / modified columns and types", () => {
    const base = snap([customerV1()]);
    const target = snap([
      table("dbo", "Customer", [
        col("Id", "int", { primaryKey: true, nullable: false, identity: true }),
        col("Name", "nvarchar", { maxLength: 50, nullable: false }),
        col("Email", "nvarchar", { maxLength: 200 }),
      ]),
    ]);
    const d = diffSchemas(base, target);
    const byName = Object.fromEntries(d.items.filter((i) => i.category === "column").map((i) => [i.name, i]));
    expect(byName.Email?.status).toBe("added");
    expect(byName.Legacy?.status).toBe("removed");
    expect(byName.Legacy?.destructive).toBe(true);
    expect(byName.Name?.status).toBe("modified");
    expect(byName.Name?.changes[0]).toBe("Data type: nvarchar(100) → nvarchar(50)");
    expect(byName.Name?.destructive).toBe(true);
    expect(d.items.find((i) => i.category === "table")?.status).toBe("modified");
    expect(d.summary.column).toMatchObject({ added: 1, removed: 1, modified: 1, unchanged: 1 });
  });

  it("reports unchanged schemas as unchanged (case-insensitive names)", () => {
    const d = diffSchemas(snap([customerV1()]), snap([{ ...customerV1(), id: "x", name: "CUSTOMER" }]));
    expect(d.totals).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(d.summary.table.unchanged).toBe(1);
  });

  it("detects added and removed tables and added schema", () => {
    const d = diffSchemas(
      snap([customerV1()]),
      snap([table("sales", "Order", [col("Id", "int", { primaryKey: true, nullable: false })])]),
    );
    expect(d.summary.table).toMatchObject({ added: 1, removed: 1 });
    expect(d.items.find((i) => i.category === "schema")?.status).toBe("added");
    expect(d.items.find((i) => i.category === "table" && i.status === "removed")?.destructive).toBe(true);
  });

  it("ignores formatting/comment-only changes in stored procedures but catches real ones", () => {
    const a = snap([proc("Get", "CREATE PROCEDURE dbo.Get AS SELECT 1 -- old")]);
    const same = snap([proc("Get", "create procedure [dbo].[Get]\nas\n  select 1")]);
    const changed = snap([{ ...proc("Get", "CREATE PROCEDURE dbo.Get @x int AS SELECT 2"), metadata: { parameters: [{ name: "@x", dataType: "int", direction: "in" }] } }]);
    expect(diffSchemas(a, same).totals.modified).toBe(0);
    const d = diffSchemas(a, changed);
    expect(d.items[0]).toMatchObject({ category: "procedure", status: "modified" });
    expect(d.items[0]?.riskNotes.join(" ")).toMatch(/signature/);
  });

  it("compares foreign keys, indexes and constraints", () => {
    const parent = table("dbo", "Parent", [col("Id", "int", { primaryKey: true, nullable: false })]);
    const child = table("dbo", "Child", [col("Id", "int", { primaryKey: true, nullable: false }), col("ParentId", "int")]);
    const base = snap([parent, child]);
    const target = snap([parent, child], {
      relationships: [{ id: "f", name: "FK_Child_Parent", kind: "declared", sourceObjectId: child.id, targetObjectId: parent.id, targetSchema: "dbo", targetName: "Parent", sourceColumns: ["ParentId"], targetColumns: ["Id"], onDelete: "CASCADE", onUpdate: null }],
      indexes: [{ id: "i", objectId: child.id, name: "IX_Child_ParentId", indexType: "NONCLUSTERED", isUnique: false, isPrimaryKey: false, isUniqueConstraint: false, keyColumns: [{ name: "ParentId" }], includedColumns: [], filterDefinition: null }],
    });
    const d = diffSchemas(base, target);
    expect(d.summary.foreign_key.added).toBe(1);
    expect(d.summary.index.added).toBe(1);
    // inferred relationships are not schema and must never be compared
    const inferred = snap([parent, child], { relationships: [{ ...target.relationships[0]!, kind: "inferred" }] });
    expect(diffSchemas(base, inferred).summary.foreign_key.added).toBe(0);
  });
});

describe("generateMigration", () => {
  const base = snap([customerV1()]);
  const target = snap([
    table("dbo", "Customer", [
      col("Id", "int", { primaryKey: true, nullable: false, identity: true }),
      col("Name", "nvarchar", { maxLength: 50, nullable: false }),
      col("Email", "nvarchar", { maxLength: 200, nullable: false }),
    ]),
    table("audit", "Log", [col("Id", "bigint", { primaryKey: true, nullable: false }), col("Msg", "nvarchar", { maxLength: -1 })]),
  ]);

  it("generates ordered, human-review-labelled SQL with destructive statements commented out", () => {
    const plan = generateMigration(base, target);
    const sql = plan.migrationSql;
    expect(sql).toContain("REQUIRES HUMAN REVIEW");
    expect(sql).toContain("EXEC(N'CREATE SCHEMA [audit]');");
    expect(sql).toContain("CREATE TABLE [audit].[Log] (");
    expect(sql).toContain("[Msg] nvarchar(max) NULL");
    expect(sql).toContain("ALTER TABLE [dbo].[Customer] ADD [Email] nvarchar(200) NOT NULL;");
    expect(sql).toContain("ALTER TABLE [dbo].[Customer] ALTER COLUMN [Name] nvarchar(50) NOT NULL;");
    expect(sql).toContain("-- ALTER TABLE [dbo].[Customer] DROP COLUMN [Legacy];");
    expect(sql).not.toMatch(/^ALTER TABLE \[dbo\]\.\[Customer\] DROP COLUMN/m);
    expect(plan.destructiveCount).toBeGreaterThan(0);
    expect(plan.risks.some((r) => r.includes("DATA LOSS"))).toBe(true);
    expect(sql.indexOf("CREATE SCHEMA")).toBeLessThan(sql.indexOf("CREATE TABLE"));
    expect(plan.requiresHumanReview).toBe(true);
  });

  it("can include destructive statements explicitly", () => {
    const sql = generateMigration(base, target, { destructive: "include" }).migrationSql;
    expect(sql).toMatch(/^ALTER TABLE \[dbo\]\.\[Customer\] DROP COLUMN \[Legacy\];/m);
  });

  it("produces validation queries and a rollback that is labelled as non-restoring", () => {
    const plan = generateMigration(base, target);
    expect(plan.preValidationSql).toContain("LEN([Name]) > 50");
    expect(plan.preValidationSql).toContain("[Legacy] IS NOT NULL");
    expect(plan.postValidationSql).toContain("OBJECT_ID(N'audit.Log'");
    expect(plan.rollbackSql).toContain("does NOT restore data");
    expect(plan.rollbackConsiderations.join(" ")).toMatch(/Legacy/);
    expect(plan.checklist.length).toBeGreaterThan(5);
  });

  it("emits CREATE OR ALTER for modified procedures", () => {
    const a = snap([proc("P", "CREATE PROCEDURE dbo.P AS SELECT 1")]);
    const b = snap([proc("P", "CREATE PROCEDURE dbo.P AS SELECT 2")]);
    expect(generateMigration(a, b).migrationSql).toContain("CREATE OR ALTER PROCEDURE dbo.P AS SELECT 2");
  });

  it("reports nothing to do for identical schemas", () => {
    const plan = generateMigration(base, base);
    expect(plan.steps).toHaveLength(0);
    expect(plan.migrationSql).toContain("nothing to migrate");
    expect(plan.rollbackSql).toBe("");
  });

  it("adds foreign keys after the tables and columns they need", () => {
    const parent = table("dbo", "Parent", [col("Id", "int", { primaryKey: true, nullable: false })]);
    const child = table("dbo", "Child", [col("Id", "int", { primaryKey: true, nullable: false }), col("ParentId", "int")]);
    const b = snap([parent]);
    const t = snap([parent, child], {
      relationships: [{ id: "f", name: "FK_Child_Parent", kind: "declared", sourceObjectId: child.id, targetObjectId: parent.id, targetSchema: "dbo", targetName: "Parent", sourceColumns: ["ParentId"], targetColumns: ["Id"], onDelete: "CASCADE", onUpdate: null }],
    });
    const sql = generateMigration(b, t).migrationSql;
    expect(sql.indexOf("CREATE TABLE [dbo].[Child]")).toBeLessThan(sql.indexOf("FOREIGN KEY"));
    expect(sql).toContain("ALTER TABLE [dbo].[Child] WITH CHECK ADD CONSTRAINT [FK_Child_Parent] FOREIGN KEY ([ParentId]) REFERENCES [dbo].[Parent] ([Id]) ON DELETE CASCADE;");
  });
});
