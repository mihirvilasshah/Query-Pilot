"use client";

import { AlertOctagon, AlertTriangle, ChevronRight, Info, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Finding, StatementInfo, TableImpact } from "@querypilot/database-core";
import type { SqlAnalysisSupplement } from "@querypilot/ai-core";
import { RISK_ORDER, type RiskLevel } from "@querypilot/shared-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AnalysisPayload {
  dialect: string;
  overallRisk: RiskLevel;
  findings: Finding[];
  statements: StatementInfo[];
  tablesAffected: TableImpact[];
  routinesCalled: string[];
  statementCounts: Record<string, number>;
  batchCount: number;
  parseWarnings: string[];
  limitations: string[];
}

export const SEVERITY_STYLE: Record<RiskLevel, { variant: "danger" | "warning" | "info" | "muted" | "secondary"; label: string; icon: typeof Info; text: string }> = {
  critical: { variant: "danger", label: "Critical", icon: AlertOctagon, text: "text-destructive" },
  high: { variant: "danger", label: "High", icon: ShieldAlert, text: "text-destructive" },
  medium: { variant: "warning", label: "Medium", icon: AlertTriangle, text: "text-warning" },
  low: { variant: "info", label: "Low", icon: Info, text: "text-info" },
  informational: { variant: "muted", label: "Informational", icon: Info, text: "text-muted-foreground" },
};

export function SeverityBadge({ level }: { level: RiskLevel }) {
  const s = SEVERITY_STYLE[level];
  const Icon = s.icon;
  return <Badge variant={s.variant}><Icon />{s.label}</Badge>;
}

function flatten(list: StatementInfo[]): StatementInfo[] {
  return list.flatMap((s) => [s, ...flatten(s.children)]);
}

export function AnalysisView({ analysis, ai, onJumpToLine }: { analysis: AnalysisPayload; ai?: { supplement?: SqlAnalysisSupplement; model?: string; provider?: string; error?: { code: string; message: string } }; onJumpToLine?: (line: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const stmts = flatten(analysis.statements);
  const counts = RISK_ORDER.map((l) => [l, analysis.findings.filter((f) => f.severity === l).length] as const);
  const overall = SEVERITY_STYLE[analysis.overallRisk];
  const OverallIcon = analysis.findings.length === 0 ? ShieldCheck : overall.icon;

  return (
    <div className="space-y-5" data-testid="analysis-result">
      <div className={cn("flex flex-wrap items-center gap-4 rounded-xl border p-4", analysis.findings.length ? "bg-card" : "border-success/30 bg-success/5")}>
        <OverallIcon className={cn("size-8", analysis.findings.length ? overall.text : "text-success")} />
        <div>
          <p className="text-xs text-muted-foreground">Overall risk</p>
          <p className="text-xl font-semibold" data-testid="overall-risk">{analysis.findings.length === 0 ? "No issues detected" : overall.label}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {counts.filter(([, n]) => n > 0).map(([l, n]) => <Badge key={l} variant={SEVERITY_STYLE[l].variant}>{n} {SEVERITY_STYLE[l].label.toLowerCase()}</Badge>)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Static, deterministic analysis. Findings marked “heuristic” are patterns that may be false positives; they are warnings, not confirmed errors.</p>

      {analysis.parseWarnings.length > 0 && (
        <ul className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{analysis.parseWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Findings ({analysis.findings.length})</h3>
        {analysis.findings.length === 0 ? <p className="surface px-4 py-6 text-sm text-muted-foreground">No risky patterns were detected by the static rules.</p> : (
          <ul className="space-y-2">
            {analysis.findings.map((f) => (
              <li key={f.id} className="surface p-3.5" data-testid="finding" data-severity={f.severity}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge level={f.severity} />
                  <span className="text-sm font-medium">{f.title}</span>
                  <Badge variant="outline">{f.confidence}</Badge>
                  <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => onJumpToLine?.(f.line)}>line {f.line}</button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>
                <p className="mt-1.5 text-sm"><span className="font-medium">Recommendation: </span>{f.recommendation}</p>
                {f.saferAlternative && <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs">{f.saferAlternative}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Tables affected ({analysis.tablesAffected.length})</h3>
        {analysis.tablesAffected.length === 0 ? <p className="text-sm text-muted-foreground">No table references found.</p> : (
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground"><tr>{["Table", "Operations", "Columns affected", "Access"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {analysis.tablesAffected.map((t) => (
                  <tr key={t.fullName}>
                    <td className="px-3 py-2 font-medium">{t.fullName}{t.isTemporary && <Badge variant="muted" className="ml-2">temp</Badge>}</td>
                    <td className="px-3 py-2"><span className="flex flex-wrap gap-1">{t.operations.map((o) => <Badge key={o} variant={["select"].includes(o) ? "info" : "danger"}>{o}</Badge>)}</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{t.columns.join(", ") || "—"}</td>
                    <td className="px-3 py-2">{t.readOnly ? <Badge variant="success">read-only</Badge> : <Badge variant="warning">modifies</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {analysis.routinesCalled.length > 0 && <p className="mt-2 text-sm text-muted-foreground">Procedures/functions called: {analysis.routinesCalled.join(", ")}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Statement breakdown ({stmts.length} in {analysis.batchCount} batch{analysis.batchCount === 1 ? "" : "es"})</h3>
        <div className="mb-2 flex flex-wrap gap-1.5">{Object.entries(analysis.statementCounts).map(([k, n]) => <Badge key={k} variant="secondary">{k} × {n}</Badge>)}</div>
        <ul className="surface divide-y">
          {stmts.filter((s) => !["control"].includes(s.kind) || s.references.length > 0).slice(0, 200).map((s) => {
            const isOpen = open === `${s.index}`;
            return (
              <li key={s.index}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => setOpen(isOpen ? null : `${s.index}`)} aria-expanded={isOpen}>
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                  <Badge variant="secondary" className="w-20 justify-center uppercase">{s.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.text.replace(/\s+/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">L{s.startLine}</span>
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t bg-muted/20 px-4 py-3 text-xs">
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono">{s.text}</pre>
                    {s.dataImpact && <p><span className="font-medium">Potential data impact: </span>{s.dataImpact}</p>}
                    {s.references.length > 0 && <p><span className="font-medium">References: </span>{s.references.map((r) => `${r.fullName} (${r.operation})`).join(", ")}</p>}
                    {s.previewSql && <div><p className="mb-1 font-medium">Suggested preview before running:</p><pre className="rounded bg-muted p-2 font-mono">{s.previewSql}</pre></div>}
                    {s.isDynamicSql && <p className="text-warning">Dynamic SQL: the executed text is not visible to static analysis.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {ai && (
        <section data-testid="ai-supplement">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> AI supplement <Badge variant="outline">AI-generated, verify</Badge></h3>
          {ai.error ? <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{ai.error.message}</p> : ai.supplement && (
            <div className="surface space-y-3 p-4 text-sm">
              <p>{ai.supplement.summary}</p>
              {ai.supplement.additionalConcerns.length > 0 && (
                <ul className="space-y-2">{ai.supplement.additionalConcerns.map((c, i) => <li key={i}><SeverityBadge level={c.severity} /> <span className="font-medium">{c.title}</span><p className="mt-0.5 text-muted-foreground">{c.detail}</p></li>)}</ul>
              )}
              {ai.supplement.saferAlternatives.length > 0 && <div><p className="font-medium">Safer alternatives</p><ul className="list-disc pl-5">{ai.supplement.saferAlternatives.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
              {ai.supplement.notes.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{ai.supplement.notes.map((a, i) => <li key={i}>{a}</li>)}</ul>}
              <p className="text-xs text-muted-foreground">{ai.provider} / {ai.model}</p>
            </div>
          )}
        </section>
      )}

      <ul className="space-y-1 text-xs text-muted-foreground">{analysis.limitations.map((l) => <li key={l} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" />{l}</li>)}</ul>
    </div>
  );
}
