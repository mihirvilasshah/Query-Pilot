"use client";

import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { cssVarToHex } from "@/lib/css-colors";
import { cn } from "@/lib/utils";

type Monaco = Parameters<BeforeMount>[0];
export type EditorInstance = Parameters<OnMount>[0];

/** Builds Monaco themes from the design tokens so the editor always matches the app theme. */
export function defineQueryPilotThemes(monaco: Monaco) {
  const dark = document.documentElement.classList.contains("dark");
  const bg = cssVarToHex("--card", dark ? "#18181b" : "#ffffff");
  const fg = cssVarToHex("--foreground", dark ? "#f4f4f5" : "#18181b");
  const muted = cssVarToHex("--muted-foreground", "#71717a");
  const border = cssVarToHex("--border", "#e4e4e7");
  const accent = cssVarToHex("--accent", "#eef");
  const primary = cssVarToHex("--primary", "#6366f1");
  const success = cssVarToHex("--success", "#22c55e");
  const warning = cssVarToHex("--warning", "#eab308");
  const info = cssVarToHex("--info", "#0ea5e9");
  const strip = (h: string) => h.replace("#", "");
  monaco.editor.defineTheme("qp", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: strip(primary), fontStyle: "bold" },
      { token: "keyword.sql", foreground: strip(primary), fontStyle: "bold" },
      { token: "operator.sql", foreground: strip(muted) },
      { token: "string", foreground: strip(success) },
      { token: "string.sql", foreground: strip(success) },
      { token: "number", foreground: strip(warning) },
      { token: "comment", foreground: strip(muted), fontStyle: "italic" },
      { token: "predefined.sql", foreground: strip(info) },
    ],
    colors: {
      "editor.background": bg,
      "editor.foreground": fg,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": fg,
      "editor.lineHighlightBackground": accent,
      "editor.lineHighlightBorder": "#00000000",
      "editorWidget.background": bg,
      "editorWidget.border": border,
      "editorGutter.background": bg,
      "editor.selectionBackground": `${accent}`,
      "editorCursor.foreground": primary,
      "scrollbarSlider.background": `${border}aa`,
    },
  });
}

export interface MonacoEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  height?: string | number;
  className?: string;
  onMount?: OnMount;
  /** Stable identifier so multiple tabs keep separate models/undo history. */
  path?: string;
  minimal?: boolean;
}

export function MonacoEditor({ value, onChange, language = "sql", readOnly = false, height = 360, className, onMount, path, minimal = false }: MonacoEditorProps) {
  const { resolvedTheme } = useTheme();
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    if (!monacoRef.current) return;
    // wait a frame so the `dark` class and CSS variables have updated
    const id = requestAnimationFrame(() => {
      defineQueryPilotThemes(monacoRef.current!);
      monacoRef.current!.editor.setTheme("qp");
    });
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  return (
    <div className={cn("overflow-hidden rounded-lg border", className)} data-testid="monaco">
      <Editor
        height={height}
        language={language}
        value={value}
        path={path}
        onChange={(v) => onChange?.(v ?? "")}
        beforeMount={(monaco) => {
          monacoRef.current = monaco;
          defineQueryPilotThemes(monaco);
        }}
        onMount={(editor, monaco) => {
          monaco.editor.setTheme("qp");
          onMount?.(editor, monaco);
        }}
        theme="qp"
        loading={<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading editor…</div>}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "var(--font-mono), ui-monospace, Menlo, Consolas, monospace",
          lineNumbers: minimal ? "off" : "on",
          folding: true,
          scrollBeyondLastLine: false,
          wordWrap: readOnly ? "on" : "off",
          automaticLayout: true,
          renderLineHighlight: readOnly ? "none" : "line",
          padding: { top: 10, bottom: 10 },
          scrollbar: { alwaysConsumeMouseWheel: false },
          tabSize: 2,
          find: { addExtraSpaceOnTop: false },
        }}
      />
    </div>
  );
}

/** Lightweight read-only viewer for SQL definitions: auto-sizes to content up to a max height. */
export function SqlViewer({ value, maxHeight = 520, className }: { value: string; maxHeight?: number; className?: string }) {
  const lines = value.split("\n").length;
  const height = Math.min(maxHeight, Math.max(80, lines * 19 + 24));
  return <MonacoEditor value={value} readOnly height={height} className={className} language="sql" />;
}
