import { Layers, Table2, Workflow, SquareFunction, type LucideIcon } from "lucide-react";
import { DbHeader } from "@/components/database/db-header";
import { ObjectExplorer, type ExplorerItem } from "@/components/database/object-explorer";
import { RequireVersion } from "@/components/database/require-version";
import { getExplorerStats } from "@/lib/data/explorer-stats";
import { getObjectList, getProjectContext } from "@/lib/data/queries";
import type { ObjectRow } from "@/lib/data/types";

type Kind = "table" | "view" | "procedure" | "function";

const CONFIG: Record<Kind, { title: string; description: string; icon: LucideIcon; route: string }> = {
  table: { title: "Table explorer", description: "Browse tables, columns, keys and relationships.", icon: Table2, route: "tables" },
  view: { title: "View explorer", description: "Browse views with their definitions and referenced objects.", icon: Layers, route: "views" },
  procedure: { title: "Stored procedure explorer", description: "Inspect parameters, referenced objects, operations and dynamic SQL.", icon: Workflow, route: "procedures" },
  function: { title: "Function explorer", description: "Scalar and table-valued functions with parameters and references.", icon: SquareFunction, route: "functions" },
};

export async function ExplorerPage({ kind, searchParams }: { kind: Kind; searchParams: { v?: string; q?: string } }) {
  const cfg = CONFIG[kind];
  const ctx = await getProjectContext(searchParams.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title={cfg.title} /><RequireVersion ctx={ctx} /></>);
  const [objects, stats] = await Promise.all([getObjectList(ctx.version.id, kind), getExplorerStats(ctx.version.id)]);
  const vq = `?v=${ctx.version.id}`;

  const items: ExplorerItem[] = objects.map((o: ObjectRow) => {
    const base = { id: o.id, schema: o.schema_name, name: o.name, href: `/database-intelligence/${cfg.route}/${o.id}${vq}` };
    const md = o.metadata as { parameters?: unknown[]; hasDynamicSql?: boolean; functionType?: string; hasTransaction?: boolean };
    if (kind === "table") {
      const cols = stats.columns.get(o.id) ?? 0;
      const fk = stats.fkOut.get(o.id) ?? 0;
      const ref = stats.fkIn.get(o.id) ?? 0;
      const badges: ExplorerItem["badges"] = [];
      if (fk) badges.push({ label: `${fk} FK`, variant: "secondary" });
      if (ref) badges.push({ label: `${ref} referenced`, variant: "outline" });
      return { ...base, meta: `${cols} columns`, badges };
    }
    const d = stats.depsOut.get(o.id);
    const badges: ExplorerItem["badges"] = [];
    if (d?.writes) badges.push({ label: `writes ${d.writes}`, variant: "danger" });
    if (d?.reads) badges.push({ label: `reads ${d.reads}`, variant: "info" });
    if (kind === "procedure" && md.hasTransaction) badges.push({ label: "transaction", variant: "secondary" });
    if (kind === "function" && md.functionType) badges.push({ label: md.functionType.replaceAll("_", " "), variant: "secondary" });
    const params = md.parameters?.length ?? 0;
    return { ...base, dynamic: !!md.hasDynamicSql, badges, meta: kind === "view" ? `${d?.total ?? 0} references` : `${params} parameter${params === 1 ? "" : "s"}` };
  });

  return (
    <>
      <DbHeader ctx={ctx} title={cfg.title} description={cfg.description} />
      <ObjectExplorer items={items} kind={kind} noun={kind === "procedure" ? "procedure" : kind} initialQuery={searchParams.q} sortOptions={[{ value: "name", label: "Sort by name" }, { value: "meta", label: kind === "table" ? "Most columns" : "Most items" }]} />
    </>
  );
}
