"use client";

import { Check, ChevronsUpDown, FolderPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { selectProjectAction } from "@/lib/actions/projects";

export interface ProjectOption {
  id: string;
  name: string;
}

export function ProjectSelector({ projects, currentId }: { projects: ProjectOption[]; currentId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = projects.find((p) => p.id === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[220px] justify-between gap-2" disabled={pending} data-testid="project-selector">
          <span className="truncate">{current?.name ?? "No project"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Current project</DropdownMenuLabel>
        {projects.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">You have no projects yet.</p>}
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() =>
              start(async () => {
                await selectProjectAction(p.id);
                router.refresh();
              })
            }
          >
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === currentId && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/projects?new=1">
            <FolderPlus className="size-4" /> New project
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
