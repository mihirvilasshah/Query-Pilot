"use client";

import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";
import { cssVarToHex } from "@/lib/css-colors";

/** Renders a Mermaid diagram with colours taken from the design tokens (re-renders on theme change). */
export function MermaidDiagram({ chart, className }: { chart: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // wait a frame so theme CSS variables have updated before reading them
    const raf = requestAnimationFrame(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const c = (n: string, f: string) => cssVarToHex(n, f);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: c("--card", "#fff"),
            primaryColor: c("--accent", "#eef"),
            primaryTextColor: c("--foreground", "#111"),
            primaryBorderColor: c("--primary", "#66f"),
            lineColor: c("--muted-foreground", "#888"),
            secondaryColor: c("--secondary", "#eee"),
            tertiaryColor: c("--card", "#fff"),
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: "13px",
          },
        });
        const { svg } = await mermaid.render(`mmd-${id}-${resolvedTheme ?? "x"}`, chart);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render the diagram.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [chart, resolvedTheme, id]);

  return (
    <div className={className}>
      {loading && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Rendering diagram…</div>}
      {error && <p className="text-sm text-destructive">Diagram could not be rendered: {error}</p>}
      <div ref={ref} className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full" data-testid="mermaid" />
    </div>
  );
}
