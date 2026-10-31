import { Suspense } from "react";
import { PageHeader } from "@/components/common/page";
import { VersionSwitcher } from "@/components/database/version-switcher";
import type { ProjectContext } from "@/lib/data/queries";
import { isReady } from "@/lib/data/queries";

/** Page header used by all Database Intelligence pages: title + project/version context + actions. */
export function DbHeader({ ctx, title, description, actions }: { ctx: ProjectContext; title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  const ready = ctx.versions.filter(isReady);
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <>
          {ctx.version && (
            <Suspense fallback={null}>
              <VersionSwitcher versions={ready.map((v) => ({ id: v.id, number: v.version_number, label: v.label, createdAt: v.created_at }))} currentId={ctx.version.id} />
            </Suspense>
          )}
          {actions}
        </>
      }
    />
  );
}
