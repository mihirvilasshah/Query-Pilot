import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getObjectDetail, type ObjectDetail } from "@/lib/data/queries";

/** Loads and validates an object for a detail route; calls notFound() for bad ids / wrong types. */
export async function loadDetail(objectId: string, expected: string): Promise<ObjectDetail> {
  if (!z.uuid().safeParse(objectId).success) notFound();
  const detail = await getObjectDetail(objectId);
  if (!detail || detail.object.object_type !== expected) notFound();
  return detail;
}

export function DetailHeader({ detail, backHref, backLabel, badges, actions }: { detail: ObjectDetail; backHref: string; backLabel: string; badges?: React.ReactNode; actions?: React.ReactNode }) {
  const o = detail.object;
  return (
    <div className="mb-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
        <Link href={`${backHref}?v=${o.version_id}`}><ArrowLeft className="size-4" /> {backLabel}</Link>
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight" data-testid="object-title">
            {o.schema_name && <span className="text-muted-foreground">{o.schema_name}.</span>}{o.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">{o.object_type}</Badge>
            {badges}
            {o.source_file && <span className="text-xs text-muted-foreground">{o.source_file}{o.source_line ? `:${o.source_line}` : ""}</span>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    </div>
  );
}
