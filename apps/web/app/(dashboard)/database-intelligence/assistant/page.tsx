import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { DbChat, type ChatMessage } from "@/components/ai/db-chat";
import { EmptyState } from "@/components/common/page";
import { DbHeader } from "@/components/database/db-header";
import { RequireVersion } from "@/components/database/require-version";
import { getProjectContext } from "@/lib/data/queries";
import { timeAgo } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ConversationRow, MessageRow } from "@/lib/data/types";

export const metadata: Metadata = { title: "Database AI Assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ v?: string; c?: string; q?: string; focus?: string }> }) {
  const sp = await searchParams;
  const ctx = await getProjectContext(sp.v);
  if (!ctx.project || !ctx.version) return (<><DbHeader ctx={ctx} title="Database AI Assistant" /><RequireVersion ctx={ctx} /></>);
  const supabase = await createClient();
  const { data: convs } = await supabase.from("ai_conversations").select("id,title,updated_at,version_id").eq("project_id", ctx.project.id).order("updated_at", { ascending: false }).limit(15);
  const conversations = (convs ?? []) as Pick<ConversationRow, "id" | "title" | "updated_at" | "version_id">[];
  const cid = sp.c && z.uuid().safeParse(sp.c).success ? sp.c : null;

  let initial: ChatMessage[] = [];
  if (cid) {
    const { data } = await supabase.from("ai_messages").select("*").eq("conversation_id", cid).order("created_at");
    initial = ((data ?? []) as MessageRow[]).filter((m) => m.role !== "system").map((m) => ({
      id: m.id, role: m.role as "user" | "assistant", content: m.content,
      ...(m.role === "assistant" && m.structured ? { answer: m.structured as never, verified: m.object_refs, model: m.model ?? undefined, provider: m.provider ?? undefined } : {}),
    }));
  }
  const label = `${ctx.project.name} · v${ctx.version.version_number}`;

  return (
    <>
      <DbHeader ctx={ctx} title="Database AI Assistant" description="Conversational answers grounded in deterministic metadata retrieval. Follow-up questions keep context without resending the whole schema." />
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <DbChat key={cid ?? "new"} projectId={ctx.project.id} versionId={ctx.version.id} versionLabel={label} initialConversationId={cid} initialMessages={initial} {...(sp.q ? { autoQuestion: sp.q } : {})} {...(sp.focus ? { focusObjectId: sp.focus } : {})} />
        <aside className="surface h-fit p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold">Recent conversations</h2>
          {conversations.length === 0 ? <EmptyState icon={Sparkles} title="None yet" className="border-0 py-6" /> : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id}><Link href={`/database-intelligence/assistant?v=${c.version_id ?? ctx.version!.id}&c=${c.id}`} className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted"><span className="line-clamp-2">{c.title}</span><span className="text-xs text-muted-foreground">{timeAgo(c.updated_at)}</span></Link></li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
