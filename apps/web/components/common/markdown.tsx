"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Renders AI/Markdown output safely (raw HTML is not rendered) with design-token styling. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...p} />,
          h2: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...p} />,
          h3: (p) => <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0" {...p} />,
          p: (p) => <p className="my-2" {...p} />,
          ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
          a: (p) => <a className="text-primary underline" target="_blank" rel="noopener noreferrer" {...p} />,
          code: ({ className: c, children: ch, ...rest }) =>
            /language-/.test(c ?? "") ? (
              <code className={cn("block overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs", c)} {...rest}>{ch}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...rest}>{ch}</code>
            ),
          pre: (p) => <pre className="my-2 overflow-x-auto" {...p} />,
          table: (p) => <div className="my-2 overflow-x-auto"><table className="w-full text-xs" {...p} /></div>,
          th: (p) => <th className="border-b px-2 py-1 text-left font-medium" {...p} />,
          td: (p) => <td className="border-b px-2 py-1" {...p} />,
          blockquote: (p) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
