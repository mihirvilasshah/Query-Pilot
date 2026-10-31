import type { AiProviderId } from "@querypilot/shared-types";
import type { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateTextRequest {
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider for JSON output when it supports a native JSON mode. */
  json?: boolean;
  /** Label used for request history (e.g. "explain_sql"). */
  operation?: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiTextResult {
  text: string;
  model: string;
  provider: AiProviderId;
  usage: AiUsage;
  latencyMs: number;
}

export interface StructuredRequest<T> extends Omit<GenerateTextRequest, "json"> {
  schema: z.ZodType<T>;
  /** Plain-English/JSON-shape description appended to the prompt so the model knows the exact output contract. */
  schemaDescription: string;
}

export interface AiStructuredResult<T> {
  data: T;
  rawText: string;
  model: string;
  provider: AiProviderId;
  usage: AiUsage;
  latencyMs: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** true = known free; false = known paid; null = unknown (e.g. Gemini free-tier depends on the API key's project). */
  free: boolean | null;
  contextLength?: number;
}

export interface KeyValidation {
  valid: boolean;
  message: string;
  /** Usage / quota facts, only when the provider reports them. Never fabricated. */
  details?: Record<string, string | number | boolean | null>;
}

export interface SqlContext {
  dialect: "tsql" | "postgresql" | "mysql" | "sqlite";
  /** Deterministic, already-minimised schema metadata retrieved for this request. */
  schemaContext?: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  generateText(request: GenerateTextRequest): Promise<AiTextResult>;
  generateStructuredOutput<T>(request: StructuredRequest<T>): Promise<AiStructuredResult<T>>;
  explainSQL(input: { sql: string } & SqlContext): Promise<AiTextResult>;
  explainDatabaseObject(input: { objectType: string; fullName: string; definition: string | null; contextText: string }): Promise<AiStructuredResult<import("./schemas").ObjectExplanation>>;
  generateSQL(input: { request: string; existingSql?: string } & SqlContext): Promise<AiStructuredResult<import("./schemas").GeneratedSql>>;
  analyzeSQL(input: { sql: string; staticFindings: string } & SqlContext): Promise<AiStructuredResult<import("./schemas").SqlAnalysisSupplement>>;
  optimizeSQL(input: { sql: string } & SqlContext): Promise<AiStructuredResult<import("./schemas").SqlOptimization>>;
  answerDatabaseQuestion(input: { question: string; contextText: string; history: import("./types").ChatMessage[] }): Promise<AiStructuredResult<import("./schemas").DatabaseAnswer>>;
  validateApiKey(): Promise<KeyValidation>;
  listModels(): Promise<ModelInfo[]>;
}
