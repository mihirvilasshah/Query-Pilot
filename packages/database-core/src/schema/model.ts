import type { DatabaseObjectType, DependencyConfidence, DependencyKind, ObjectMetadata, RelationshipKind } from "@querypilot/shared-types";

/**
 * Plain-data snapshot of one imported schema version. Both the schema comparison engine and the
 * migration generator work on snapshots, so they stay pure functions that are trivial to test.
 *
 * `maxLength` is the *declared* length in characters/bytes as written in the type (nvarchar(50) -> 50),
 * -1 means MAX. It is never derived from sys.columns byte lengths.
 */
export interface SnapColumn {
  name: string;
  ordinal: number;
  dataType: string;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  nullable: boolean | null;
  defaultValue: string | null;
  identity: boolean;
  primaryKey: boolean;
  computed: boolean;
  computedExpression: string | null;
}

export interface SnapObject {
  id: string;
  schema: string;
  name: string;
  type: DatabaseObjectType;
  definition: string | null;
  metadata: ObjectMetadata;
  columns: SnapColumn[];
}

export interface SnapRelationship {
  id: string;
  name: string | null;
  kind: RelationshipKind;
  sourceObjectId: string;
  targetObjectId: string | null;
  targetSchema: string | null;
  targetName: string | null;
  sourceColumns: string[];
  targetColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

export interface SnapIndex {
  id: string;
  objectId: string;
  name: string;
  indexType: string | null;
  isUnique: boolean;
  isPrimaryKey: boolean;
  isUniqueConstraint: boolean;
  keyColumns: { name: string; descending?: boolean }[];
  includedColumns: string[];
  filterDefinition: string | null;
}

export interface SnapConstraint {
  id: string;
  objectId: string;
  name: string | null;
  type: "primary_key" | "unique" | "check" | "default";
  columns: string[];
  expression: string | null;
}

export interface SnapDependency {
  id: string;
  sourceObjectId: string;
  targetObjectId: string | null;
  targetSchema: string | null;
  targetName: string | null;
  targetType: string | null;
  kind: DependencyKind;
  operations: string[];
  confidence: DependencyConfidence;
  origin: string;
  line: number | null;
  note: string | null;
}

export interface SchemaSnapshot {
  objects: SnapObject[];
  relationships: SnapRelationship[];
  indexes: SnapIndex[];
  constraints: SnapConstraint[];
  dependencies?: SnapDependency[];
}

export const objectFullName = (o: { schema: string; name: string }): string => (o.schema ? `${o.schema}.${o.name}` : o.name);

export const quoteIdent = (s: string): string => `[${s.replace(/]/g, "]]")}]`;

export const quoteName = (o: { schema: string; name: string }): string =>
  o.schema ? `${quoteIdent(o.schema)}.${quoteIdent(o.name)}` : quoteIdent(o.name);

/** Renders a column's data type exactly as it would be written in a T-SQL declaration. */
export function formatDataType(c: Pick<SnapColumn, "dataType" | "maxLength" | "precision" | "scale">): string {
  const t = c.dataType.toLowerCase();
  const lengthTypes = ["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"];
  if (lengthTypes.includes(t)) {
    if (c.maxLength === -1) return `${t}(max)`;
    if (c.maxLength != null) return `${t}(${c.maxLength})`;
    return t;
  }
  if (["decimal", "numeric"].includes(t) && c.precision != null) return `${t}(${c.precision},${c.scale ?? 0})`;
  if (["datetime2", "datetimeoffset", "time"].includes(t) && c.scale != null) return `${t}(${c.scale})`;
  if (["float"].includes(t) && c.precision != null && c.precision !== 53) return `${t}(${c.precision})`;
  return t;
}
