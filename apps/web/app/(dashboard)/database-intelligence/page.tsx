import { AlertTriangle, BookOpen, Info, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, SectionCard } from "@/components/common/page";
import { DbHeader } from "@/components/database/db-header";
import { ObjectDistributionChart, TopTablesChart } from "@/components/database/overview-charts";
import { RequireVersion } from "@/components/database/require-version";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getObjectList, getProjectContext } from "@/lib/data/queries";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { DATABASE_PLATFORMS } from "@querypilot/shared-types";

export const metadata: Metadata = { title: "Database overview" };

async function count(table: string, versionId: string): Promise<number> {
  const supabase = await createClient();
  const { count: c } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("version_id", versionId);
  return c ?? 0;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  const guard = <RequireVersion ctx={ctx} />;
  if (!ctx.project || !ctx.version) {
    return (<><DbHeader ctx={ctx} title="Database overview" />{guard}</>);
  }
  const { project, version } = ctx;
  const supabase = await createClient();
  const [objects, indexCount, fkCount, columnCount, depCount, colRows] = await Promise.all([
    getObjectList(version.id),
    count("database_indexes", version.id),
    supabase.from("database_relationships").select("id", { count: "exact", head: true }).eq("version_id", version.id).eq("kind", "declared").then((r) => r.count ?? 0),
    count("database_columns", version.id),
    count("database_dependencies", version.id),
    supabase.from("database_columns").select("object_id").eq("version_id", version.id).limit(5000).then((r) => (r.data ?? []) as { object_id: string }[]),
  ]);

  const byType = (t: string) => objects.filter((o) => o.object_type === t);
  const schemas = new Set(objects.map((o) => o.schema_name).filter(Boolean));
  for (const o of byType("schema")) schemas.add(o.name);
  const tables = byType("table");
  const colsPerTable = new Map<string, number>();
  for (const c of colRows) colsPerTable.set(c.object_id, (colsPerTable.get(c.object_id) ?? 0) + 1);
  const topTables = tables.map((t) => ({ name: t.schema_name ? `${t.schema_name}.${t.name}` : t.name, value: colsPerTable.get(t.id) ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 8);
  const dynamicProcs = objects.filter((o) => o.metadata?.hasDynamicSql).length;
  const summary = version.summary;
  const rows: [string, number][] = [
    ["Schemas", schemas.size], ["Tables", tables.length], ["Views", byType("view").length], ["Stored procedures", byType("procedure").length],
    ["Functions", byType("function").length], ["Triggers", byType("trigger").length], ["Indexes", indexCount], ["Foreign keys", fkCount],
  ];
  const warnings = summary.warnings ?? [];

  return (
    <>
      <DbHeader
        ctx={ctx}
        title="Database overview"
        description={`${project.name} · ${DATABASE_PLATFORMS.find((p) => p.value === project.platform)?.label}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><a href={`/api/docs/${version.id}`}><BookOpen className="size-4" /> Documentation</a></Button>
            <Button asChild size="sm"><Link href={`/database-intelligence/assistant?v=${version.id}&q=${encodeURIComponent("Explain the complete database architecture")}`}><Sparkles className="size-4" /> Explain architecture</Link></Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" data-testid="overview-counts">
        {rows.map(([label, n]) => (
          <div key={label} className="surface p-3.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">{n.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Object distribution"><ObjectDistributionChart data={rows.filter(([l]) => !["Schemas", "Indexes", "Foreign keys"].includes(l)).map(([name, value]) => ({ name, value }))} /></SectionCard>
        <SectionCard title="Widest tables" description="By number of columns"><TopTablesChart data={topTables} /></SectionCard>

        <SectionCard title="Import details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Database name</dt><dd>{version.database_name ?? summary.databaseName ?? "—"}</dd>
            <dt className="text-muted-foreground">Platform</dt><dd>{DATABASE_PLATFORMS.find((p) => p.value === project.platform)?.label}</dd>
            <dt className="text-muted-foreground">Schema version</dt><dd><Badge variant="secondary">v{version.version_number}</Badge> {version.label}</dd>
            <dt className="text-muted-foreground">Imported</dt><dd>{formatDate(version.created_at, true)}</dd>
            <dt className="text-muted-foreground">Source</dt><dd className="truncate">{version.source_type.toUpperCase()} · {version.source_file_name}</dd>
            <dt className="text-muted-foreground">Columns / dependencies</dt><dd>{columnCount.toLocaleString()} columns · {depCount.toLocaleString()} dependency links</dd>
          </dl>
        </SectionCard>

        <SectionCard title="Analysis limitations" description="Read before relying on the dependency data">
          <ul className="space-y-2 text-sm">
            {dynamicProcs > 0 && (
              <li className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><span>{dynamicProcs} object(s) contain dynamic SQL; tables referenced inside dynamic strings are <strong>not</strong> resolved.</span></li>
            )}
            {(summary.limitations ?? []).map((l) => <li key={l} className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-info" /><span>{l}</span></li>)}
            {(summary.unsupported ?? []).length > 0 && (
              <li className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-info" /><span>Unsupported object types skipped: {(summary.unsupported ?? []).map((u) => `${u.objectType} (${u.count})`).join(", ")}.</span></li>
            )}
            {dynamicProcs === 0 && (summary.limitations ?? []).length === 0 && <li className="text-muted-foreground">Static analysis cannot see application code or external consumers.</li>}
          </ul>
        </SectionCard>
      </div>

      {warnings.length > 0 && (
        <SectionCard className="mt-6" title={`Import warnings (${warnings.length})`} contentClassName="p-0">
          <ul className="scroll-thin max-h-72 divide-y overflow-y-auto text-sm">
            {warnings.slice(0, 200).map((w, i) => (
              <li key={i} className="flex gap-3 px-4 py-2">
                <code className="shrink-0 font-mono text-xs text-muted-foreground">{w.code}</code>
                <span>{w.message}{w.objectName ? ` — ${w.objectName}` : ""}{w.line ? ` (line ${w.line})` : ""}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {objects.length === 0 && <EmptyState className="mt-6" icon={Info} title="No objects were extracted" description="The import finished but found no database objects." />}
    </>
  );
}
