"use client";

import { AlertTriangle, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/page";
import { Layers, SquareFunction, Table2, Workflow } from "lucide-react";

const ICONS = { table: Table2, view: Layers, procedure: Workflow, function: SquareFunction } as const;
export type ExplorerKind = keyof typeof ICONS;

export interface ExplorerItem {
  id: string;
  schema: string;
  name: string;
  href: string;
  /** Free text shown on the right, e.g. "12 columns". */
  meta: string;
  badges: { label: string; variant: "default" | "secondary" | "success" | "warning" | "info" | "danger" | "muted" | "outline" }[];
  dynamic?: boolean;
  searchText?: string;
}

export function ObjectExplorer({ items, kind, noun, initialQuery = "", sortOptions }: { items: ExplorerItem[]; kind: ExplorerKind; noun: string; initialQuery?: string; sortOptions?: { value: string; label: string }[] }) {
  const Icon = ICONS[kind];
  const [q, setQ] = useState(initialQuery);
  const [schema, setSchema] = useState("all");
  const [sort, setSort] = useState("name");
  const schemas = useMemo(() => [...new Set(items.map((i) => i.schema).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => (schema === "all" || i.schema === schema) && (!term || `${i.schema}.${i.name} ${i.searchText ?? ""}`.toLowerCase().includes(term)));
    return [...list].sort((a, b) => {
      if (sort === "meta") return (parseInt(b.meta) || 0) - (parseInt(a.meta) || 0);
      return `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`);
    });
  }, [items, q, schema, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}s…`} className="pl-9" aria-label={`Search ${noun}s`} data-testid="explorer-search" />
        </div>
        <Select value={schema} onValueChange={setSchema}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by schema"><SelectValue placeholder="All schemas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All schemas</SelectItem>
            {schemas.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {sortOptions && (
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>{sortOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="explorer-count">{filtered.length.toLocaleString()} of {items.length.toLocaleString()} {noun}{items.length === 1 ? "" : "s"}</p>

      {filtered.length === 0 ? (
        <EmptyState icon={Icon} title={items.length === 0 ? `No ${noun}s in this version` : "No matches"} description={items.length === 0 ? `This schema version does not contain any ${noun}s.` : "Try a different search term or clear the schema filter."} />
      ) : (
        <ul className="surface divide-y overflow-hidden" data-testid="explorer-list">
          {filtered.slice(0, 500).map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.schema && <span className="text-muted-foreground">{i.schema}.</span>}{i.name}</span>
                </span>
                {i.dynamic && <Badge variant="warning" className="hidden sm:inline-flex"><AlertTriangle /> dynamic SQL</Badge>}
                <span className="hidden gap-1.5 md:flex">{i.badges.map((b) => <Badge key={b.label} variant={b.variant}>{b.label}</Badge>)}</span>
                <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{i.meta}</span>
              </Link>
            </li>
          ))}
          {filtered.length > 500 && <li className="px-4 py-3 text-center text-xs text-muted-foreground">Showing the first 500 matches - refine the search to see more.</li>}
        </ul>
      )}
    </div>
  );
}
