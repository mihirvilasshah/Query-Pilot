import { NextResponse } from "next/server";
import { verifyAnswerReferences } from "@querypilot/ai-core";
import { chatSchema } from "@querypilot/shared-validation";
import { aiErrorResponse, getAiProvider, trackedAi } from "@/lib/ai/config";
import { buildSchemaContext, recordHistory } from "@/lib/ai/context";
import { apiError, authenticate, isResponse, parseBody, tooManyRequests, withinRateLimit } from "@/lib/api";
import type { MessageRow } from "@/lib/data/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await authenticate();
  if (isResponse(ctx)) return ctx;
  const body = await parseBody(request, chatSchema);
  if (isResponse(body)) return body;
  if (!(await withinRateLimit(ctx.supabase, "ai", 30, 60))) return tooManyRequests();

  // project / version must be the caller's own (RLS) and consistent with each other
  const { data: version } = await ctx.supabase.from("database_versions").select("id,project_id").eq("id", body.versionId).maybeSingle();
  if (!version || version.project_id !== body.projectId) return apiError(404, "not_found", "Schema version not found.");

  const ai = await getAiProvider(ctx);
  if (isResponse(ai)) return ai;

  try {
    const context = await buildSchemaContext(ctx, body.versionId, body.question, body.focusObjectId ? [body.focusObjectId] : [], 12000);
    if (!context) return apiError(409, "version_not_ready", "This schema version has not finished importing.");

    let conversationId = body.conversationId ?? null;
    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (conversationId) {
      const { data: conv } = await ctx.supabase.from("ai_conversations").select("id").eq("id", conversationId).maybeSingle();
      if (!conv) return apiError(404, "not_found", "Conversation not found.");
      const { data: msgs } = await ctx.supabase.from("ai_messages").select("role,content").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(6);
      history = ((msgs ?? []) as Pick<MessageRow, "role" | "content">[]).reverse().filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    }

    const result = await trackedAi(ctx, ai, "database_chat", () => ai.provider.answerDatabaseQuestion({ question: body.question, contextText: context.contextText, history }));
    const verified = verifyAnswerReferences(result.data, context.objects);

    if (!conversationId) {
      const { data: conv } = await ctx.supabase.from("ai_conversations").insert({ owner_id: ctx.user.id, project_id: body.projectId, version_id: body.versionId, title: body.question.slice(0, 80) }).select("id").single();
      conversationId = conv?.id ?? null;
      if (conversationId) await recordHistory(ctx, { operation: "ai_conversation", title: body.question.slice(0, 100), projectId: body.projectId, refId: conversationId });
    }
    let assistantMessageId: string | null = null;
    if (conversationId) {
      await ctx.supabase.from("ai_messages").insert({ owner_id: ctx.user.id, conversation_id: conversationId, role: "user", content: body.question });
      const { data: am } = await ctx.supabase.from("ai_messages").insert({
        owner_id: ctx.user.id, conversation_id: conversationId, role: "assistant", content: verified.answer.summary, structured: verified.answer, object_refs: verified.verifiedObjects,
        provider: result.provider, model: result.model,
      }).select("id").single();
      assistantMessageId = am?.id ?? null;
      await ctx.supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    }

    return NextResponse.json({
      conversationId, messageId: assistantMessageId, answer: verified.answer, verifiedObjects: verified.verifiedObjects, unverifiedNames: verified.unverifiedNames,
      matchReasons: context.matchReasons, contextTruncated: context.truncated, model: result.model, provider: result.provider,
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
