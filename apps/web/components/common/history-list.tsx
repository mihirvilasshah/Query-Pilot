"use client";

import { BookOpen, ChevronRight, FileSearch, GitCompareArrows, MessageSquare, Save, Search, Sparkles, Wand2, Workflow, Gauge } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { OPERATION_LABELS, type QueryHistoryOperation } from "@querypilot/shared-types";
import { Markdown } from "@/components/common/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { postJson } from "@/lib/ai/client";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  id: string;
  operation: QueryHistoryOperation;
  title: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  ref_id: string | null;
  created_at: string;
}

const ICONS: Record<QueryHistoryOperation, typeof Search> = { sql_explain: Sparkles, sql_generate: Wand2, sql_analyze: FileSearch, sql_optimize: Gauge, schema_comparison: GitCompareArrows, ai_conversation: MessageSquare, migration_plan: Workflow, documentation: BookOpen };

export function HistoryFilters({ op, q }: { op: string; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q);
  const push = (next: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== "all") sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`${pathname}?${sp}`);
  };
  return (
    <form className="mb-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); push({ q: text }); }}>
      <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search history…" className="pl-9" aria-label="Search history" /></div>
      <Select value={op || "all"} onValueChange={(v) => push({ op: v })}>
        <SelectTrigger className="w-full sm:w-56" aria-label="Operation"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All operations</SelectItem>{(Object.keys(OPERATION_LABELS) as QueryHistoryOperation[]).map((o) => <SelectItem key={o} value={o}>{OPERATION_LABELS[o]}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="submit" variant="secondary">Search</Button>
    </form>
  );
}

export function HistoryList({ items }: { items: HistoryItem[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const saveToLibrary = async (item: HistoryItem) => {
    const sql = (item.output.sql ?? item.output.optimizedSql ?? item.input.sql) as string | undefined;
    if (!sql) return;
    const res = await postJson<{ script: { id: string } }>("/api/scripts", { name: item.title.slice(0, 120), content: sql, dialect: (item.input.dialect as string) ?? "tsql", tags: ["from-history"], isFavorite: false });
    if (res.ok) toast.success("Saved to script library");
    else toast.error(res.error.message);
  };

  return (
    <ul className="surface divide-y" data-testid="history-list">
      {items.map((h) => {
        const Icon = ICONS[h.operation] ?? Sparkles;
        const isOpen = open === h.id;
        const sql = (h.output.sql ?? h.output.optimizedSql ?? h.input.sql) as string | undefined;
        return (
          <li key={h.id}>
            <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setOpen(isOpen ? null : h.id)} aria-expanded={isOpen}>
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.title}</span><span className="text-xs text-muted-foreground">{timeAgo(h.created_at)}</span></span>
              <Badge variant="secondary" className="hidden sm:inline-flex">{OPERATION_LABELS[h.operation]}</Badge>
              <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
            </button>
            {isOpen && (
              <div className="space-y-3 border-t bg-muted/20 px-4 py-3 text-sm">
                {typeof h.output.text === "string" && <Markdown>{h.output.text}</Markdown>}
                {sql && <pre className="scroll-thin max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{sql}</pre>}
                {h.operation === "sql_analyze" && <p className="text-muted-foreground">Overall risk: <strong>{String(h.output.overallRisk)}</strong> · {String(h.output.findings)} finding(s)</p>}
                {h.operation === "schema_comparison" && h.output.totals != null && <p className="font-mono text-xs text-muted-foreground">{JSON.stringify(h.output.totals)}</p>}
                <div className="flex flex-wrap gap-2">
                  {h.operation === "ai_conversation" && h.ref_id && <Button asChild size="sm"><Link href={`/database-intelligence/assistant?c=${h.ref_id}`}>Continue conversation</Link></Button>}
                  {h.operation === "schema_comparison" && <Button asChild size="sm" variant="outline"><Link href="/schema-comparison">Open comparison</Link></Button>}
                  {h.operation === "migration_plan" && <Button asChild size="sm" variant="outline"><Link href="/migration-assistant">Open migration assistant</Link></Button>}
                  {h.operation === "sql_analyze" && <Button asChild size="sm" variant="outline"><Link href="/sql-analyzer">Open analyzer</Link></Button>}
                  {h.operation === "documentation" && h.ref_id && <Button asChild size="sm" variant="outline"><a href={`/api/docs/${h.ref_id}`}>Download again</a></Button>}
                  {sql && <Button size="sm" variant="outline" onClick={() => void saveToLibrary(h)}><Save className="size-4" /> Save to script library</Button>}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
