"use client";

import { updateProfileAction, updatePreferencesAction } from "@/lib/actions/preferences";
import { Loader2 } from "lucide-react";
import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { SQL_DIALECTS } from "@querypilot/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { FormState } from "@/lib/redirect";

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, {} as FormState);
  useEffect(() => { if (state.success) toast.success(state.success); }, [state.success]);
  return (
    <form action={action} className="max-w-md space-y-4">
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="space-y-1.5"><Label htmlFor="displayName">Display name</Label><Input id="displayName" name="displayName" defaultValue={displayName} required maxLength={80} /></div>
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" value={email} readOnly disabled /></div>
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Save profile</Button>
    </form>
  );
}

export function PreferencesForm({ defaultDialect }: { defaultDialect: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="max-w-md space-y-5">
      <div className="space-y-1.5">
        <Label>Theme</Label>
        <div className="flex items-center gap-3"><ThemeToggle /><p className="text-xs text-muted-foreground">Light, dark or follow your operating system. Your choice is remembered on this device.</p></div>
      </div>
      <div className="space-y-1.5">
        <Label>Default SQL dialect</Label>
        <Select defaultValue={defaultDialect} onValueChange={(v) => start(async () => { const r = await updatePreferencesAction(v); if (r.error) toast.error(r.error); else toast.success("Preference saved"); })} disabled={pending}>
          <SelectTrigger className="w-64" aria-label="Default dialect"><SelectValue /></SelectTrigger>
          <SelectContent>{SQL_DIALECTS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}
