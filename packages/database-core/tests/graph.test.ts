import { describe, expect, it } from "vitest";
import {
  analyzeColumnImpact,
  buildDependencyGraph,
  generateDocumentation,
  neighborhood,
  procedureFlowchart,
  retrieveContext,
  type SchemaSnapshot,
  type SnapColumn,
  type SnapObject,
} from "../src";

const col = (name: string, dataType: string, ordinal: number, extra: Partial<SnapColumn> = {}): SnapColumn => ({
  name, ordinal, dataType, maxLength: null, precision: null, scale: null, nullable: true, defaultValue: null,
  identity: false, primaryKey: false, computed: false, computedExpression: null, ...extra,
});
const t = (name: string, columns: SnapColumn[]): SnapObject => ({ id: `t-${name}`, schema: "dbo", name, type: "table", definition: null, metadata: {}, columns });
const p = (name: string, definition: string, metadata = {}): SnapObject => ({ id: `p-${name}`, schema: "dbo", name, type: "procedure", definition, metadata, columns: [] });

const pricing = t("PricingLevel", [col("PricingLevelId", "int", 1, { primaryKey: true, nullable: false }), col("OperationalUnitId", "int", 2), col("Markup", "decimal", 3, { precision: 9, scale: 2 })]);
const ou = t("OperationalUnit", [col("OperationalUnitId", "int", 1, { primaryKey: true, nullable: false })]);
const setting = t("PricingLevelOUSetting", [col("Id", "int", 1, { primaryKey: true, nullable: false })]);
const updatePricing = p("UpdatePricing", "CREATE PROCEDURE dbo.UpdatePricing @id int AS BEGIN UPDATE dbo.PricingLevel SET Markup = 1 WHERE PricingLevelId = @id; SELECT * FROM dbo.PricingLevelOUSetting; EXEC('x ' + @id); END", { hasDynamicSql: true });

const snap: SchemaSnapshot = {
  objects: [pricing, ou, setting, updatePricing],
  relationships: [
    { id: "r1", name: "FK_Pricing_OU", kind: "declared", sourceObjectId: pricing.id, targetObjectId: ou.id, targetSchema: "dbo", targetName: "OperationalUnit", sourceColumns: ["OperationalUnitId"], targetColumns: ["OperationalUnitId"], onDelete: null, onUpdate: null },
  ],
  indexes: [{ id: "i1", objectId: pricing.id, name: "IX_Pricing_OU", indexType: "NONCLUSTERED", isUnique: false, isPrimaryKey: false, isUniqueConstraint: false, keyColumns: [{ name: "OperationalUnitId" }], includedColumns: [], filterDefinition: null }],
  constraints: [],
  dependencies: [
    { id: "d1", sourceObjectId: updatePricing.id, targetObjectId: pricing.id, targetSchema: "dbo", targetName: "PricingLevel", targetType: "table", kind: "writes", operations: ["update"], confidence: "confirmed_static", origin: "dacfx", line: 1, note: null },
    { id: "d2", sourceObjectId: updatePricing.id, targetObjectId: setting.id, targetSchema: "dbo", targetName: "PricingLevelOUSetting", targetType: "table", kind: "reads", operations: ["select"], confidence: "parsed_reference", origin: "scriptdom", line: 1, note: null },
    { id: "d3", sourceObjectId: updatePricing.id, targetObjectId: null, targetSchema: null, targetName: null, targetType: null, kind: "executes", operations: [], confidence: "unresolved_dynamic", origin: "scriptdom", line: 1, note: "EXEC with string" },
  ],
};

describe("dependency graph", () => {
  it("builds edges, FK edges and tracks unresolved dynamic references", () => {
    const g = buildDependencyGraph(snap);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges.map((e) => e.kind).sort()).toEqual(["foreign_key", "reads", "writes"]);
    expect(g.unresolved).toHaveLength(1);
    expect(g.completenessCaveat).toMatch(/not guaranteed to be complete/);
  });

  it("walks incoming and outgoing neighbourhoods", () => {
    const g = buildDependencyGraph(snap);
    expect(neighborhood(g, ou.id, "incoming", 1).nodeIds.has(pricing.id)).toBe(true);
    expect(neighborhood(g, ou.id, "incoming", 2).nodeIds.has(updatePricing.id)).toBe(true);
    expect(neighborhood(g, ou.id, "outgoing", 3).nodeIds.size).toBe(1);
  });
});

describe("column impact", () => {
  it("lists FKs, indexes and textual references", () => {
    const impact = analyzeColumnImpact(snap, pricing.id, "Markup")!;
    expect(impact.likelyReferences.map((r) => r.fullName)).toEqual(["dbo.UpdatePricing"]);
    const ouImpact = analyzeColumnImpact(snap, ou.id, "OperationalUnitId")!;
    expect(ouImpact.foreignKeys[0]).toMatchObject({ role: "references this column", table: "dbo.PricingLevel" });
    const fkCol = analyzeColumnImpact(snap, pricing.id, "OperationalUnitId")!;
    expect(fkCol.indexes).toEqual(["IX_Pricing_OU"]);
    expect(fkCol.tableOnlyReferences).toHaveLength(1);
  });
});

describe("retrieval", () => {
  it("selects objects named in the question and expands through dependencies", () => {
    const r = retrieveContext(snap, "Which procedures modify the PricingLevel table?");
    expect(r.objects[0]?.fullName).toBe("dbo.PricingLevel");
    expect(r.objects.map((o) => o.fullName)).toContain("dbo.UpdatePricing");
    expect(r.contextText).toContain("Contains dynamic SQL");
    expect(r.contextText).toContain("[writes: update; confirmed_static]");
  });

  it("falls back to connected objects for broad questions and respects the size budget", () => {
    const r = retrieveContext(snap, "Explain the complete architecture", { maxChars: 600 });
    expect(r.objects.length).toBeGreaterThan(0);
    expect(r.contextText.length).toBeLessThan(900);
  });

  it("always includes the focused object", () => {
    const r = retrieveContext(snap, "what is this?", { focusObjectIds: [ou.id] });
    expect(r.objects[0]?.id).toBe(ou.id);
  });
});

describe("documentation + flowchart", () => {
  it("generates deterministic markdown", () => {
    const md = generateDocumentation({ projectName: "Hospital", platform: "SQL Server", versionLabel: "v1", snapshot: snap });
    expect(md).toContain("# Hospital - Database Documentation");
    expect(md).toContain("| 2 | OperationalUnitId | int | yes |");
    expect(md).toContain("FK_Pricing_OU");
    expect(md).toContain("Contains dynamic SQL");
  });

  it("builds a mermaid flowchart from the procedure body", () => {
    const f = procedureFlowchart(updatePricing);
    expect(f.startsWith("flowchart TD")).toBe(true);
    expect(f).toContain("UPDATE dbo.PricingLevel");
    expect(f).toContain("EXEC dynamic SQL");
  });
});
