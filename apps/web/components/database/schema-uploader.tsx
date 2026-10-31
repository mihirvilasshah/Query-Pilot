"use client";

import { FileUp, Loader2, ShieldCheck, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, fileExtension, sniffFile } from "@querypilot/shared-validation";
import { ImportJobStatusCard, type JobView } from "@/components/database/import-job-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Phase = "idle" | "validating" | "uploading" | "queueing";

export function SchemaUploader({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [done, setDone] = useState<JobView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const pick = useCallback(async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!fileExtension(f.name)) return setError("Only .dacpac and .sql files are supported.");
    if (f.size === 0) return setError("The file is empty.");
    if (f.size > MAX_UPLOAD_BYTES) return setError(`Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    // content check: never trust the extension
    const head = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
    const sniff = sniffFile(f.name, head);
    if (!sniff.ok) return setError(sniff.error ?? "This file is not valid.");
    setFile(f);
  }, []);

  const upload = async () => {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    try {
      const sign = await fetch("/api/uploads/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, fileName: file.name, fileSize: file.size, label: label || undefined }) });
      const signed = (await sign.json()) as { path?: string; token?: string; error?: { message: string } };
      if (!sign.ok || !signed.path || !signed.token) throw new Error(signed.error?.message ?? "Could not start the upload.");

      const supabase = createClient();
      const up = await supabase.storage.from("schema-uploads").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) throw new Error("Upload failed. Check your connection and try again.");

      setPhase("queueing");
      const complete = await fetch("/api/uploads/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, storagePath: signed.path, fileName: file.name, label: label || undefined }) });
      const result = (await complete.json()) as { jobId?: string; error?: { message: string } };
      if (!complete.ok || !result.jobId) throw new Error(result.error?.message ?? "Could not queue the import.");

      toast.success("Upload complete - processing started");
      setJob({ id: result.jobId, status: "pending", stage: "Queued", progress: 0, file_name: file.name, error_code: null, error_message: null, warnings: [], attempts: 0, max_attempts: 3 });
      setFile(null);
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";

  return (
    <div className="space-y-4">
      {!job && (
        <div className="surface space-y-4 p-5">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a schema file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
            className={cn("flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/40", drag && "border-primary bg-accent/60")}
          >
            <UploadCloud className="mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a file here, or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">{ALLOWED_EXTENSIONS.join(", ")} · up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB · schema only, no data</p>
            <input ref={inputRef} type="file" accept={ALLOWED_EXTENSIONS.join(",")} className="sr-only" data-testid="schema-file-input" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>

          {file && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2" data-testid="selected-file">
              <FileUp className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="Remove file" disabled={busy}><X className="size-4" /></Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="label">Version label <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Updated pricing tables" maxLength={120} disabled={busy} />
          </div>

          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={upload} disabled={!file || busy} data-testid="start-import">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {phase === "uploading" ? "Uploading…" : phase === "queueing" ? "Queueing…" : `Import into “${projectName}”`}
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-success" /> Stored privately. Uploaded SQL is parsed, never executed.</p>
          </div>
        </div>
      )}

      {job && (
        <>
          <ImportJobStatusCard initial={job} onFinished={(j) => { setDone(j); router.refresh(); }} />
          {done && done.status !== "failed" && (
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/database-intelligence">Explore database</Link></Button>
              <Button variant="outline" onClick={() => { setJob(null); setDone(null); }}>Import another version</Button>
            </div>
          )}
          {done?.status === "failed" && <Button variant="outline" onClick={() => { setJob(null); setDone(null); }}>Upload a different file</Button>}
        </>
      )}
    </div>
  );
}
