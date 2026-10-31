"use client";

import { Bell, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IMPORT_STATUS_LABELS, type ImportJobStatus } from "@querypilot/shared-types";
import { timeAgo } from "@/lib/format";

export interface NotificationJob {
  id: string;
  file_name: string;
  status: ImportJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function StatusIcon({ status }: { status: ImportJobStatus }) {
  if (status === "completed") return <CheckCircle2 className="size-4 text-success" />;
  if (status === "completed_with_warnings") return <CheckCircle2 className="size-4 text-warning" />;
  if (status === "failed") return <CircleAlert className="size-4 text-destructive" />;
  return <Loader2 className="size-4 animate-spin text-info" />;
}

export function Notifications({ jobs }: { jobs: NotificationJob[] }) {
  const [now] = useState(() => Date.now());
  const active = jobs.filter((j) => ["pending", "validating", "processing"].includes(j.status)).length;
  const failed = jobs.filter((j) => j.status === "failed" && now - new Date(j.updated_at).getTime() < 86_400_000).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {(active > 0 || failed > 0) && <span className={`absolute right-2 top-2 size-2 rounded-full ${failed ? "bg-destructive" : "bg-info"}`} />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5 text-sm font-medium">Import activity</div>
        {jobs.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <StatusIcon status={j.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{j.file_name}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(j.updated_at)}</p>
                  {j.error_message && <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{j.error_message}</p>}
                </div>
                <Badge variant={j.status === "failed" ? "danger" : j.status === "completed" ? "success" : j.status === "completed_with_warnings" ? "warning" : "info"}>{IMPORT_STATUS_LABELS[j.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2">
          <Link href="/database-intelligence/versions" className="text-xs font-medium text-primary hover:underline">
            View all imports
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
