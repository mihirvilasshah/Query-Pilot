"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateVersionLabelAction } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function versionDisplayLabel(versionNumber: number, label: string | null) {
  return label || (versionNumber === 1 ? "Initial import" : `Import ${versionNumber}`);
}

export function VersionLabelEditor({ versionId, versionNumber, label }: { versionId: string; versionNumber: number; label: string | null }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const display = versionDisplayLabel(versionNumber, label);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <p className="truncate text-sm font-medium">{display}</p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Edit label for version ${versionNumber}`} data-testid={`edit-version-label-${versionNumber}`}>
            <Pencil />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit version label</DialogTitle>
            <DialogDescription>
              Version {versionNumber} stays the same; only the display name changes. Leave the field empty to use the default name.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              start(async () => {
                const result = await updateVersionLabelAction(versionId, form);
                if (result.error) {
                  setError(result.fieldErrors?.label ?? result.error);
                  return;
                }
                toast.success(result.success);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor={`version-label-${versionId}`}>Version label</Label>
              <Input id={`version-label-${versionId}`} name="label" defaultValue={label ?? ""} maxLength={120} placeholder={versionDisplayLabel(versionNumber, null)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending} data-testid="save-version-label">
                {pending && <Loader2 className="size-4 animate-spin" />}
                Save label
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
