"use client";

import { toPng, toSvg } from "html-to-image";
import { Download } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cssVarToHex } from "@/lib/css-colors";

/** Exports the React Flow viewport inside `container` as PNG or SVG using the current theme background. */
export function ExportMenu({ containerId, fileName }: { containerId: string; fileName: string }) {
  const run = useCallback(
    async (format: "png" | "svg") => {
      const root = document.getElementById(containerId);
      const viewport = root?.querySelector<HTMLElement>(".react-flow__viewport");
      if (!root || !viewport) return void toast.error("Nothing to export yet.");
      try {
        const bg = cssVarToHex("--background", "#ffffff");
        const opts = { backgroundColor: bg, filter: (n: HTMLElement) => !n.classList?.contains("react-flow__minimap") && !n.classList?.contains("react-flow__controls"), pixelRatio: 2 };
        // Export the whole root so edges/nodes keep their current transform; viewport fits the visible area.
        const dataUrl = format === "png" ? await toPng(root, opts) : await toSvg(root, opts);
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${fileName}.${format}`;
        a.click();
        toast.success(`Exported ${format.toUpperCase()}`);
      } catch {
        toast.error("Export failed. Try fitting the diagram to the screen first.");
      }
    },
    [containerId, fileName],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm"><Download className="size-4" /> Export</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run("png")}>PNG image</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("svg")}>SVG vector</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
