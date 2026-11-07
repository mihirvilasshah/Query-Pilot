"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Small inline copy action with a transient "Copied" state. */
export function CopyButton({ label, text, testId, className }: { label: string; text: string; testId?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => toast.error("Could not copy to the clipboard"));
  };
  return (
    <button type="button" onClick={copy} aria-label={label} data-testid={testId} className={cn("flex items-center gap-1 hover:text-foreground", className)}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
