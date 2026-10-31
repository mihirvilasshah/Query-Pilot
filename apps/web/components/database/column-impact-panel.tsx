"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ColumnImpact } from "@querypilot/database-core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function ColumnImpactPanel({ objectId, columns }: { objectId: string; columns: string[] }) {
  const [column, setColumn] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [impact, setImpact] = useState<ColumnImpact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (c: string) => {
    setColumn(c);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/impact?objectId=${objectId}&column=${encodeURIComponent(c)}`);
      const json = (await res.json()) as { impact?: ColumnImpact; error?: { message: string } };
      if (!res.ok || !json.impact) throw new Error(json.error?.message ?? "Failed");
      setImpact(json.impact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const none = <p className="text-sm text-muted-foreground">None detected.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">What could be affected if this column is changed or removed?</p>
        <Select value={column} onValueChange={run}>
          <SelectTrigger className="w-56" aria-label="Column" data-testid="impact-column"><SelectValue placeholder="Choose a column" /></SelectTrigger>
          <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {impact && !loading && (
        <div className="grid gap-4 md:grid-cols-2" data-testid="impact-result">
          <div className="surface p-4">
            <h4 className="mb-2 text-sm font-semibold">Likely referencing objects <Badge variant="warning">text match</Badge></h4>
            {impact.likelyReferences.length ? <ul className="space-y-1 text-sm">{impact.likelyReferences.map((r) => <li key={r.fullName}><span className="font-medium">{r.fullName}</span> <span className="text-xs text-muted-foreground">({r.type})</span></li>)}</ul> : none}
          </div>
          <div className="surface p-4">
            <h4 className="mb-2 text-sm font-semibold">Reference the table but not the column by name</h4>
            {impact.tableOnlyReferences.length ? <ul className="space-y-1 text-sm">{impact.tableOnlyReferences.map((r) => <li key={r.fullName}>{r.fullName} <span className="text-xs text-muted-foreground">({r.type}; may use SELECT *)</span></li>)}</ul> : none}
          </div>
          <div className="surface p-4">
            <h4 className="mb-2 text-sm font-semibold">Foreign keys</h4>
            {impact.foreignKeys.length ? <ul className="space-y-1 text-sm">{impact.foreignKeys.map((f, i) => <li key={i}>{f.name ?? "(unnamed)"} - {f.table} <span className="text-xs text-muted-foreground">({f.role})</span></li>)}</ul> : none}
          </div>
          <div className="surface p-4">
            <h4 className="mb-2 text-sm font-semibold">Indexes & constraints</h4>
            {impact.indexes.length || impact.constraints.length ? <ul className="space-y-1 text-sm">{[...impact.indexes.map((i) => `Index ${i}`), ...impact.constraints.map((c) => `Constraint ${c}`)].map((x) => <li key={x}>{x}</li>)}</ul> : none}
          </div>
          <p className="flex gap-2 text-xs text-muted-foreground md:col-span-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{impact.notes.join(" ")}</p>
        </div>
      )}
    </div>
  );
}
