"use client";

import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectForm } from "./project-form";

export function NewProjectDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && defaultOpen) router.replace("/projects");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" data-testid="new-project">
          <FolderPlus className="size-4" /> New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New database project</DialogTitle>
          <DialogDescription>A project represents one logical database. You can import multiple schema versions into it.</DialogDescription>
        </DialogHeader>
        <ProjectForm />
      </DialogContent>
    </Dialog>
  );
}
