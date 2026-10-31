import type { Metadata } from "next";
import { DbHeader } from "@/components/database/db-header";
import { IndexExplorer, type ConstraintItem, type IndexItem } from "@/components/database/index-explorer";
import { RequireVersion } from "@/components/database/require-version";
import { fetchAll, getObjectList, getProjectContext } from "@/lib/data/queries";
import type { ConstraintRow, IndexRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Indexes & constraints" };

export default async function IndexesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title="Indexes & constraints" /><RequireVersion ctx={ctx} /></>);
  const supabase = await createClient();
  const vid = ctx.version.id;
  const [tables, idx, cons] = await Promise.all([
    getObjectList(vid, "table"),
    fetchAll<IndexRow & { object_id: string }>((f, t) => supabase.from("database_indexes").select("*").eq("version_id", vid).order("id").range(f, t) as never),
    fetchAll<ConstraintRow>((f, t) => supabase.from("database_constraints").select("*").eq("version_id", vid).order("id").range(f, t) as never),
  ]);
  const tn = new Map(tables.map((t) => [t.id, t.schema_name ? `${t.schema_name}.${t.name}` : t.name]));
  const indexes: IndexItem[] = idx.map((i) => ({
    id: i.id, tableId: i.object_id, table: tn.get(i.object_id) ?? "?", name: i.name, type: i.index_type,
    keys: i.key_columns.map((c) => `${c.name}${c.descending ? " DESC" : ""}`).join(", "), included: i.included_columns.join(", "),
    flags: [i.is_primary_key && "PK", i.is_unique_constraint && "UNIQUE constraint", i.is_unique && !i.is_primary_key && !i.is_unique_constraint && "unique"].filter(Boolean) as string[], filter: i.filter_definition,
  }));
  const constraints: ConstraintItem[] = cons.map((c) => ({ id: c.id, tableId: c.object_id, table: tn.get(c.object_id) ?? "?", name: c.name, type: c.constraint_type, detail: c.expression ?? `(${c.columns.join(", ")})` }));
  return (
    <>
      <DbHeader ctx={ctx} title="Indexes & constraints" description="Every index and primary key / unique / check / default constraint in this schema version. Foreign keys are shown in the table and ER views." />
      <IndexExplorer indexes={indexes} constraints={constraints} />
    </>
  );
}
