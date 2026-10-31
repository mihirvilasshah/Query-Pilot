import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href: string } | React.ReactNode;
  className?: string;
}) {
  const isLink = action && typeof action === "object" && "href" in (action as object) && "label" in (action as object);
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)} data-testid="empty-state">
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="text-base font-medium">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && (
        <div className="mt-5">
          {isLink ? (
            <Button asChild size="sm">
              <Link href={(action as { href: string }).href}>{(action as { label: string }).label}</Link>
            </Button>
          ) : (
            (action as React.ReactNode)
          )}
        </div>
      )}
    </div>
  );
}

export function SectionCard({ title, description, actions, children, className, contentClassName }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; contentClassName?: string }) {
  return (
    <section className={cn("surface", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, icon: Icon, hint }: { label: string; value: React.ReactNode; icon: LucideIcon; hint?: string }) {
  return (
    <div className="surface flex items-center gap-3 p-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs leading-tight text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums leading-tight" data-testid={`stat-${label.toLowerCase().replace(/\W+/g, "-")}`}>{value}</p>
        {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
