"use client";

import { ListTree, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface IndexItem {
  id: string;
  table: string;
  tableId: string;
  name: string;
  type: string | null;
  keys: string;
  included: string;
  flags: string[];
  filter: string | null;
}
export interface ConstraintItem {
  id: string;
  table: string;
  tableId: string;
  name: string | null;
  type: string;
  detail: string;
}

export function IndexExplorer({ indexes, constraints }: { indexes: IndexItem[]; constraints: ConstraintItem[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("indexes");
  const term = q.toLowerCase();
  const idx = useMemo(() => indexes.filter((i) => `${i.table} ${i.name} ${i.keys}`.toLowerCase().includes(term)), [indexes, term]);
  const cons = useMemo(() => constraints.filter((c) => `${c.table} ${c.name ?? ""} ${c.detail} ${c.type}`.toLowerCase().includes(term)), [constraints, term]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="indexes">Indexes ({indexes.length})</TabsTrigger><TabsTrigger value="constraints">Constraints ({constraints.length})</TabsTrigger></TabsList>
        </Tabs>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by table, name or column…" className="pl-9" aria-label="Search" />
        </div>
      </div>
      {tab === "indexes" ? (
        idx.length === 0 ? <EmptyState icon={ListTree} title="No indexes found" /> : (
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Table", "Index", "Type", "Key columns", "Included", "Flags"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {idx.slice(0, 500).map((i) => (
                  <tr key={i.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/database-intelligence/tables/${i.tableId}`}>{i.table}</Link></td>
                    <td className="px-3 py-2">{i.name}</td>
                    <td className="px-3 py-2 text-xs">{i.type ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{i.keys}</td>
                    <td className="px-3 py-2 font-mono text-xs">{i.included || "—"}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{i.flags.map((f) => <Badge key={f} variant={f === "PK" ? "default" : "secondary"}>{f}</Badge>)}{i.filter && <Badge variant="outline" title={i.filter}>filtered</Badge>}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : cons.length === 0 ? <EmptyState icon={ListTree} title="No constraints found" /> : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Table", "Constraint", "Type", "Definition"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {cons.slice(0, 500).map((c) => (
                <tr key={c.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/database-intelligence/tables/${c.tableId}`}>{c.table}</Link></td>
                  <td className="px-3 py-2">{c.name ?? <span className="text-muted-foreground">(unnamed)</span>}</td>
                  <td className="px-3 py-2"><Badge variant="secondary">{c.type.replace("_", " ")}</Badge></td>
                  <td className="px-3 py-2 font-mono text-xs">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
