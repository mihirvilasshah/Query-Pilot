"use client";

import { Check, Copy, ExternalLink, HelpCircle, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { GeneratedSql } from "@querypilot/ai-core";
import type { Finding } from "@querypilot/database-core";
import { SQL_DIALECTS, type RiskLevel, type SqlDialect } from "@querypilot/shared-types";
import { AiErrorNotice, ExternalAiNotice } from "@/components/ai/ai-notices";
import { Markdown } from "@/components/common/markdown";
import { SeverityBadge } from "@/components/sql/analysis-view";
import { MonacoEditor } from "@/components/sql/monaco-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { postJson, type ApiFailure } from "@/lib/ai/client";

interface GenResp { generated: GeneratedSql; analysis: { overallRisk: RiskLevel; findings: Finding[] } | null; model: string; provider: string; usedMetadata: string[] }

const EXAMPLES = [
  "Generate a SELECT joining the three pricing tables for a given hospital",
  "Generate a validation query that checks for orphaned rows before a migration",
  "Generate a rollback script for adding the new Markup column",
];

export function SqlAssistant({ projectId, versionId, versionLabel, defaultDialect, initialMode }: { projectId: string | null; versionId: string | null; versionLabel: string | null; defaultDialect: SqlDialect; initialMode: "generate" | "explain" }) {
  const router = useRouter();
  const [mode, setMode] = useState<string>(initialMode);
  const [dialect, setDialect] = useState<SqlDialect>(defaultDialect);
  const [useSchema, setUseSchema] = useState(true);

  const [request, setRequest] = useState("");
  const [existing, setExisting] = useState("");
  const [answers, setAnswers] = useState("");
  const [gen, setGen] = useState<GenResp | null>(null);

  const [sql, setSql] = useState("");
  const [explain, setExplain] = useState<{ text: string; model: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [copied, setCopied] = useState(false);
  const ctxIds = useSchema && versionId ? { projectId, versionId } : { projectId };

  const generate = async () => {
    if (request.trim().length < 3) return;
    setLoading(true);
    setError(null);
    const text = answers.trim() ? `${request}\n\nAdditional details provided by the user:\n${answers}` : request;
    const res = await postJson<GenResp>("/api/ai/generate-sql", { request: text, dialect, existingSql: existing || undefined, ...ctxIds });
    setLoading(false);
    if (res.ok) setGen(res.data);
    else setError(res.error);
  };

  const runExplain = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    const res = await postJson<{ text: string; model: string }>("/api/ai/explain-sql", { sql, dialect, ...ctxIds });
    setLoading(false);
    if (res.ok) setExplain(res.data);
    else setError(res.error);
  };

  const openInWorkspace = async (content: string, name: string) => {
    const res = await postJson<{ script: { id: string } }>("/api/scripts", { name, content, dialect, tags: ["ai-generated"], projectId, isFavorite: false });
    if (!res.ok) return void toast.error(res.error.message);
    router.push(`/sql-workspace?script=${res.data.script.id}`);
  };

  const g = gen?.generated;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={dialect} onValueChange={(v) => setDialect(v as SqlDialect)}>
          <SelectTrigger className="w-52" aria-label="Target dialect"><SelectValue /></SelectTrigger>
          <SelectContent>{SQL_DIALECTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
        {versionId ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={useSchema} onChange={(e) => setUseSchema(e.target.checked)} className="size-4 accent-[var(--primary)]" /> Use schema of <span className="font-medium">{versionLabel}</span></label>
        ) : <span className="text-xs text-muted-foreground">No imported schema selected: answers will not be grounded in your database.</span>}
      </div>
      <ExternalAiNotice />

      <Tabs value={mode} onValueChange={(m) => { setMode(m); setError(null); }}>
        <TabsList><TabsTrigger value="generate"><Wand2 className="size-4" /> Generate SQL</TabsTrigger><TabsTrigger value="explain"><Sparkles className="size-4" /> Explain SQL</TabsTrigger></TabsList>

        <TabsContent value="generate" className="space-y-4">
          <div className="surface space-y-3 p-4">
            <Label htmlFor="req">What do you need?</Label>
            <Textarea id="req" value={request} onChange={(e) => setRequest(e.target.value)} rows={4} maxLength={4000} placeholder="e.g. Generate an UPDATE that sets the markup of pricing level 12 to 1.15 for one hospital" data-testid="gen-request" />
            <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={() => setRequest(e)}>{e}</button>)}</div>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Existing SQL to modify (optional)</summary><Textarea className="mt-2 font-mono text-xs" value={existing} onChange={(e) => setExisting(e.target.value)} rows={5} /></details>
            {g && g.missingInformation.length > 0 && (
              <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm" data-testid="missing-info">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium"><HelpCircle className="size-4 text-info" /> The assistant needs more information</p>
                <ul className="mb-2 list-disc pl-5">{g.missingInformation.map((m, i) => <li key={i}>{m}</li>)}</ul>
                <Textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={2} placeholder="Answer here, then generate again" />
              </div>
            )}
            <Button onClick={generate} disabled={loading || request.trim().length < 3} data-testid="generate-btn">{loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} {g?.missingInformation.length ? "Generate again" : "Generate SQL"}</Button>
          </div>
          {error && mode === "generate" && <AiErrorNotice error={error} />}
          {g && g.sql.trim() && (
            <div className="space-y-4" data-testid="gen-result">
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Generated SQL is a <strong>proposal for human review</strong>. QueryPilot never executes it.</div>
              <MonacoEditor value={g.sql} readOnly height={Math.min(420, 40 + g.sql.split("\n").length * 19)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(g.sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy</Button>
                <Button size="sm" variant="outline" onClick={() => void openInWorkspace(g.sql, `Generated: ${request.slice(0, 60)}`)}><ExternalLink className="size-4" /> Open in workspace</Button>
              </div>
              {gen?.analysis && (
                <div className="surface p-4">
                  <p className="mb-2 text-sm font-semibold">Static risk check of the generated SQL <SeverityBadge level={gen.analysis.overallRisk} /></p>
                  {gen.analysis.findings.length === 0 ? <p className="text-sm text-muted-foreground">No risky patterns detected.</p> : <ul className="space-y-1.5 text-sm">{gen.analysis.findings.map((f) => <li key={f.id}><SeverityBadge level={f.severity} /> {f.title} <span className="text-muted-foreground">— {f.recommendation}</span></li>)}</ul>}
                </div>
              )}
              <div className="surface space-y-3 p-4 text-sm">
                {g.explanation && <div><p className="mb-1 font-semibold">Explanation</p><Markdown>{g.explanation}</Markdown></div>}
                {g.previewSql && <div><p className="mb-1 font-semibold">Preview before running (SELECT)</p><pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{g.previewSql}</pre></div>}
                {g.transactionAdvice && <div><p className="mb-1 font-semibold">Transaction handling</p><p>{g.transactionAdvice}</p></div>}
                {g.risks.length > 0 && <div><p className="mb-1 font-semibold">Risks</p><ul className="list-disc pl-5">{g.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
                {g.assumptions.length > 0 && <div><p className="mb-1 font-semibold">Assumptions</p><ul className="list-disc pl-5 text-muted-foreground">{g.assumptions.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
                {gen && gen.usedMetadata.length > 0 && <p className="text-xs text-muted-foreground">Schema objects supplied to the model: {gen.usedMetadata.join(", ")}</p>}
                {gen && <p className="text-xs text-muted-foreground">AI-generated · {gen.provider} / {gen.model}</p>}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="explain" className="space-y-4">
          <div className="surface space-y-3 p-4">
            <Label>SQL to explain</Label>
            <MonacoEditor value={sql} onChange={setSql} height={260} path="explain.sql" />
            <Button onClick={runExplain} disabled={loading || !sql.trim()} data-testid="explain-btn">{loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Explain</Button>
          </div>
          {error && mode === "explain" && <AiErrorNotice error={error} />}
          {explain && <div className="surface p-4" data-testid="explain-result"><Markdown>{explain.text}</Markdown><p className="mt-3 text-xs text-muted-foreground">AI-generated · {explain.model}. Verify before relying on it.</p></div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
