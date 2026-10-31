import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page";
import { SqlWorkspace } from "@/components/sql/workspace";
import { getPreferences } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth";
import { getProjectContext } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "SQL Workspace" };

export default async function SqlWorkspacePage({ searchParams }: { searchParams: Promise<{ script?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const [ctx, prefs] = await Promise.all([getProjectContext(), getPreferences({ supabase, user })]);
  return (
    <>
      <PageHeader title="SQL Workspace" description="Write, format, analyze and save T-SQL, PostgreSQL, MySQL and SQLite. Scripts are stored privately and never executed." />
      <SqlWorkspace projectId={ctx.project?.id ?? null} versionId={ctx.version?.id ?? null} defaultDialect={prefs.default_dialect} {...(sp.script ? { initialScriptId: sp.script } : {})} />
    </>
  );
}
