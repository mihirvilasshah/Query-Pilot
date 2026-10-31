"use client";

import { FileCode2, Loader2, Search, Table2, Workflow, Layers, SquareFunction, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface Hit {
  kind: "table" | "view" | "procedure" | "function" | "trigger" | "script";
  id: string;
  label: string;
  href: string;
}

const ICONS = { table: Table2, view: Layers, procedure: Workflow, function: SquareFunction, trigger: Zap, script: FileCode2 };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset results when the query is cleared
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (res.ok) setHits(((await res.json()) as { hits: Hit[] }).hits);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const grouped = {
    "Database objects": hits.filter((h) => h.kind !== "script"),
    "SQL scripts": hits.filter((h) => h.kind === "script"),
  };

  return (
    <>
      <Button variant="outline" size="sm" className="w-9 justify-start gap-2 px-0 text-muted-foreground sm:w-64 sm:px-3" onClick={() => setOpen(true)} aria-label="Search" data-testid="global-search">
        <Search className="mx-auto size-4 sm:mx-0" />
        <span className="hidden flex-1 text-left font-normal sm:inline">Search objects, scripts…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search database objects and SQL scripts">
        <CommandInput placeholder="Search tables, procedures, scripts…" value={q} onValueChange={setQ} />
        <CommandList>
          {loading && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </div>
          )}
          {!loading && q.trim().length >= 2 && hits.length === 0 && <CommandEmpty>No results in the current project.</CommandEmpty>}
          {q.trim().length < 2 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters.</p>}
          {Object.entries(grouped).map(([heading, list]) =>
            list.length ? (
              <CommandGroup key={heading} heading={heading}>
                {list.map((h) => {
                  const Icon = ICONS[h.kind];
                  return (
                    <CommandItem
                      key={`${h.kind}-${h.id}`}
                      value={`${h.kind}-${h.id}-${h.label}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(h.href);
                      }}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{h.label}</span>
                      <span className="text-xs text-muted-foreground">{h.kind}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null,
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
