"use client";

import { ChevronDown, Search, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SqlViewer } from "@/components/sql/monaco-editor";
import { cn } from "@/lib/utils";

export interface TriggerItem {
  id: string;
  schema: string;
  name: string;
  parent: { id: string | null; label: string } | null;
  events: string[];
  timing: string | null;
  definition: string | null;
  operations: string[];
  dependencies: { label: string; kind: string }[];
}

export function TriggerList({ items, initialQuery }: { items: TriggerItem[]; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [open, setOpen] = useState<string | null>(initialQuery && items.length ? (items.find((i) => i.name.toLowerCase() === initialQuery.toLowerCase())?.id ?? null) : null);
  const filtered = useMemo(() => items.filter((i) => `${i.schema}.${i.name} ${i.parent?.label ?? ""}`.toLowerCase().includes(q.toLowerCase())), [items, q]);
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search triggers or tables…" className="pl-9" aria-label="Search triggers" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Zap} title={items.length ? "No matches" : "No triggers in this version"} />
      ) : (
        <ul className="surface divide-y overflow-hidden" data-testid="trigger-list">
          {filtered.map((t) => {
            const isOpen = open === t.id;
            return (
              <li key={t.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen}>
                  <Zap className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.schema && <span className="text-muted-foreground">{t.schema}.</span>}{t.name}</span>
                    <span className="text-xs text-muted-foreground">on {t.parent?.label ?? "unknown table"}</span>
                  </span>
                  <span className="hidden gap-1.5 sm:flex">
                    {t.timing && <Badge variant="outline">{t.timing}</Badge>}
                    {t.events.map((e) => <Badge key={e} variant="secondary">{e}</Badge>)}
                  </span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t bg-muted/20 p-4">
                    {t.parent?.id && <p className="text-sm">Table: <Link href={`/database-intelligence/tables/${t.parent.id}`} className="font-medium text-primary hover:underline">{t.parent.label}</Link></p>}
                    {t.dependencies.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">{t.dependencies.map((d, i) => <Badge key={i} variant={d.kind === "writes" ? "danger" : "info"}>{d.kind} {d.label}</Badge>)}</div>
                    )}
                    {t.definition ? <SqlViewer value={t.definition} /> : <p className="text-sm text-muted-foreground">Definition not captured.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
