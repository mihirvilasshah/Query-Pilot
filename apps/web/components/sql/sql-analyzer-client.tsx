"use client";

import { FileUp, Loader2, Play, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { SQL_DIALECTS, type SqlDialect } from "@querypilot/shared-types";
import { AnalysisView, type AnalysisPayload } from "@/components/sql/analysis-view";
import { MonacoEditor, type EditorInstance } from "@/components/sql/monaco-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { postJson } from "@/lib/ai/client";
import { toast } from "sonner";

const SAMPLE = `-- Example: try Analyze to see static risk detection
BEGIN TRANSACTION;

UPDATE dbo.Customer
SET Status = 'Inactive';

DELETE FROM dbo.OrderArchive;

DECLARE @sql nvarchar(max) = N'SELECT * FROM dbo.Orders WHERE Region = ''' + @region + N'''';
EXEC (@sql);
`;

type Resp = { analysisId: string | null; result: AnalysisPayload; ai?: { supplement?: never; error?: { code: string; message: string } } };

export function SqlAnalyzerClient({ projectId, defaultDialect }: { projectId: string | null; defaultDialect: SqlDialect }) {
  const [sql, setSql] = useState("");
  const [dialect, setDialect] = useState<SqlDialect>(defaultDialect);
  const [withAi, setWithAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = async () => {
    if (!sql.trim()) return setError("Paste or upload some SQL first.");
    setLoading(true);
    setError(null);
    const res = await postJson<Resp>("/api/analyze", { sql, dialect, projectId, withAi });
    setLoading(false);
    if (res.ok) setData(res.data);
    else setError(res.error.message);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.sql$/i.test(f.name)) return toast.error("Only .sql files can be analysed here.");
    if (f.size > 2 * 1024 * 1024) return toast.error("Files are limited to 2 MB for analysis.");
    const text = await f.text();
    if (text.includes("\u0000")) return toast.error("That file looks binary, not SQL.");
    setSql(text);
    toast.success(`Loaded ${f.name}`);
  };

  const jump = (line: number) => {
    editorRef.current?.revealLineInCenter(line);
    editorRef.current?.setPosition({ lineNumber: line, column: 1 });
    editorRef.current?.focus();
  };

  return (
    <div className="space-y-5">
      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={dialect} onValueChange={(v) => setDialect(v as SqlDialect)}>
            <SelectTrigger className="w-52" aria-label="SQL dialect"><SelectValue /></SelectTrigger>
            <SelectContent>{SQL_DIALECTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
          </Select>
          <input ref={fileRef} type="file" accept=".sql,text/plain" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><FileUp className="size-4" /> Upload .sql</Button>
          <Button variant="ghost" size="sm" onClick={() => setSql(SAMPLE)}>Load example</Button>
          <div className="ml-auto flex items-center gap-2">
            <Switch id="ai" checked={withAi} onCheckedChange={setWithAi} />
            <Label htmlFor="ai" className="flex items-center gap-1 font-normal"><Sparkles className="size-3.5 text-primary" /> AI supplement</Label>
          </div>
          <Button onClick={analyze} disabled={loading} data-testid="analyze-btn">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Analyze
          </Button>
        </div>
        <MonacoEditor value={sql} onChange={setSql} height={320} path="analyzer.sql" language={SQL_DIALECTS.find((d) => d.value === dialect)?.monaco ?? "sql"} onMount={(ed) => { editorRef.current = ed; }} />
        <p className="text-xs text-muted-foreground">SQL is analysed, never executed. {withAi && "The AI supplement sends this SQL to your configured external AI provider."}</p>
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
      {data && <AnalysisView analysis={data.result} ai={data.ai as never} onJumpToLine={jump} />}
    </div>
  );
}
