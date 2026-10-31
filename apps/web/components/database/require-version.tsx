import type { ProjectContext } from "@/lib/data/queries";
import { EmptyState } from "@/components/common/page";
import { FolderGit2, PlugZap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Standard guard for every page that needs an imported schema.
 * Returns the element to render when there is no project / no ready version, otherwise null.
 */
export function RequireVersion({ ctx }: { ctx: ProjectContext }) {
  if (!ctx.project) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="Create a project first"
        description="A project represents one logical database. Create one, then import a DACPAC or SQL DDL script."
        action={<Button asChild size="sm"><Link href="/projects?new=1">Create project</Link></Button>}
      />
    );
  }
  if (!ctx.version) {
    const pending = ctx.versions.some((v) => v.status === "pending");
    return (
      <EmptyState
        icon={PlugZap}
        title={pending ? "Your import is still processing" : "No schema imported yet"}
        description={pending ? "The processing worker is analysing your upload. This page will be available as soon as it finishes." : `Import a .dacpac or .sql file into “${ctx.project.name}” to explore it here.`}
        action={{ label: pending ? "View import status" : "Import schema", href: pending ? "/database-intelligence/versions" : "/database-intelligence/import" }}
      />
    );
  }
  return null;
}
