import { History } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/common/page";
import { HistoryFilters, HistoryList, type HistoryItem } from "@/components/common/history-list";
import { createClient } from "@/lib/supabase/server";
import { OPERATION_LABELS } from "@querypilot/shared-types";

export const metadata: Metadata = { title: "Query History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ op?: string; q?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("query_history").select("id,operation,title,input,output,ref_id,created_at").order("created_at", { ascending: false }).limit(200);
  if (sp.op && sp.op in OPERATION_LABELS) q = q.eq("operation", sp.op);
  if (sp.q) q = q.ilike("title", `%${sp.q.replace(/[\\%_]/g, " ").slice(0, 80)}%`);
  const { data } = await q;
  const items = (data ?? []) as HistoryItem[];
  return (
    <>
      <PageHeader title="Query History" description="Explanations, generated SQL, analyses, comparisons, migrations and AI conversations." />
      <Suspense fallback={null}><HistoryFilters op={sp.op ?? ""} q={sp.q ?? ""} /></Suspense>
      {items.length === 0 ? <EmptyState icon={History} title="Nothing here yet" description="Your analyses, AI interactions and comparisons are saved automatically and show up here." /> : <HistoryList items={items} />}
    </>
  );
}
