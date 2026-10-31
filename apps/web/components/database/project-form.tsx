"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { DATABASE_PLATFORMS } from "@querypilot/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction, updateProjectAction } from "@/lib/actions/projects";
import type { FormState } from "@/lib/redirect";

interface Props {
  project?: { id: string; name: string; description: string | null; platform: string };
  onDone?: () => void;
}

export function ProjectForm({ project, onDone }: Props) {
  const action = project ? updateProjectAction.bind(null, project.id) : createProjectAction;
  const [state, formAction, pending] = useActionState(action, {} as FormState);

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      onDone?.();
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="space-y-4" data-testid="project-form">
      {state.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" defaultValue={project?.name} placeholder="Hospital Pricing Database" required maxLength={120} aria-invalid={!!state.fieldErrors?.name} />
        {state.fieldErrors?.name && <p className="text-xs text-destructive">{state.fieldErrors.name}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="platform">Database platform</Label>
        <Select name="platform" defaultValue={project?.platform ?? "sqlserver"}>
          <SelectTrigger id="platform" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DATABASE_PLATFORMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea id="description" name="description" defaultValue={project?.description ?? ""} rows={3} maxLength={2000} placeholder="What does this database do?" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {project ? "Save changes" : "Create project"}
      </Button>
    </form>
  );
}
