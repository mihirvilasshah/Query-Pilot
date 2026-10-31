"use client";

import { AlertTriangle, Check, Copy, Download, Loader2, ShieldAlert, Workflow } from "lucide-react";
import { useState } from "react";
import type { MigrationPlan } from "@querypilot/database-core";
import { MonacoEditor } from "@/components/sql/monaco-editor";
import { VersionPairPicker, type VersionChoice } from "@/components/migration/version-pair-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson } from "@/lib/ai/client";
import { toast } from "sonner";

function Bullets({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty ?? "None."}</p>;
  return <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>;
}

function SqlBlock({ title, sql, file }: { title: string; sql: string; file: string }) {
  const [copied, setCopied] = useState(false);
  if (!sql.trim()) return <p className="text-sm text-muted-foreground">Nothing to show.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy</Button>
          <Button size="sm" variant="outline" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([sql], { type: "text/plain" })); a.download = file; a.click(); }}><Download className="size-4" /> Download</Button>
        </div>
      </div>
      <MonacoEditor value={sql} readOnly height={Math.min(560, 60 + sql.split("\n").length * 19)} />
    </div>
  );
}

export function MigrationView({ projectId, versions, initialBase, initialTarget }: { projectId: string; versions: VersionChoice[]; initialBase: string; initialTarget: string }) {
  const [base, setBase] = useState(initialBase);
  const [target, setTarget] = useState(initialTarget);
  const [destructive, setDestructive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    const r = await postJson<{ plan: MigrationPlan }>("/api/migrations", { projectId, baseVersionId: base, targetVersionId: target, includeDestructive: destructive });
    setLoading(false);
    if (r.ok) { setPlan(r.data.plan); toast.success("Migration plan generated - not executed"); }
    else setError(r.error.message);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="note">
        <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 text-warning" /> Generated scripts require human review</p>
        <p className="mt-1 text-muted-foreground">QueryPilot only produces text. It never connects to a database and never executes migration SQL. Rollback scripts are suggestions: they cannot restore data that a forward step destroys.</p>
      </div>

      <div className="surface space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <VersionPairPicker versions={versions} base={base} target={target} onBase={setBase} onTarget={setTarget} />
          <Button onClick={generate} disabled={loading || !base || !target || base === target} data-testid="generate-migration">{loading ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />} Generate plan</Button>
        </div>
        <div className="flex items-start gap-2.5">
          <Switch id="destructive" checked={destructive} onCheckedChange={setDestructive} />
          <div><Label htmlFor="destructive" className="font-medium">Include destructive statements</Label><p className="text-xs text-muted-foreground">Off (recommended): DROP TABLE / DROP COLUMN / lossy type changes are generated <em>commented out</em> so they must be enabled deliberately.</p></div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>

      {plan && (
        <Tabs defaultValue="overview" data-testid="migration-plan">
          <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="steps">Steps ({plan.steps.length})</TabsTrigger>
            <TabsTrigger value="sql">Migration SQL</TabsTrigger>
            <TabsTrigger value="rollback">Rollback</TabsTrigger>
            <TabsTrigger value="pre">Pre-validation</TabsTrigger>
            <TabsTrigger value="post">Post-validation</TabsTrigger>
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="grid gap-4 md:grid-cols-2">
            <div className="surface space-y-2 p-4 md:col-span-2"><h3 className="text-sm font-semibold">Purpose</h3><p className="text-sm">{plan.purpose}</p></div>
            <div className="surface space-y-2 p-4"><h3 className="text-sm font-semibold">Expected impact</h3><Bullets items={plan.expectedImpact} /></div>
            <div className="surface space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-warning" /> Risks {plan.destructiveCount > 0 && <Badge variant="danger">{plan.destructiveCount} destructive</Badge>}</h3><Bullets items={plan.risks} empty="No specific risks were identified." /></div>
            <div className="surface space-y-2 p-4"><h3 className="text-sm font-semibold">Prerequisites</h3><Bullets items={plan.prerequisites} /></div>
            <div className="surface space-y-2 p-4"><h3 className="text-sm font-semibold">Objects affected ({plan.objectsAffected.length})</h3><Bullets items={plan.objectsAffected.slice(0, 40)} /></div>
            <div className="surface space-y-2 p-4"><h3 className="text-sm font-semibold">Validation steps</h3><Bullets items={plan.validationSteps} /></div>
            <div className="surface space-y-2 p-4"><h3 className="text-sm font-semibold">Rollback considerations</h3><Bullets items={plan.rollbackConsiderations} /></div>
          </TabsContent>
          <TabsContent value="steps">
            {plan.steps.length === 0 ? <p className="surface px-4 py-8 text-center text-sm text-muted-foreground">No differences: nothing to migrate.</p> : (
              <ol className="space-y-3">{plan.steps.map((s) => (
                <li key={s.order} className="surface p-4">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">Step {s.order}</Badge><span className="text-sm font-medium">{s.title}</span>{s.destructive && <Badge variant="danger">destructive</Badge>}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{s.objects.slice(0, 6).join(", ")}{s.objects.length > 6 ? ` +${s.objects.length - 6} more` : ""}</p>
                  {s.notes.map((n, k) => <p key={k} className="mt-1 text-xs text-warning-foreground dark:text-warning">⚠ {n}</p>)}
                </li>
              ))}</ol>
            )}
          </TabsContent>
          <TabsContent value="sql"><SqlBlock title="Migration script (review before use)" sql={plan.migrationSql} file="migration.sql" /></TabsContent>
          <TabsContent value="rollback" className="space-y-3"><p className="text-sm text-muted-foreground">Suggestion only: reverses schema changes, cannot restore dropped data.</p><SqlBlock title="Rollback suggestion" sql={plan.rollbackSql} file="rollback.sql" /></TabsContent>
          <TabsContent value="pre"><SqlBlock title="Pre-migration validation queries (read-only)" sql={plan.preValidationSql} file="pre-validation.sql" /></TabsContent>
          <TabsContent value="post"><SqlBlock title="Post-migration validation queries (read-only)" sql={plan.postValidationSql} file="post-validation.sql" /></TabsContent>
          <TabsContent value="checklist"><ul className="surface space-y-2 p-4 text-sm">{plan.checklist.map((c) => <li key={c} className="font-mono text-xs">{c}</li>)}</ul></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
