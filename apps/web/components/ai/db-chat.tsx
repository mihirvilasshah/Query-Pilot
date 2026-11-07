"use client";

import { Bot, Check, ChevronDown, Copy, Info, Loader2, Plus, Send, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DatabaseAnswer } from "@querypilot/ai-core";
import { AiErrorNotice, ExternalAiNotice } from "@/components/ai/ai-notices";
import { Markdown } from "@/components/common/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postJson, type ApiFailure } from "@/lib/ai/client";
import { objectHref } from "@/lib/object-links";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: DatabaseAnswer;
  verified?: { id: string; type: string; fullName: string }[];
  unverified?: string[];
  reasons?: { fullName: string; reason: string }[];
  truncated?: boolean;
  model?: string;
  provider?: string;
}

interface ChatResp {
  conversationId: string | null; messageId: string | null; answer: DatabaseAnswer;
  verifiedObjects: { id: string; type: string; fullName: string }[]; unverifiedNames: string[];
  matchReasons: { fullName: string; reason: string }[]; contextTruncated: boolean; model: string; provider: string;
}

const SUGGESTIONS = [
  "Explain the complete database architecture",
  "Which stored procedures modify tables?",
  "Which tables have no foreign keys?",
  "Find all procedures that use dynamic SQL",
  "Explain how the pricing-related objects work together",
];

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
    </div>
  );
}

/** Plain-text rendering of a structured answer, used by "Copy prompt & answer". */
function answerToText(a: DatabaseAnswer): string {
  const sections: string[] = [`Summary:\n${a.summary}`];
  const addList = (title: string, items: string[]) => {
    if (items.length) sections.push(`${title}:\n${items.map((i) => `- ${i}`).join("\n")}`);
  };
  if (a.explanation) sections.push(`Detailed explanation:\n${a.explanation}`);
  addList("Relevant database objects", a.relevantObjects.map((o) => `${o.name}${o.type ? ` (${o.type})` : ""}${o.reason ? ` — ${o.reason}` : ""}`));
  addList("Tables referenced", a.tablesReferenced);
  addList("Columns referenced", a.columnsReferenced);
  addList("Dependencies", a.dependencies);
  addList("Potential risks", a.risks);
  addList("Recommendations", a.recommendations);
  addList("Assumptions & uncertain interpretations", a.assumptions);
  return sections.join("\n\n");
}

function CopyButton({ label, text, testId, className }: { label: string; text: string; testId?: string; className?: string }) {
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

function AssistantMessage({ m, question }: { m: ChatMessage; question?: string }) {
  const a = m.answer;
  const [showCtx, setShowCtx] = useState(false);
  if (!a) return <Markdown>{m.content}</Markdown>;

  const answer = answerToText(a);
  const promptAndAnswer = `${question ? `Prompt:\n${question}\n\n` : ""}Answer:\n${answer}`;

  return (
    <div className="space-y-4" data-testid="assistant-answer">
      <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</h4><p className="text-sm">{a.summary}</p></div>
      {a.explanation && <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detailed explanation</h4><Markdown>{a.explanation}</Markdown></div>}
      {a.relevantObjects.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relevant database objects</h4>
          <ul className="space-y-1 text-sm">{a.relevantObjects.map((o) => {
            const v = m.verified?.find((x) => x.fullName.toLowerCase() === o.name.toLowerCase() || x.fullName.toLowerCase().endsWith(`.${o.name.toLowerCase()}`));
            return <li key={o.name}>{v ? <Link className="font-medium text-primary hover:underline" href={objectHref(v.type, v.id, o.name)}>{o.name}</Link> : <span className="font-medium">{o.name}</span>}{o.type && <span className="ml-1.5 text-xs text-muted-foreground">({o.type})</span>}{o.reason && <span className="text-muted-foreground"> — {o.reason}</span>}</li>;
          })}</ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2"><List title="Tables referenced" items={a.tablesReferenced} /><List title="Columns referenced" items={a.columnsReferenced} /></div>
      <List title="Dependencies" items={a.dependencies} />
      <List title="Potential risks" items={a.risks} />
      <List title="Recommendations" items={a.recommendations} />
      <List title="Assumptions & uncertain interpretations" items={a.assumptions} />
      {m.verified && m.verified.length > 0 && (
        <div data-testid="source-refs">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source references (verified against metadata)</h4>
          <div className="flex flex-wrap gap-1.5">{m.verified.map((o) => <Link key={o.id} href={objectHref(o.type, o.id, o.fullName.split(".").pop())}><Badge variant="info" className="hover:opacity-80">{o.fullName}</Badge></Link>)}</div>
        </div>
      )}
      {m.unverified && m.unverified.length > 0 && (
        <p className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"><Info className="mt-0.5 size-3.5 shrink-0" />The model mentioned names that do not exist in the retrieved metadata and they were removed from the lists above: {m.unverified.join(", ")}.</p>
      )}
      <div className="border-t pt-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setShowCtx((s) => !s)}>AI-generated · {m.provider} / {m.model} · context details <ChevronDown className={cn("size-3 transition-transform", showCtx && "rotate-180")} /></button>
          <div className="flex items-center gap-3">
            <CopyButton label="Copy answer" text={answer} testId="copy-answer" />
            <CopyButton label="Copy prompt & answer" text={promptAndAnswer} testId="copy-prompt-answer" />
          </div>
        </div>
        {showCtx && (
          <div className="mt-2 space-y-1">
            <p>Only these objects were retrieved from the metadata store and sent to the model{m.truncated ? " (context was truncated to stay within limits)" : ""}:</p>
            <ul className="list-disc pl-5">{m.reasons?.map((r) => <li key={r.fullName}><span className="font-medium">{r.fullName}</span> — {r.reason}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function DbChat({ projectId, versionId, versionLabel, initialConversationId, initialMessages, autoQuestion, focusObjectId }: { projectId: string; versionId: string; versionLabel: string; initialConversationId: string | null; initialMessages: ChatMessage[]; autoQuestion?: string; focusObjectId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoRan = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, loading]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (q.length < 2 || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: q }]);
    setLoading(true);
    const res = await postJson<ChatResp>("/api/ai/chat", { question: q, projectId, versionId, conversationId, focusObjectId: focusObjectId ?? null });
    setLoading(false);
    if (!res.ok) return setError(res.error);
    const d = res.data;
    setConversationId(d.conversationId);
    setMessages((m) => [...m, { id: d.messageId ?? `a-${Date.now()}`, role: "assistant", content: d.answer.summary, answer: d.answer, verified: d.verifiedObjects, unverified: d.unverifiedNames, reasons: d.matchReasons, truncated: d.contextTruncated, model: d.model, provider: d.provider }]);
  }, [conversationId, focusObjectId, loading, projectId, versionId]);

  useEffect(() => {
    if (autoQuestion && !autoRan.current && initialMessages.length === 0) {
      autoRan.current = true;
      void ask(autoQuestion);
    }
  }, [autoQuestion, ask, initialMessages.length]);

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[480px] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <p className="text-sm"><span className="text-muted-foreground">Grounded in </span><span className="font-medium">{versionLabel}</span></p>
        <Button size="sm" variant="ghost" onClick={() => { setMessages([]); setConversationId(null); setError(null); }}><Plus className="size-4" /> New conversation</Button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <Sparkles className="mx-auto mb-3 size-8 text-primary" />
            <h2 className="text-lg font-semibold">Ask anything about this database</h2>
            <p className="mt-1 text-sm text-muted-foreground">QueryPilot retrieves the relevant objects from your imported metadata, then asks the AI to explain them. It never sees the whole schema and cannot invent objects.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <button key={s} type="button" className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground" onClick={() => void ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {messages.map((m, i) => {
          // The prompt for an answer is the nearest preceding user message.
          const question = m.role === "assistant" ? messages.slice(0, i).reverse().find((x) => x.role === "user")?.content : undefined;
          return (
            <div key={m.id} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-4" /></span>}
              {m.role === "user" ? (
                <div className="flex max-w-[92%] flex-col items-end gap-1">
                  <div className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground"><p className="whitespace-pre-wrap">{m.content}</p></div>
                  <CopyButton label="Copy prompt" text={m.content} testId="copy-prompt" className="text-xs text-muted-foreground" />
                </div>
              ) : (
                <div className="surface w-full max-w-[92%] rounded-xl px-4 py-3 text-sm"><AssistantMessage m={m} question={question} /></div>
              )}
              {m.role === "user" && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary"><User className="size-4" /></span>}
            </div>
          );
        })}
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Retrieving metadata and thinking…</div>}
        {error && <AiErrorNotice error={error} />}
        <div ref={endRef} />
      </div>
      <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <div className="flex gap-2">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }} rows={2} maxLength={4000} placeholder="Ask about tables, procedures, dependencies, impact…  (Enter to send, Shift+Enter for a new line)" className="min-h-0 resize-none" aria-label="Your question" data-testid="chat-input" />
          <Button type="submit" size="icon-lg" disabled={loading || input.trim().length < 2} aria-label="Send" data-testid="chat-send"><Send className="size-4" /></Button>
        </div>
        <div className="mt-2"><ExternalAiNotice /></div>
      </form>
    </div>
  );
}
