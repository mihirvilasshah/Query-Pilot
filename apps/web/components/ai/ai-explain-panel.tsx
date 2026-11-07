"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ObjectExplanation } from "@querypilot/ai-core";
import { Button } from "@/components/ui/button";
import { AiErrorNotice, ExternalAiNotice } from "@/components/ai/ai-notices";
import { CopyButton } from "@/components/common/copy-button";
import { postJson, type ApiFailure } from "@/lib/ai/client";

/** Plain-text rendering of an object explanation, used by the copy actions. */
function explanationToText(e: ObjectExplanation): string {
  const sections: string[] = [`Summary:\n${e.summary}`];
  if (e.purpose) sections.push(`Purpose:\n${e.purpose}`);
  if (e.parameters.length) sections.push(`Parameters:\n${e.parameters.map((p) => `- ${p.name} - ${p.explanation}`).join("\n")}`);
  const addList = (title: string, items: string[]) => {
    if (items.length) sections.push(`${title}:\n${items.map((i) => `- ${i}`).join("\n")}`);
  };
  addList("Execution flow", e.executionFlow);
  addList("Tables read", e.tablesRead);
  addList("Tables modified", e.tablesModified);
  addList("Joins", e.joins);
  addList("Filters", e.filters);
  addList("Conditions", e.conditions);
  addList("Temporary tables", e.temporaryTables);
  if (e.transactions) sections.push(`Transactions:\n${e.transactions}`);
  addList("Nested calls", e.nestedCalls);
  addList("Potential risks", e.risks);
  addList("Assumptions / uncertain interpretations", e.assumptions);
  return sections.join("\n\n");
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
    </div>
  );
}

export function AiExplainPanel({ objectId, noun }: { objectId: string; noun: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ explanation: ObjectExplanation; model: string; provider: string; prompt?: string } | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    const res = await postJson<{ explanation: ObjectExplanation; model: string; provider: string; prompt?: string }>("/api/ai/explain-object", { objectId });
    setLoading(false);
    if (res.ok) setResult(res.data);
    else setError(res.error);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={loading} data-testid="ai-explain">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {result ? "Regenerate explanation" : `Explain this ${noun} with AI`}
        </Button>
        <p className="text-xs text-muted-foreground">Facts come from the deterministic metadata; the AI only explains them.</p>
      </div>
      <ExternalAiNotice />
      {error && <AiErrorNotice error={error} />}
      {result && (
        <div className="surface space-y-4 p-4" data-testid="ai-explanation">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Summary</h3>
            <span className="text-xs text-muted-foreground">AI-generated · {result.provider} / {result.model}</span>
          </div>
          <p className="text-sm">{result.explanation.summary}</p>
          {result.explanation.purpose && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purpose</h4><p className="text-sm">{result.explanation.purpose}</p></div>}
          {result.explanation.parameters.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parameters</h4>
              <ul className="space-y-0.5 text-sm">{result.explanation.parameters.map((p) => <li key={p.name}><code className="font-mono text-xs">{p.name}</code> - {p.explanation}</li>)}</ul>
            </div>
          )}
          <List title="Execution flow" items={result.explanation.executionFlow} />
          <div className="grid gap-4 sm:grid-cols-2">
            <List title="Tables read" items={result.explanation.tablesRead} />
            <List title="Tables modified" items={result.explanation.tablesModified} />
          </div>
          <List title="Joins" items={result.explanation.joins} />
          <List title="Filters" items={result.explanation.filters} />
          <List title="Conditions" items={result.explanation.conditions} />
          <List title="Temporary tables" items={result.explanation.temporaryTables} />
          {result.explanation.transactions && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transactions</h4><p className="text-sm">{result.explanation.transactions}</p></div>}
          <List title="Nested calls" items={result.explanation.nestedCalls} />
          <List title="Potential risks" items={result.explanation.risks} />
          <List title="Assumptions / uncertain interpretations" items={result.explanation.assumptions} />
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-2 text-xs text-muted-foreground">
            {result.prompt && <CopyButton label="Copy prompt" text={result.prompt} testId="copy-explain-prompt" />}
            <CopyButton label="Copy explanation" text={explanationToText(result.explanation)} testId="copy-explain-answer" />
            {result.prompt && <CopyButton label="Copy prompt & answer" text={`Prompt:\n${result.prompt}\n\nAnswer:\n${explanationToText(result.explanation)}`} testId="copy-explain-prompt-answer" />}
          </div>
        </div>
      )}
    </div>
  );
}
