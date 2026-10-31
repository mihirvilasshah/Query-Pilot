"use client";

import { ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface VersionChoice {
  id: string;
  number: number;
  label: string | null;
  createdAt: string;
}

export function VersionPairPicker({ versions, base, target, onBase, onTarget }: { versions: VersionChoice[]; base: string; target: string; onBase: (id: string) => void; onTarget: (id: string) => void }) {
  const render = (v: VersionChoice) => `v${v.number}${v.label ? ` · ${v.label}` : ""} · ${formatDate(v.createdAt)}`;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label>Source (current state)</Label>
        <Select value={base} onValueChange={onBase}>
          <SelectTrigger className="w-72" aria-label="Source version" data-testid="base-version"><SelectValue placeholder="Choose version" /></SelectTrigger>
          <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>{render(v)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <ArrowRight className="mb-2.5 size-4 text-muted-foreground" />
      <div className="space-y-1.5">
        <Label>Target (desired state)</Label>
        <Select value={target} onValueChange={onTarget}>
          <SelectTrigger className="w-72" aria-label="Target version" data-testid="target-version"><SelectValue placeholder="Choose version" /></SelectTrigger>
          <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>{render(v)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}
