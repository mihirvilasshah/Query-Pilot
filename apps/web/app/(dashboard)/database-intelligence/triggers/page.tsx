import type { Metadata } from "next";
import { DbHeader } from "@/components/database/db-header";
import { RequireVersion } from "@/components/database/require-version";
import { TriggerList, type TriggerItem } from "@/components/database/trigger-list";
import { fetchAll, getProjectContext } from "@/lib/data/queries";
import type { DependencyRow, ObjectRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Triggers" };

export default async function TriggersPage({ searchParams }: { searchParams: Promise<{ v?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title="Trigger explorer" /><RequireVersion ctx={ctx} /></>);
  const supabase = await createClient();
  const triggers = await fetchAll<ObjectRow>((f, t) => supabase.from("database_objects").select("*").eq("version_id", ctx.version!.id).eq("object_type", "trigger").order("name").range(f, t) as never);
  const ids = triggers.map((t) => t.id);
  const deps = ids.length ? await fetchAll<DependencyRow>((f, t) => supabase.from("database_dependencies").select("*").in("source_object_id", ids).range(f, t) as never) : [];
  const targetIds = [...new Set(deps.map((d) => d.target_object_id).filter((x): x is string => !!x))];
  const names = new Map<string, { id: string; schema: string; name: string }>();
  if (targetIds.length) {
    const { data } = await supabase.from("database_objects").select("id,schema_name,name").in("id", targetIds);
    for (const o of data ?? []) names.set(o.id, { id: o.id, schema: o.schema_name, name: o.name });
  }
  const items: TriggerItem[] = triggers.map((t) => {
    const md = t.metadata as { triggerEvents?: string[]; triggerTiming?: string | null; triggerParent?: { schema: string; name: string } | null };
    const mine = deps.filter((d) => d.source_object_id === t.id);
    const parentDep = mine.find((d) => d.kind === "trigger_on");
    const parentObj = parentDep?.target_object_id ? names.get(parentDep.target_object_id) : undefined;
    const parentLabel = parentObj ? `${parentObj.schema}.${parentObj.name}` : md.triggerParent ? `${md.triggerParent.schema}.${md.triggerParent.name}` : null;
    return {
      id: t.id, schema: t.schema_name, name: t.name, parent: parentLabel ? { id: parentObj?.id ?? null, label: parentLabel } : null,
      events: md.triggerEvents ?? [], timing: md.triggerTiming ?? null, definition: t.definition, operations: [],
      dependencies: mine.filter((d) => d.kind !== "trigger_on").map((d) => ({ kind: d.kind, label: d.target_object_id ? (names.get(d.target_object_id) ? `${names.get(d.target_object_id)!.schema}.${names.get(d.target_object_id)!.name}` : "?") : [d.target_schema, d.target_name].filter(Boolean).join(".") || "(dynamic)" })),
    };
  });
  return (
    <>
      <DbHeader ctx={ctx} title="Trigger explorer" description="Triggers with their parent table, events, definition and dependencies." />
      <TriggerList items={items} initialQuery={sp.q} />
    </>
  );
}
