import type { AiProviderId } from "@querypilot/shared-types";
import { AiError } from "./errors";
import type { HttpOptions } from "./http";
import {
  analyzeSqlPrompt, databaseAnswerPrompt, explainSqlPrompt, generateSqlPrompt, JSON_ONLY_SUFFIX,
  objectExplanationPrompt, optimizeSqlPrompt,
} from "./prompts";
import {
  DATABASE_ANSWER_SHAPE, DatabaseAnswerSchema, GENERATED_SQL_SHAPE, GeneratedSqlSchema, OBJECT_EXPLANATION_SHAPE,
  ObjectExplanationSchema, SQL_ANALYSIS_SHAPE, SQL_OPTIMIZATION_SHAPE, SqlAnalysisSupplementSchema, SqlOptimizationSchema,
} from "./schemas";
import type {
  AiProvider, AiStructuredResult, AiTextResult, ChatMessage, GenerateTextRequest, KeyValidation, ModelInfo, StructuredRequest,
} from "./types";

/** Pulls the first JSON object out of model output, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new AiError("bad_response", "The model did not return JSON.");
  }
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  http: HttpOptions;
}

/**
 * Providers only implement transport (`complete`, `validateApiKey`, `listModels`).
 * All task-specific behaviour (prompts, structured output, repair) lives here so that
 * providers stay interchangeable.
 */
export abstract class BaseAiProvider implements AiProvider {
  abstract readonly id: AiProviderId;
  readonly model: string;
  protected readonly apiKey: string;
  protected readonly http: HttpOptions;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.http = config.http;
  }

  protected abstract complete(request: GenerateTextRequest): Promise<AiTextResult>;
  abstract validateApiKey(): Promise<KeyValidation>;
  abstract listModels(): Promise<ModelInfo[]>;

  async generateText(request: GenerateTextRequest): Promise<AiTextResult> {
    return this.complete(request);
  }

  async generateStructuredOutput<T>(request: StructuredRequest<T>): Promise<AiStructuredResult<T>> {
    const { schema, schemaDescription, ...rest } = request;
    const messages: ChatMessage[] = [...rest.messages];
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && !last.content.includes("Return ONLY a single JSON object")) {
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\nJSON shape: ${schemaDescription}${JSON_ONLY_SUFFIX}` };
    }
    const first = await this.complete({ ...rest, messages, json: true, temperature: rest.temperature ?? 0.1 });
    const parsed = this.tryParse(first.text, schema);
    if (parsed.ok) return { data: parsed.data, rawText: first.text, model: first.model, provider: first.provider, usage: first.usage, latencyMs: first.latencyMs };

    // one repair attempt
    const repair = await this.complete({
      ...rest,
      json: true,
      temperature: 0,
      messages: [
        ...messages,
        { role: "assistant", content: first.text.slice(0, 6000) },
        { role: "user", content: `That response was not valid. Problem: ${parsed.error}\nReturn the corrected JSON object only.${JSON_ONLY_SUFFIX}` },
      ],
    });
    const second = this.tryParse(repair.text, schema);
    if (!second.ok) throw new AiError("bad_response", "The model response did not match the expected structure.", { cause: second.error });
    return {
      data: second.data,
      rawText: repair.text,
      model: repair.model,
      provider: repair.provider,
      usage: { inputTokens: (first.usage.inputTokens ?? 0) + (repair.usage.inputTokens ?? 0), outputTokens: (first.usage.outputTokens ?? 0) + (repair.usage.outputTokens ?? 0) },
      latencyMs: first.latencyMs + repair.latencyMs,
    };
  }

  private tryParse<T>(text: string, schema: StructuredRequest<T>["schema"]): { ok: true; data: T } | { ok: false; error: string } {
    try {
      const raw = extractJson(text);
      const res = schema.safeParse(raw);
      if (res.success) return { ok: true, data: res.data };
      return { ok: false, error: res.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "invalid JSON" };
    }
  }

  explainSQL(input: Parameters<AiProvider["explainSQL"]>[0]) {
    const p = explainSqlPrompt(input.dialect, input.sql, input.schemaContext);
    return this.generateText({ system: p.system, messages: [{ role: "user", content: p.user }], operation: "explain_sql", temperature: 0.2 });
  }

  explainDatabaseObject(input: Parameters<AiProvider["explainDatabaseObject"]>[0]) {
    const p = objectExplanationPrompt(input, OBJECT_EXPLANATION_SHAPE);
    return this.generateStructuredOutput({ system: p.system, messages: [{ role: "user", content: p.user }], schema: ObjectExplanationSchema, schemaDescription: OBJECT_EXPLANATION_SHAPE, operation: "explain_object" });
  }

  generateSQL(input: Parameters<AiProvider["generateSQL"]>[0]) {
    const p = generateSqlPrompt(input, GENERATED_SQL_SHAPE);
    return this.generateStructuredOutput({ system: p.system, messages: [{ role: "user", content: p.user }], schema: GeneratedSqlSchema, schemaDescription: GENERATED_SQL_SHAPE, operation: "generate_sql" });
  }

  analyzeSQL(input: Parameters<AiProvider["analyzeSQL"]>[0]) {
    const p = analyzeSqlPrompt(input, SQL_ANALYSIS_SHAPE);
    return this.generateStructuredOutput({ system: p.system, messages: [{ role: "user", content: p.user }], schema: SqlAnalysisSupplementSchema, schemaDescription: SQL_ANALYSIS_SHAPE, operation: "analyze_sql" });
  }

  optimizeSQL(input: Parameters<AiProvider["optimizeSQL"]>[0]) {
    const p = optimizeSqlPrompt(input, SQL_OPTIMIZATION_SHAPE);
    return this.generateStructuredOutput({ system: p.system, messages: [{ role: "user", content: p.user }], schema: SqlOptimizationSchema, schemaDescription: SQL_OPTIMIZATION_SHAPE, operation: "optimize_sql" });
  }

  answerDatabaseQuestion(input: Parameters<AiProvider["answerDatabaseQuestion"]>[0]) {
    const p = databaseAnswerPrompt(input.question, input.contextText, DATABASE_ANSWER_SHAPE);
    // Bounded history: keep the last few turns only, so context never grows with conversation length.
    const history = input.history.slice(-6).map((m) => ({ ...m, content: m.content.slice(0, 2000) }));
    return this.generateStructuredOutput({
      system: p.system,
      messages: [...history, { role: "user", content: p.user }],
      schema: DatabaseAnswerSchema,
      schemaDescription: DATABASE_ANSWER_SHAPE,
      operation: "database_chat",
    });
  }
}
