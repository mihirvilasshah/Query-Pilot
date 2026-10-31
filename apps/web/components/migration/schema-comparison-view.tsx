"use client";

import { AlertOctagon, Download, GitCompareArrows, Loader2, Minus, Pencil, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DiffCategory, DiffItem, DiffStatus, SchemaDiff } from "@querypilot/database-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { postJson } from "@/lib/ai/client";
import { VersionPairPicker, type VersionChoice } from "@/components/migration/version-pair-picker";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<DiffCategory, string> = {
  schema: "Schemas", table: "Tables", column: "Columns", primary_key: "Primary keys", foreign_key: "Foreign keys", unique_constraint: "Unique constraints",
  check_constraint: "Check constraints", default_constraint: "Default constraints", index: "Indexes", view: "Views", procedure: "Stored procedures", function: "Functions", trigger: "Triggers",
};
const STATUS_STYLE: Record<DiffStatus, { variant: "success" | "danger" | "warning" | "muted"; icon: typeof Plus; label: string }> = {
  added: { variant: "success", icon: Plus, label: "Added" },
  removed: { variant: "danger", icon: Minus, label: "Removed" },
  modified: { variant: "warning", icon: Pencil, label: "Modified" },
  unchanged: { variant: "muted", icon: Minus, label: "Unchanged" },
};

interface Resp { comparisonId: string; diff: SchemaDiff; baseLabel: string; targetLabel: string }

function toMarkdown(r: Resp): string {
  const t = r.diff.totals;
  const lines = [`# Schema comparison: ${r.baseLabel} → ${r.targetLabel}`, "", `Added **${t.added}**, modified **${t.modified}**, removed **${t.removed}**, unchanged ${t.unchanged}. Potentially destructive changes: **${t.destructive}**.`, "", "| Category | Added | Removed | Modified | Unchanged |", "|---|---|---|---|---|"];
  for (const [c, s] of Object.entries(r.diff.summary)) lines.push(`| ${CATEGORY_LABEL[c as DiffCategory]} | ${s.added} | ${s.removed} | ${s.modified} | ${s.unchanged} |`);
  lines.push("", "## Changes", "");
  for (const i of r.diff.items) lines.push(`- **${i.status.toUpperCase()}** ${CATEGORY_LABEL[i.category].replace(/s$/, "")} \`${i.table ? `${i.table}.` : ""}${i.name}\`${i.destructive ? " ⚠ DESTRUCTIVE" : ""}${i.changes.length ? ` - ${i.changes.join("; ")}` : ""}${i.riskNotes.length ? ` _(${i.riskNotes.join(" ")})_` : ""}`);
  return lines.join("\n");
}

export function SchemaComparisonView({ projectId, versions, initialBase, initialTarget }: { projectId: string; versions: VersionChoice[]; initialBase: string; initialTarget: string }) {
  const [base, setBase] = useState(initialBase);
  const [target, setTarget] = useState(initialTarget);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resp | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState("");
  const [onlyDestructive, setOnlyDestructive] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    const r = await postJson<Resp>("/api/compare", { projectId, baseVersionId: base, targetVersionId: target, includeDestructive: false });
    setLoading(false);
    if (r.ok) setRes(r.data);
    else setError(r.error.message);
  };

  const items = useMemo(() => (res?.diff.items ?? []).filter((i: DiffItem) =>
    (status === "all" || i.status === status) && (category === "all" || i.category === category) && (!onlyDestructive || i.destructive) &&
    (!q || `${i.table ?? ""}.${i.name} ${i.changes.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  ), [res, status, category, q, onlyDestructive]);

  const download = () => {
    if (!res) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toMarkdown(res)], { type: "text/markdown" }));
    a.download = "schema-comparison.md";
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="surface flex flex-wrap items-end gap-4 p-4">
        <VersionPairPicker versions={versions} base={base} target={target} onBase={setBase} onTarget={setTarget} />
        <Button onClick={run} disabled={loading || !base || !target || base === target} data-testid="compare-btn">{loading ? <Loader2 className="size-4 animate-spin" /> : <GitCompareArrows className="size-4" />} Compare</Button>
        {base === target && <p className="text-xs text-warning-foreground dark:text-warning">Choose two different versions.</p>}
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {res && (
        <div className="space-y-5" data-testid="comparison-result">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {([["added", res.diff.totals.added], ["modified", res.diff.totals.modified], ["removed", res.diff.totals.removed], ["unchanged", res.diff.totals.unchanged]] as const).map(([s, n]) => (
              <div key={s} className="surface p-3.5"><p className="text-xs capitalize text-muted-foreground">{s}</p><p className={cn("text-2xl font-semibold tabular-nums", s === "added" && "text-success", s === "removed" && "text-destructive", s === "modified" && "text-warning")}>{n}</p></div>
            ))}
            <div className={cn("surface p-3.5", res.diff.totals.destructive > 0 && "border-destructive/40 bg-destructive/5")}><p className="text-xs text-muted-foreground">Potentially destructive</p><p className="text-2xl font-semibold tabular-nums text-destructive">{res.diff.totals.destructive}</p></div>
          </div>

          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="summary-table">
              <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Category", "Added", "Removed", "Modified", "Unchanged"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {(Object.keys(CATEGORY_LABEL) as DiffCategory[]).map((c) => { const s = res.diff.summary[c]; return (
                  <tr key={c}><td className="px-3 py-1.5 font-medium">{CATEGORY_LABEL[c]}</td><td className="px-3 py-1.5 tabular-nums">{s.added || "·"}</td><td className="px-3 py-1.5 tabular-nums">{s.removed || "·"}</td><td className="px-3 py-1.5 tabular-nums">{s.modified || "·"}</td><td className="px-3 py-1.5 tabular-nums text-muted-foreground">{s.unchanged}</td></tr>
                ); })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter changes…" className="pl-9" aria-label="Filter changes" /></div>
            <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36" aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="added">Added</SelectItem><SelectItem value="removed">Removed</SelectItem><SelectItem value="modified">Modified</SelectItem></SelectContent></Select>
            <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-48" aria-label="Category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{(Object.keys(CATEGORY_LABEL) as DiffCategory[]).map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}</SelectContent></Select>
            <Button size="sm" variant={onlyDestructive ? "destructive" : "outline"} onClick={() => setOnlyDestructive((o) => !o)}><AlertOctagon className="size-4" /> Destructive only</Button>
            <Button size="sm" variant="outline" onClick={download}><Download className="size-4" /> Report</Button>
            <Button asChild size="sm"><Link href={`/migration-assistant?base=${base}&target=${target}`}>Plan migration</Link></Button>
          </div>

          {items.length === 0 ? <p className="surface px-4 py-10 text-center text-sm text-muted-foreground">{res.diff.items.length === 0 ? "These two versions are identical." : "No changes match the filters."}</p> : (
            <ul className="surface divide-y" data-testid="diff-list">
              {items.slice(0, 600).map((i) => {
                const st = STATUS_STYLE[i.status];
                const Icon = st.icon;
                return (
                  <li key={i.id} className="space-y-1 px-4 py-2.5" data-status={i.status} data-destructive={i.destructive}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={st.variant}><Icon />{st.label}</Badge>
                      <Badge variant="outline">{CATEGORY_LABEL[i.category].replace(/s$/, "")}</Badge>
                      <span className="text-sm font-medium">{i.table && <span className="text-muted-foreground">{i.table}.</span>}{i.name}</span>
                      {i.destructive && <Badge variant="danger"><AlertOctagon /> may lose data</Badge>}
                    </div>
                    {i.changes.map((c, k) => <p key={k} className="pl-1 font-mono text-xs text-muted-foreground">{c}</p>)}
                    {i.riskNotes.map((n, k) => <p key={k} className="pl-1 text-xs text-warning-foreground dark:text-warning">⚠ {n}</p>)}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
