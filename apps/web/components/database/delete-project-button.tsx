"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteProjectAction } from "@/lib/actions/projects";

export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="size-4" /> Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            This permanently deletes the project, all imported schema versions, uploaded files, comparisons and migration plans. SQL scripts that were linked to it are kept but unlinked. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteProjectAction(projectId);
                if (res.error) return void toast.error(res.error);
                toast.success("Project deleted");
                router.push("/projects");
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
