"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IMPORT_STATUS_LABELS, type ImportJobStatus, type ImportWarning } from "@querypilot/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface JobView {
  id: string;
  status: ImportJobStatus;
  stage: string | null;
  progress: number;
  file_name: string;
  error_code: string | null;
  error_message: string | null;
  warnings: ImportWarning[];
  attempts: number;
  max_attempts: number;
}

const ACTIVE: ImportJobStatus[] = ["pending", "validating", "processing"];
export const isActiveJob = (s: ImportJobStatus) => ACTIVE.includes(s);

const VARIANT = {
  pending: "muted", validating: "info", processing: "info", completed: "success", completed_with_warnings: "warning", failed: "danger",
} as const;

export function ImportJobStatusCard({ initial, compact = false, onFinished }: { initial: JobView; compact?: boolean; onFinished?: (job: JobView) => void }) {
  const [job, setJob] = useState(initial);
  const [showWarnings, setShowWarnings] = useState(false);
  const finished = useRef(!isActiveJob(initial.status));

  const poll = useCallback(async () => {
    const res = await fetch(`/api/import-jobs/${job.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = ((await res.json()) as { job: JobView }).job;
    setJob(next);
    if (!isActiveJob(next.status) && !finished.current) {
      finished.current = true;
      onFinished?.(next);
    }
  }, [job.id, onFinished]);

  useEffect(() => {
    if (!isActiveJob(job.status)) return;
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [job.status, poll]);

  const retry = async () => {
    const res = await fetch(`/api/import-jobs/${job.id}/retry`, { method: "POST" });
    if (!res.ok) return void toast.error("Could not retry the import.");
    finished.current = false;
    setJob({ ...job, status: "pending", progress: 0, stage: "Queued", error_message: null, error_code: null });
    toast.success("Import queued again");
  };

  const active = isActiveJob(job.status);
  const Icon = active ? Loader2 : job.status === "failed" ? CircleAlert : job.status === "completed_with_warnings" ? AlertTriangle : CheckCircle2;

  return (
    <div className={cn("rounded-lg border p-3", !compact && "surface p-4")} data-testid="import-job" data-status={job.status}>
      <div className="flex items-center gap-3">
        <Icon className={cn("size-4 shrink-0", active && "animate-spin text-info", job.status === "failed" && "text-destructive", job.status === "completed" && "text-success", job.status === "completed_with_warnings" && "text-warning")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{job.file_name}</p>
          <p className="text-xs text-muted-foreground">{active ? (job.stage ?? "Waiting for the processing worker…") : job.status === "failed" ? "Import failed" : "Import finished"}</p>
        </div>
        <Badge variant={VARIANT[job.status]}>{IMPORT_STATUS_LABELS[job.status]}</Badge>
      </div>
      {active && <Progress value={job.progress} className="mt-3 h-1.5" aria-label="Import progress" />}
      {active && job.status === "pending" && (
        <p className="mt-2 text-xs text-muted-foreground">Queued. If this stays pending, the processing worker is not running — see docs/PROCESSING_WORKER.md.</p>
      )}
      {job.status === "failed" && (
        <div className="mt-3 space-y-2">
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{job.error_message ?? "The import failed."}{job.error_code && <span className="ml-1 font-mono text-xs opacity-70">({job.error_code})</span>}</p>
          <Button size="sm" variant="outline" onClick={retry}><RotateCcw className="size-3.5" /> Retry import</Button>
        </div>
      )}
      {job.warnings.length > 0 && !active && (
        <div className="mt-3">
          <button type="button" className="text-xs font-medium text-warning-foreground underline-offset-2 hover:underline dark:text-warning" onClick={() => setShowWarnings((s) => !s)}>
            {job.warnings.length} warning{job.warnings.length === 1 ? "" : "s"} {showWarnings ? "▲" : "▼"}
          </button>
          {showWarnings && (
            <ul className="scroll-thin mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs">
              {job.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <code className="shrink-0 font-mono text-muted-foreground">{w.code}</code>
                  <span>{w.message}{w.file ? ` (${w.file}${w.line ? `:${w.line}` : ""})` : w.line ? ` (line ${w.line})` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
