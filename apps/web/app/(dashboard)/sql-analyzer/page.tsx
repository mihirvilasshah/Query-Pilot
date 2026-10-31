import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page";
import { SqlAnalyzerClient } from "@/components/sql/sql-analyzer-client";
import { getPreferences } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth";
import { getCurrentProject } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "SQL Script Analyzer" };

export default async function SqlAnalyzerPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [project, prefs] = await Promise.all([getCurrentProject(), getPreferences({ supabase, user })]);
  return (
    <>
      <PageHeader title="SQL Script Analyzer" description="Deterministic static analysis: statement breakdown, affected tables, data impact and risk detection. Works without AI." />
      <SqlAnalyzerClient projectId={project?.id ?? null} defaultDialect={prefs.default_dialect} />
    </>
  );
}
