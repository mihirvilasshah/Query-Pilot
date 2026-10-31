import { Download, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImportJobStatusCard, type JobView } from "@/components/database/import-job-status";
import { formatDate } from "@/lib/format";
import type { ImportJobRow, VersionRow } from "@/lib/data/types";

const STATUS_VARIANT = { pending: "muted", ready: "success", ready_with_warnings: "warning", failed: "danger" } as const;
const STATUS_LABEL = { pending: "Processing", ready: "Ready", ready_with_warnings: "Ready (warnings)", failed: "Failed" } as const;

export function VersionsTable({ versions, jobs, projectId }: { versions: VersionRow[]; jobs: ImportJobRow[]; projectId: string }) {
  const jobByVersion = new Map(jobs.map((j) => [j.version_id, j]));
  return (
    <ul className="divide-y" data-testid="versions-list">
      {versions.map((v) => {
        const job = jobByVersion.get(v.id);
        const ready = v.status === "ready" || v.status === "ready_with_warnings";
        const c = v.summary.counts;
        return (
          <li key={v.id} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Badge variant="secondary" className="shrink-0">v{v.version_number}</Badge>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.label || (v.version_number === 1 ? "Initial import" : `Import ${v.version_number}`)}</p>
                  <p className="truncate text-xs text-muted-foreground">{v.source_type.toUpperCase()} · {v.source_file_name} · {formatDate(v.created_at, true)}</p>
                </div>
              </div>
              {c && ready && <p className="text-xs text-muted-foreground">{c.tables} tables · {c.views} views · {c.procedures} procs · {c.functions} funcs · {c.dependencies} deps</p>}
              <Badge variant={STATUS_VARIANT[v.status]}>{STATUS_LABEL[v.status]}</Badge>
              {ready && (
                <div className="flex gap-1.5">
                  <Button asChild variant="outline" size="sm"><Link href={`/database-intelligence?v=${v.id}`}>Open</Link></Button>
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Download documentation"><a href={`/api/docs/${v.id}`}><Download className="size-4" /></a></Button>
                </div>
              )}
            </div>
            {job && (v.status === "failed" || v.status === "pending" || job.warnings.length > 0) && (
              <ImportJobStatusCard compact initial={toJobView(job)} />
            )}
          </li>
        );
      })}
      {versions.filter((v) => v.status === "ready" || v.status === "ready_with_warnings").length >= 2 && (
        <li className="px-4 py-3">
          <Button asChild variant="outline" size="sm"><Link href={`/schema-comparison?project=${projectId}`}><GitCompareArrows className="size-4" /> Compare versions</Link></Button>
        </li>
      )}
    </ul>
  );
}

export function toJobView(j: ImportJobRow): JobView {
  return { id: j.id, status: j.status, stage: j.stage, progress: j.progress, file_name: j.file_name, error_code: j.error_code, error_message: j.error_message, warnings: j.warnings ?? [], attempts: j.attempts, max_attempts: j.max_attempts };
}
