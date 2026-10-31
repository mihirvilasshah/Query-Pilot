"use client";

import {
  BookOpen, Copy, Download, FileCode2, FilePlus2, Gauge, History as HistoryIcon, Loader2, Maximize2, Minimize2, Play, Save, Search, Sparkles, Star, Trash2, Wand2, X, CopyPlus, Pencil,
} from "lucide-react";
import { format as formatSql } from "sql-formatter";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SqlOptimization } from "@querypilot/ai-core";
import { SQL_DIALECTS, type SqlDialect } from "@querypilot/shared-types";
import { AiErrorNotice } from "@/components/ai/ai-notices";
import { Markdown } from "@/components/common/markdown";
import { AnalysisView, type AnalysisPayload } from "@/components/sql/analysis-view";
import { MonacoEditor, type EditorInstance } from "@/components/sql/monaco-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { postJson, type ApiFailure } from "@/lib/ai/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

interface ScriptListItem { id: string; project_id: string | null; name: string; description: string | null; dialect: SqlDialect; tags: string[]; category: string | null; is_favorite: boolean; updated_at: string }
interface VersionItem { id: string; version_number: number; name: string; content: string; change_note: string | null; created_at: string }
interface Tab { key: string; id: string | null; name: string; content: string; saved: string; dialect: SqlDialect; tags: string[]; favorite: boolean }

const FORMATTER_LANG: Record<SqlDialect, "transactsql" | "postgresql" | "mysql" | "sqlite"> = { tsql: "transactsql", postgresql: "postgresql", mysql: "mysql", sqlite: "sqlite" };
let draftCounter = 1;
const newDraft = (dialect: SqlDialect, content = ""): Tab => ({ key: `draft-${Date.now()}-${draftCounter}`, id: null, name: `Untitled ${draftCounter++}.sql`, content, saved: "", dialect, tags: [], favorite: false });

type Output =
  | { kind: "analysis"; data: AnalysisPayload }
  | { kind: "explain"; text: string; model: string }
  | { kind: "optimize"; data: SqlOptimization; model: string }
  | { kind: "docs"; text: string; model: string };

async function fetchScriptTab(id: string): Promise<Tab | null> {
  const res = await fetch(`/api/scripts/${id}`);
  if (!res.ok) return null;
  const s = ((await res.json()) as { script: { id: string; name: string; content: string; dialect: SqlDialect; tags: string[]; is_favorite: boolean } }).script;
  return { key: `s-${s.id}`, id: s.id, name: s.name, content: s.content, saved: s.content, dialect: s.dialect, tags: s.tags, favorite: s.is_favorite };
}

function ToolButton({ label, icon, onClick, tip, disabled, testId }: { label: string; icon: React.ReactNode; onClick: () => void; tip?: string; disabled?: boolean; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} data-testid={testId} aria-label={label}>{icon}<span className="hidden xl:inline">{label}</span></Button>
      </TooltipTrigger>
      <TooltipContent>{tip ?? label}</TooltipContent>
    </Tooltip>
  );
}

export function SqlWorkspace({ projectId, versionId, defaultDialect, initialScriptId }: { projectId: string | null; versionId: string | null; defaultDialect: SqlDialect; initialScriptId?: string }) {
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [tabs, setTabs] = useState<Tab[]>(() => [newDraft(defaultDialect)]);
  const [active, setActive] = useState<string>(() => tabs[0]!.key);
  const [search, setSearch] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [aiError, setAiError] = useState<ApiFailure | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [history, setHistory] = useState<VersionItem[] | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const editorRef = useRef<EditorInstance | null>(null);

  const tab = tabs.find((t) => t.key === active) ?? tabs[0]!;
  const dirty = tab.content !== tab.saved;
  const patchTab = useCallback((key: string, patch: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t))), []);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (favOnly) params.set("fav", "1");
    const res = await fetch(`/api/scripts?${params}`);
    if (res.ok) setScripts(((await res.json()) as { scripts: ScriptListItem[] }).scripts);
  }, [search, favOnly]);

  useEffect(() => {
    const t = setTimeout(loadList, 200);
    return () => clearTimeout(t);
  }, [loadList]);

  const openScript = useCallback(async (id: string) => {
    const existing = tabs.find((t) => t.id === id);
    if (existing) return setActive(existing.key);
    const t = await fetchScriptTab(id);
    if (!t) return void toast.error("Could not open that script.");
    setTabs((ts) => [...ts.filter((x) => !(x.id === null && x.content === "" && ts.length === 1)), t]);
    setActive(t.key);
  }, [tabs]);

  useEffect(() => {
    if (!initialScriptId) return;
    let cancelled = false;
    void fetchScriptTab(initialScriptId).then((t) => {
      if (cancelled || !t) return;
      setTabs((ts) => [...ts.filter((x) => !(x.id === null && x.content === "" && ts.length === 1)), t]);
      setActive(t.key);
    });
    return () => { cancelled = true; };
  }, [initialScriptId]);

  const save = useCallback(async (): Promise<void> => {
    setBusy("save");
    try {
      if (!tab.id) {
        const res = await postJson<{ script: { id: string } }>("/api/scripts", { name: tab.name, content: tab.content, dialect: tab.dialect, tags: tab.tags, projectId, isFavorite: tab.favorite });
        if (!res.ok) throw new Error(res.error.message);
        patchTab(tab.key, { id: res.data.script.id, saved: tab.content });
      } else {
        const res = await fetch(`/api/scripts/${tab.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: tab.name, content: tab.content, dialect: tab.dialect, tags: tab.tags, isFavorite: tab.favorite }) });
        if (!res.ok) throw new Error(((await res.json()) as { error: { message: string } }).error.message);
        patchTab(tab.key, { saved: tab.content });
      }
      toast.success("Script saved");
      void loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }, [tab, projectId, patchTab, loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const closeTab = (key: string) => {
    const t = tabs.find((x) => x.key === key);
    if (t && t.content !== t.saved && !window.confirm(`Discard unsaved changes to ${t.name}?`)) return;
    const rest = tabs.filter((x) => x.key !== key);
    const next = rest.length ? rest : [newDraft(defaultDialect)];
    setTabs(next);
    if (active === key) setActive(next[next.length - 1]!.key);
  };

  const formatDoc = () => {
    try {
      const out = formatSql(tab.content, { language: FORMATTER_LANG[tab.dialect], keywordCase: "upper", tabWidth: 2 });
      patchTab(tab.key, { content: out });
      toast.success("Formatted (layout only - this does not validate the SQL)");
    } catch (e) {
      toast.error(`Could not format: ${e instanceof Error ? e.message.split("\n")[0] : "syntax not recognised"}`);
    }
  };

  const selectionOrAll = (): string => {
    const ed = editorRef.current;
    const sel = ed?.getSelection();
    const model = ed?.getModel();
    if (sel && model && !sel.isEmpty()) return model.getValueInRange(sel);
    return tab.content;
  };

  const run = async (kind: "analysis" | "explain" | "optimize" | "docs") => {
    const sql = selectionOrAll();
    if (!sql.trim()) return void toast.error("Write some SQL first.");
    setBusy(kind);
    setAiError(null);
    const base = { sql, dialect: tab.dialect, projectId, versionId };
    if (kind === "analysis") {
      const res = await postJson<{ result: AnalysisPayload }>("/api/analyze", base);
      if (res.ok) setOutput({ kind: "analysis", data: res.data.result });
      else toast.error(res.error.message);
    } else if (kind === "optimize") {
      const res = await postJson<{ optimization: SqlOptimization; model: string }>("/api/ai/optimize-sql", base);
      if (res.ok) setOutput({ kind: "optimize", data: res.data.optimization, model: res.data.model });
      else setAiError(res.error);
    } else {
      const res = await postJson<{ text: string; model: string }>("/api/ai/explain-sql", base);
      if (res.ok) setOutput({ kind: kind === "docs" ? "docs" : "explain", text: res.data.text, model: res.data.model });
      else setAiError(res.error);
    }
    setBusy(null);
  };

  const download = () => {
    const blob = new Blob([tab.content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tab.name.endsWith(".sql") ? tab.name : `${tab.name}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const duplicate = async (id: string) => {
    const res = await postJson<{ script: { id: string } }>("/api/scripts", { duplicateOf: id, name: "copy", content: "", dialect: "tsql", tags: [], isFavorite: false });
    if (res.ok) { toast.success("Duplicated"); await loadList(); void openScript(res.data.script.id); }
    else toast.error(res.error.message);
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this script and its version history?")) return;
    const res = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
    if (!res.ok) return void toast.error("Could not delete");
    setTabs((ts) => { const rest = ts.filter((t) => t.id !== id); return rest.length ? rest : [newDraft(defaultDialect)]; });
    void loadList();
  };

  const toggleFav = async (s: ScriptListItem) => {
    await fetch(`/api/scripts/${s.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ isFavorite: !s.is_favorite }) });
    setTabs((ts) => ts.map((t) => (t.id === s.id ? { ...t, favorite: !s.is_favorite } : t)));
    void loadList();
  };

  const openHistory = async () => {
    if (!tab.id) return void toast.info("Save the script first to start its version history.");
    const res = await fetch(`/api/scripts/${tab.id}/versions`);
    if (res.ok) setHistory(((await res.json()) as { versions: VersionItem[] }).versions);
  };

  const addTag = () => {
    const t = tagInput.trim().slice(0, 40);
    if (t && !tab.tags.includes(t) && tab.tags.length < 20) patchTab(tab.key, { tags: [...tab.tags, t] });
    setTagInput("");
  };

  const filtered = scripts;
  const idle = !busy;

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[260px_1fr]", fullscreen && "fixed inset-0 z-50 bg-background p-4")}>
      {!fullscreen && (
        <aside className="surface flex max-h-[calc(100dvh-10rem)] flex-col overflow-hidden" aria-label="Script library">
          <div className="space-y-2 border-b p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Script library</h2>
              <Button size="icon-sm" variant="ghost" aria-label="New script" onClick={() => { const d = newDraft(defaultDialect); setTabs((ts) => [...ts, d]); setActive(d.key); }}><FilePlus2 className="size-4" /></Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scripts…" className="h-8 pl-8 text-sm" aria-label="Search scripts" />
            </div>
            <Button size="xs" variant={favOnly ? "secondary" : "ghost"} onClick={() => setFavOnly((f) => !f)}><Star className="size-3" /> Favorites</Button>
          </div>
          <ul className="scroll-thin flex-1 divide-y overflow-y-auto" data-testid="script-list">
            {filtered.length === 0 && <li className="p-6 text-center text-xs text-muted-foreground">No saved scripts yet. Write SQL and press Ctrl+S.</li>}
            {filtered.map((s) => (
              <li key={s.id} className={cn("group flex items-start gap-1.5 px-3 py-2 hover:bg-muted/50", tab.id === s.id && "bg-accent/60")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openScript(s.id)}>
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{s.dialect} · {timeAgo(s.updated_at)}</p>
                  {s.tags.length > 0 && <p className="mt-0.5 flex flex-wrap gap-1">{s.tags.slice(0, 3).map((t) => <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px]">{t}</Badge>)}</p>}
                </button>
                <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" aria-label="Toggle favorite" className="p-0.5 text-muted-foreground hover:text-warning" onClick={() => void toggleFav(s)}><Star className={cn("size-3.5", s.is_favorite && "fill-warning text-warning")} /></button>
                  <button type="button" aria-label="Duplicate" className="p-0.5 text-muted-foreground hover:text-foreground" onClick={() => void duplicate(s.id)}><CopyPlus className="size-3.5" /></button>
                  <button type="button" aria-label="Delete" className="p-0.5 text-muted-foreground hover:text-destructive" onClick={() => void remove(s.id)}><Trash2 className="size-3.5" /></button>
                </div>
                {s.is_favorite && <Star className="mt-1 size-3 shrink-0 fill-warning text-warning group-hover:hidden" />}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-end gap-1 overflow-x-auto border-b" role="tablist" aria-label="Open scripts">
          {tabs.map((t) => (
            <div key={t.key} role="tab" aria-selected={t.key === active} className={cn("group flex max-w-[220px] items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm", t.key === active ? "bg-card font-medium" : "bg-muted/40 text-muted-foreground hover:bg-muted")}>
              <button type="button" className="flex min-w-0 items-center gap-1.5" onClick={() => setActive(t.key)}>
                <FileCode2 className="size-3.5 shrink-0" /><span className="truncate">{t.name}</span>{t.content !== t.saved && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unsaved changes" />}
              </button>
              <button type="button" aria-label={`Close ${t.name}`} className="rounded p-0.5 opacity-60 hover:bg-background hover:opacity-100" onClick={() => closeTab(t.key)}><X className="size-3" /></button>
            </div>
          ))}
          <Button size="icon-xs" variant="ghost" className="mb-1" aria-label="New tab" onClick={() => { const d = newDraft(defaultDialect); setTabs((ts) => [...ts, d]); setActive(d.key); }}><FilePlus2 /></Button>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Editor toolbar">
          <Select value={tab.dialect} onValueChange={(v) => patchTab(tab.key, { dialect: v as SqlDialect })}>
            <SelectTrigger size="sm" className="w-44" aria-label="Dialect"><SelectValue /></SelectTrigger>
            <SelectContent>{SQL_DIALECTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <ToolButton label="Format" icon={<Wand2 className="size-4" />} onClick={formatDoc} tip="Format SQL (layout only; it does not check that the SQL is valid)" testId="format-btn" disabled={!idle} />
          <ToolButton label="Explain" icon={<Sparkles className="size-4" />} onClick={() => void run("explain")} tip="Explain with AI (selection or whole script)" disabled={!idle} />
          <ToolButton label="Analyze" icon={busy === "analysis" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} onClick={() => void run("analysis")} tip="Static analysis and risk detection (no AI)" testId="workspace-analyze" disabled={!idle} />
          <ToolButton label="Optimize" icon={<Gauge className="size-4" />} onClick={() => void run("optimize")} tip="Suggest optimizations with AI" disabled={!idle} />
          <ToolButton label="Documentation" icon={<BookOpen className="size-4" />} onClick={() => void run("docs")} tip="Generate documentation with AI" disabled={!idle} />
          <div className="ml-auto flex items-center gap-1.5">
            <ToolButton label="Rename" icon={<Pencil className="size-4" />} onClick={() => setRename(tab.name)} />
            <ToolButton label="History" icon={<HistoryIcon className="size-4" />} onClick={() => void openHistory()} tip="Version history" />
            <ToolButton label="Copy" icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(tab.content); toast.success("Copied"); }} />
            <ToolButton label="Download" icon={<Download className="size-4" />} onClick={download} />
            <Button variant="outline" size="icon-sm" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Exit full screen" : "Full screen editor"}>{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</Button>
            <Button size="sm" onClick={() => void save()} disabled={busy === "save" || (!dirty && !!tab.id)} data-testid="save-btn">{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
          </div>
        </div>

        <MonacoEditor key={tab.key} value={tab.content} onChange={(v) => patchTab(tab.key, { content: v })} path={tab.key} language={SQL_DIALECTS.find((d) => d.value === tab.dialect)?.monaco ?? "sql"} height={fullscreen ? "55dvh" : 420} onMount={(ed) => { editorRef.current = ed; }} />

        <div className="flex flex-wrap items-center gap-2">
          {tab.tags.map((t) => <Badge key={t} variant="secondary" className="gap-1">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => patchTab(tab.key, { tags: tab.tags.filter((x) => x !== t) })}><X className="size-3" /></button></Badge>)}
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())} placeholder="Add tag + Enter" className="h-7 w-40 text-xs" aria-label="Add tag" />
          <p className="ml-auto text-xs text-muted-foreground">SQL is never executed by QueryPilot. Selection is used when text is selected.</p>
        </div>

        {aiError && <AiErrorNotice error={aiError} />}
        {output && (
          <Tabs value="r" className="surface p-4" data-testid="workspace-output">
            <TabsList className="mb-3"><TabsTrigger value="r">{{ analysis: "Analysis", explain: "Explanation", optimize: "Optimization", docs: "Documentation" }[output.kind]}</TabsTrigger></TabsList>
            <TabsContent value="r">
              {output.kind === "analysis" && <AnalysisView analysis={output.data} onJumpToLine={(l) => { editorRef.current?.revealLineInCenter(l); editorRef.current?.setPosition({ lineNumber: l, column: 1 }); editorRef.current?.focus(); }} />}
              {(output.kind === "explain" || output.kind === "docs") && (
                <div>
                  <Markdown>{output.text}</Markdown>
                  <p className="mt-3 text-xs text-muted-foreground">AI-generated · {output.model}. Verify before relying on it.</p>
                </div>
              )}
              {output.kind === "optimize" && (
                <div className="space-y-3 text-sm">
                  {output.data.optimizedSql && <MonacoEditor value={output.data.optimizedSql} readOnly height={Math.min(360, 40 + output.data.optimizedSql.split("\n").length * 19)} />}
                  {output.data.optimizedSql && <Button size="sm" variant="outline" onClick={() => patchTab(tab.key, { content: output.data.optimizedSql })}>Replace editor content</Button>}
                  {output.data.changes.length > 0 && <div><p className="font-medium">Changes</p><ul className="list-disc pl-5">{output.data.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                  {output.data.indexSuggestions.length > 0 && <div><p className="font-medium">Index suggestions</p><ul className="list-disc pl-5">{output.data.indexSuggestions.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                  {output.data.caveats.length > 0 && <div><p className="font-medium">Caveats</p><ul className="list-disc pl-5 text-muted-foreground">{output.data.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                  <p className="text-xs text-muted-foreground">AI-generated suggestions without execution plans or statistics are hypotheses. · {output.model}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename script</DialogTitle><DialogDescription>The new name is saved with the next save.</DialogDescription></DialogHeader>
          <Input value={rename ?? ""} onChange={(e) => setRename(e.target.value)} maxLength={200} aria-label="Script name" autoFocus />
          <DialogFooter><Button onClick={() => { if (rename?.trim()) patchTab(tab.key, { name: rename.trim() }); setRename(null); }}>Rename</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={history !== null} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>Every save creates an immutable version. Restoring loads it into the editor; save to keep it.</DialogDescription></DialogHeader>
          <ul className="scroll-thin max-h-96 divide-y overflow-y-auto rounded-lg border">
            {history?.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Badge variant="secondary">v{v.version_number}</Badge>
                <span className="min-w-0 flex-1"><span className="block truncate">{v.change_note ?? "Edited"}</span><span className="text-xs text-muted-foreground">{timeAgo(v.created_at)} · {v.content.split("\n").length} lines</span></span>
                <Button size="sm" variant="outline" onClick={() => { patchTab(tab.key, { content: v.content, name: v.name }); setHistory(null); toast.success(`Restored v${v.version_number} (unsaved)`); }}>Restore</Button>
              </li>
            ))}
            {history?.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No versions yet.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
