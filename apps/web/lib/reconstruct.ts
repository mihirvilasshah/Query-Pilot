import type { ColumnRow } from "@/lib/data/types";
import { formatColumnType } from "@/lib/format";

/**
 * Best-effort CREATE TABLE built from stored column metadata. It is NOT the original definition and is
 * always labelled as reconstructed in the UI; used only when the importer captured no original text.
 */
export function reconstructCreateTable(schema: string, name: string, columns: ColumnRow[]): string {
  const q = (s: string) => `[${s.replace(/]/g, "]]")}]`;
  const body = columns.map((c) => {
    if (c.is_computed && c.computed_expression) return `  ${q(c.name)} AS ${c.computed_expression}`;
    return `  ${q(c.name)} ${formatColumnType(c)}${c.is_identity ? " IDENTITY" : ""}${c.is_nullable === false ? " NOT NULL" : c.is_nullable ? " NULL" : ""}${c.default_value ? ` DEFAULT ${c.default_value}` : ""}`;
  });
  const pk = columns.filter((c) => c.is_primary_key).map((c) => q(c.name));
  if (pk.length) body.push(`  PRIMARY KEY (${pk.join(", ")})`);
  return `CREATE TABLE ${schema ? `${q(schema)}.` : ""}${q(name)} (\n${body.join(",\n")}\n);`;
}
