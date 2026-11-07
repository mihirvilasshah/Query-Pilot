"use client";

import { CheckCircle2, KeyRound, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PROVIDER_LABELS } from "@querypilot/ai-core";
import type { AiProviderId } from "@querypilot/shared-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { postJson } from "@/lib/ai/client";
import { timeAgo } from "@/lib/format";

interface Config { status: "ready" | "needs_consent" | "not_configured"; provider: AiProviderId; model: string; keySource: "user" | "environment" | null; consent: boolean; allowPaidModels: boolean; keyHint: string | null }
interface Model { id: string; label: string; free: boolean | null }
export interface AiRequestRow { id: string; provider: string; model: string; operation: string; status: string; latency_ms: number | null; error_code: string | null; created_at: string }

const STATUS = { ready: ["success", "Ready"], needs_consent: ["warning", "Consent required"], not_configured: ["muted", "No API key"] } as const;

export function AiSettingsPanel({ initial, encryptionAvailable, requests }: { initial: Config; encryptionAvailable: boolean; requests: AiRequestRow[] }) {
  const [cfg, setCfg] = useState(initial);
  const [provider, setProvider] = useState<AiProviderId>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [customModel, setCustomModel] = useState("");
  const [consent, setConsent] = useState(initial.consent);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; message: string; details: Record<string, unknown> | null } | null>(null);

  const fetchModels = useCallback(async (p: AiProviderId) => {
    const res = await fetch(`/api/ai/models?provider=${p}`);
    if (!res.ok) return null;
    return (await res.json()) as { models: Model[]; source: string; warning?: string };
  }, []);
  const applyModels = (j: { models: Model[]; source: string; warning?: string } | null) => {
    if (!j) return;
    setModels(j.models);
    setModelsNote(j.warning ?? (j.source === "suggested" ? "Showing suggested models. Add an API key to load the live list from the provider." : null));
  };
  useEffect(() => {
    let cancelled = false;
    void fetchModels(provider).then((j) => { if (!cancelled) applyModels(j); });
    return () => { cancelled = true; };
  }, [provider, fetchModels]);

  const saveSettings = async () => {
    setBusy("save");
    const chosen = customModel.trim() || model;
    const res = await fetch("/api/ai/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model: chosen, externalConsent: consent }) });
    const j = (await res.json()) as { config?: Config; error?: { message: string } };
    setBusy(null);
    if (!res.ok || !j.config) return void toast.error(j.error?.message ?? "Could not save");
    setCfg(j.config);
    setModel(j.config.model);
    setCustomModel("");
    toast.success("AI settings saved");
  };

  const validate = async () => {
    setBusy("validate");
    const r = await postJson<{ valid: boolean; message: string; details: Record<string, unknown> | null }>("/api/ai/validate-key", { provider, ...(apiKey ? { apiKey } : {}) });
    setBusy(null);
    if (r.ok) setValidation(r.data); else toast.error(r.error.message);
  };

  const saveKey = async () => {
    setBusy("key");
    const res = await fetch("/api/ai/key", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, apiKey }) });
    const j = (await res.json()) as { error?: { message: string }; config?: Config };
    setBusy(null);
    if (!res.ok) return void toast.error(j.error?.message ?? "Could not save the key");
    setApiKey("");
    if (j.config) {
      setCfg(j.config);
      setProvider(j.config.provider);
      setModel(j.config.model);
    } else {
      const c = await fetch("/api/ai/settings");
      if (c.ok) {
        const next = ((await c.json()) as { config: Config }).config;
        setCfg(next);
        setProvider(next.provider);
        setModel(next.model);
      }
    }
    toast.success("API key validated and stored encrypted");
    void fetchModels(j.config?.provider ?? provider).then(applyModels);
  };

  const removeKey = async () => {
    setBusy("remove");
    const res = await fetch(`/api/ai/key?provider=${provider}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return void toast.error("Could not remove the key");
    toast.success("Stored key removed");
    const c = await fetch("/api/ai/settings");
    if (c.ok) setCfg(((await c.json()) as { config: Config }).config);
  };

  const [variant, label] = STATUS[cfg.status];
  const selectable = models.some((m) => m.id === model) ? models : [{ id: model, label: model, free: null }, ...models];

  return (
    <div className="space-y-6">
      <div className="surface flex flex-wrap items-center gap-4 p-4">
        <div><p className="text-xs text-muted-foreground">Status</p><Badge variant={variant} data-testid="ai-status">{label}</Badge></div>
        <div><p className="text-xs text-muted-foreground">Provider</p><p className="text-sm font-medium">{PROVIDER_LABELS[cfg.provider]}</p></div>
        <div><p className="text-xs text-muted-foreground">Model</p><p className="font-mono text-xs">{cfg.model}</p></div>
        <div><p className="text-xs text-muted-foreground">Key source</p><p className="text-sm">{cfg.keySource === "user" ? `Saved (encrypted) ${cfg.keyHint ?? ""}` : cfg.keySource === "environment" ? "Server environment variable" : "None"}</p></div>
        <p className="ml-auto max-w-xs text-xs text-muted-foreground">AI is optional. Every deterministic feature works without it.</p>
      </div>

      <Alert className="border-warning/40 bg-warning/10">
        <ShieldAlert className="size-4 text-warning" />
        <AlertTitle>Data sent to external AI providers</AlertTitle>
        <AlertDescription>
          When you use an AI feature, the SQL you submit and the relevant, retrieved schema metadata (names, definitions, dependencies) are sent to the selected provider. They are processed under that provider&apos;s own terms and data policy, and free tiers may use submitted data to improve models. Do not enable this for confidential schemas unless that is acceptable to your organisation. Database credentials and row data are never sent.
        </AlertDescription>
      </Alert>

      <div className="surface space-y-5 p-5">
        <h3 className="text-sm font-semibold">Provider & model</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={(v) => { setProvider(v as AiProviderId); setModel(""); setValidation(null); }}>
              <SelectTrigger aria-label="AI provider" data-testid="ai-provider"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="gemini">Google Gemini</SelectItem><SelectItem value="openrouter">OpenRouter (free models)</SelectItem><SelectItem value="groq">Groq</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={(v) => { setModel(v); setCustomModel(""); }}>
              <SelectTrigger aria-label="AI model" data-testid="ai-model"><SelectValue placeholder="Choose a model" /></SelectTrigger>
              <SelectContent className="max-h-72">{selectable.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}{m.free === true ? " · free" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-model">Or enter a model id <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="custom-model" value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={provider === "openrouter" ? "vendor/model:free" : provider === "groq" ? "openai/gpt-oss-120b" : "gemini-2.5-flash"} className="font-mono text-xs" />
          {modelsNote && <p className="text-xs text-muted-foreground">{modelsNote}</p>}
          <p className="text-xs text-muted-foreground">{provider === "openrouter" && !cfg.allowPaidModels ? "Only free (:free) OpenRouter models are allowed; QueryPilot never silently switches to a paid model." : provider === "groq" ? "Groq free-tier limits depend on your Groq account; check your usage in the Groq console." : "Gemini free-tier limits depend on your Google AI Studio project; check your quota there."}</p>
        </div>
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Switch id="consent" checked={consent} onCheckedChange={setConsent} data-testid="ai-consent" />
          <div><Label htmlFor="consent" className="font-medium">I allow SQL and schema metadata to be sent to this provider</Label><p className="text-xs text-muted-foreground">Required before any AI feature runs. You can revoke it at any time.</p></div>
        </div>
        <Button onClick={saveSettings} disabled={busy === "save" || !(customModel.trim() || model)} data-testid="ai-save">{busy === "save" && <Loader2 className="size-4 animate-spin" />} Save AI settings</Button>
      </div>

      <div className="surface space-y-4 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4" /> API key for {PROVIDER_LABELS[provider]}</h3>
        {cfg.keySource === "environment" && cfg.provider === provider && <p className="text-sm text-muted-foreground">A key is configured through the server environment. You can still save a personal key below; it takes precedence.</p>}
        {encryptionAvailable ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg.keyHint ? `Saved key ${cfg.keyHint} — paste a new key to replace` : "Paste API key"} autoComplete="new-password" name="ai-provider-key" aria-label="API key" />
              <Button variant="outline" onClick={validate} disabled={busy === "validate" || (!apiKey && cfg.keySource === null)}>{busy === "validate" && <Loader2 className="size-4 animate-spin" />} Validate</Button>
              <Button onClick={saveKey} disabled={busy === "key" || apiKey.length < 8}>{busy === "key" && <Loader2 className="size-4 animate-spin" />} Save key</Button>
              {cfg.keySource === "user" && <Button variant="ghost" size="icon" onClick={removeKey} aria-label="Remove stored key" disabled={busy === "remove"}><Trash2 className="size-4" /></Button>}
            </div>
            <p className="text-xs text-muted-foreground">Keys are validated, encrypted with AES-256-GCM on the server and never sent back to the browser.</p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Saving personal keys is disabled because <code className="rounded bg-muted px-1">CREDENTIAL_ENCRYPTION_KEY</code> is not set on the server. Configure <code className="rounded bg-muted px-1">GEMINI_API_KEY</code>, <code className="rounded bg-muted px-1">OPENROUTER_API_KEY</code> or <code className="rounded bg-muted px-1">GROQ_API_KEY</code> in the server environment instead (see docs/AI_PROVIDER_SETUP.md).</p>
            <Button variant="outline" onClick={validate} disabled={busy === "validate" || cfg.keySource === null}>{busy === "validate" && <Loader2 className="size-4 animate-spin" />} Validate configured key</Button>
          </div>
        )}
        {validation && (
          <div role="status" className={`rounded-md border p-3 text-sm ${validation.valid ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
            <p className="flex items-center gap-1.5 font-medium">{validation.valid && <CheckCircle2 className="size-4 text-success" />}{validation.message}</p>
            {validation.details && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-xs">{Object.entries(validation.details).filter(([, v]) => v !== null).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}</dl>}
          </div>
        )}
      </div>

      <div className="surface p-5">
        <h3 className="mb-3 text-sm font-semibold">Request history</h3>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">No AI requests yet. Prompts and responses are never stored here, only metadata.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="text-left text-xs text-muted-foreground"><tr>{["When", "Operation", "Model", "Status", "Latency"].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y">{requests.map((r) => <tr key={r.id}><td className="py-1.5 pr-3 text-muted-foreground">{timeAgo(r.created_at)}</td><td className="py-1.5 pr-3">{r.operation}</td><td className="py-1.5 pr-3 font-mono text-xs">{r.model}</td><td className="py-1.5 pr-3"><Badge variant={r.status === "success" ? "success" : r.status === "rate_limited" ? "warning" : "danger"}>{r.status}{r.error_code ? ` · ${r.error_code}` : ""}</Badge></td><td className="py-1.5 tabular-nums">{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
