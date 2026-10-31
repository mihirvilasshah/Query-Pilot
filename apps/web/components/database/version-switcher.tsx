"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";

export interface VersionOption {
  id: string;
  number: number;
  label: string | null;
  createdAt: string;
}

/** Switches the schema version being explored by updating the `v` query parameter. */
export function VersionSwitcher({ versions, currentId }: { versions: VersionOption[]; currentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (versions.length <= 1) {
    const only = versions[0];
    return only ? <span className="text-xs text-muted-foreground">Version {only.number} · {formatDate(only.createdAt)}</span> : null;
  }
  return (
    <Select
      value={currentId}
      onValueChange={(id) => {
        const next = new URLSearchParams(params.toString());
        next.set("v", id);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      <SelectTrigger size="sm" className="w-[230px]" aria-label="Schema version" data-testid="version-switcher">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            v{v.number}{v.label ? ` · ${v.label}` : ""} · {formatDate(v.createdAt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
