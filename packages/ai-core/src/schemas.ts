import { z } from "zod";

const list = z.array(z.string()).default([]);

export const ObjectExplanationSchema = z.object({
  summary: z.string(),
  purpose: z.string().default(""),
  parameters: z.array(z.object({ name: z.string(), explanation: z.string() })).default([]),
  executionFlow: list,
  tablesRead: list,
  tablesModified: list,
  joins: list,
  filters: list,
  conditions: list,
  temporaryTables: list,
  transactions: z.string().default(""),
  nestedCalls: list,
  risks: list,
  assumptions: list,
});
export type ObjectExplanation = z.infer<typeof ObjectExplanationSchema>;

export const GeneratedSqlSchema = z.object({
  sql: z.string().default(""),
  explanation: z.string().default(""),
  assumptions: list,
  /** When non-empty the model needs more information and `sql` may be empty. */
  missingInformation: list,
  risks: list,
  previewSql: z.string().default(""),
  transactionAdvice: z.string().default(""),
});
export type GeneratedSql = z.infer<typeof GeneratedSqlSchema>;

export const SqlAnalysisSupplementSchema = z.object({
  summary: z.string(),
  additionalConcerns: z.array(z.object({ severity: z.enum(["critical", "high", "medium", "low", "informational"]), title: z.string(), detail: z.string() })).default([]),
  saferAlternatives: list,
  notes: list,
});
export type SqlAnalysisSupplement = z.infer<typeof SqlAnalysisSupplementSchema>;

export const SqlOptimizationSchema = z.object({
  optimizedSql: z.string().default(""),
  changes: list,
  caveats: list,
  indexSuggestions: list,
});
export type SqlOptimization = z.infer<typeof SqlOptimizationSchema>;

export const DatabaseAnswerSchema = z.object({
  summary: z.string(),
  explanation: z.string().default(""),
  relevantObjects: z.array(z.object({ name: z.string(), type: z.string().default(""), reason: z.string().default("") })).default([]),
  tablesReferenced: list,
  columnsReferenced: list,
  dependencies: list,
  risks: list,
  recommendations: list,
  assumptions: list,
});
export type DatabaseAnswer = z.infer<typeof DatabaseAnswerSchema>;

export const OBJECT_EXPLANATION_SHAPE = `{"summary": string, "purpose": string, "parameters": [{"name": string, "explanation": string}], "executionFlow": string[], "tablesRead": string[], "tablesModified": string[], "joins": string[], "filters": string[], "conditions": string[], "temporaryTables": string[], "transactions": string, "nestedCalls": string[], "risks": string[], "assumptions": string[]}`;
export const GENERATED_SQL_SHAPE = `{"sql": string, "explanation": string, "assumptions": string[], "missingInformation": string[], "risks": string[], "previewSql": string, "transactionAdvice": string}`;
export const SQL_ANALYSIS_SHAPE = `{"summary": string, "additionalConcerns": [{"severity": "critical"|"high"|"medium"|"low"|"informational", "title": string, "detail": string}], "saferAlternatives": string[], "notes": string[]}`;
export const SQL_OPTIMIZATION_SHAPE = `{"optimizedSql": string, "changes": string[], "caveats": string[], "indexSuggestions": string[]}`;
export const DATABASE_ANSWER_SHAPE = `{"summary": string, "explanation": string, "relevantObjects": [{"name": string, "type": string, "reason": string}], "tablesReferenced": string[], "columnsReferenced": string[], "dependencies": string[], "risks": string[], "recommendations": string[], "assumptions": string[]}`;
