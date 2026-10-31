import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page";
import { SqlAssistant } from "@/components/ai/sql-assistant";
import { getPreferences } from "@/lib/ai/config";
import { requireUser } from "@/lib/auth";
import { getProjectContext } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI SQL Assistant" };

export default async function AiAssistantPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const [ctx, prefs] = await Promise.all([getProjectContext(), getPreferences({ supabase, user })]);
  return (
    <>
      <PageHeader title="AI SQL Assistant" description="Generate and explain SQL using your imported schema as grounding. Output is advisory: nothing is executed automatically." />
      <SqlAssistant
        projectId={ctx.project?.id ?? null}
        versionId={ctx.version?.id ?? null}
        versionLabel={ctx.project && ctx.version ? `${ctx.project.name} v${ctx.version.version_number}` : null}
        defaultDialect={prefs.default_dialect}
        initialMode={sp.mode === "explain" ? "explain" : "generate"}
      />
    </>
  );
}
