import { z } from "zod";

export const PLATFORMS = ["sqlserver", "azure_sql_database", "azure_sql_managed_instance", "postgresql", "mysql", "sqlite", "other"] as const;
export const DIALECTS = ["tsql", "postgresql", "mysql", "sqlite"] as const;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // matches the Supabase Storage bucket limit
export const ALLOWED_EXTENSIONS = [".dacpac", ".sql"] as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), "Use upper case, lower case and a number");

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const registerSchema = z.object({ displayName: trimmed(1, 80), email: emailSchema, password: passwordSchema });
export const resetRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ password: passwordSchema });

export const projectInputSchema = z.object({
  name: trimmed(1, 120),
  description: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  platform: z.enum(PLATFORMS),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const uuidSchema = z.uuid();

/** Display name for a schema version. Empty input clears the label. */
export const versionLabelSchema = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v.length === 0 ? null : v));

export const scriptInputSchema = z.object({
  name: trimmed(1, 200),
  description: z.string().trim().max(2000).optional().nullable(),
  content: z.string().max(2_000_000),
  dialect: z.enum(DIALECTS),
  tags: z.array(trimmed(1, 40)).max(20).default([]),
  category: z.string().trim().max(60).optional().nullable(),
  projectId: uuidSchema.optional().nullable(),
  isFavorite: z.boolean().default(false),
});
export type ScriptInput = z.infer<typeof scriptInputSchema>;

export const sqlTextSchema = z.object({
  sql: z.string().min(1, "Enter some SQL").max(500_000),
  dialect: z.enum(DIALECTS).default("tsql"),
  projectId: uuidSchema.optional().nullable(),
  versionId: uuidSchema.optional().nullable(),
});

export const generateSqlSchema = z.object({
  request: trimmed(3, 4000),
  dialect: z.enum(DIALECTS).default("tsql"),
  projectId: uuidSchema.optional().nullable(),
  versionId: uuidSchema.optional().nullable(),
  existingSql: z.string().max(200_000).optional(),
});

export const chatSchema = z.object({
  question: trimmed(2, 4000),
  projectId: uuidSchema,
  versionId: uuidSchema,
  conversationId: uuidSchema.optional().nullable(),
  focusObjectId: uuidSchema.optional().nullable(),
});

export const explainObjectSchema = z.object({ objectId: uuidSchema });

export const uploadRequestSchema = z.object({
  projectId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES, `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`),
  label: z.string().trim().max(120).optional(),
});

export const completeUploadSchema = z.object({
  projectId: uuidSchema,
  storagePath: z.string().min(1).max(600),
  fileName: z.string().trim().min(1).max(255),
  label: z.string().trim().max(120).optional(),
});

export const compareSchema = z.object({
  projectId: uuidSchema,
  baseVersionId: uuidSchema,
  targetVersionId: uuidSchema,
  includeDestructive: z.boolean().default(false),
});

export const aiSettingsSchema = z.object({
  provider: z.enum(["gemini", "openrouter", "groq"]),
  model: z.string().trim().min(1).max(200),
  externalConsent: z.boolean(),
});

export const apiKeySchema = z.object({
  provider: z.enum(["gemini", "openrouter", "groq"]),
  apiKey: z.string().trim().min(8, "That does not look like an API key").max(400),
});

/** Strip path components and control characters, keep a conservative character set. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}

export function fileExtension(name: string): (typeof ALLOWED_EXTENSIONS)[number] | null {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.find((e) => lower.endsWith(e)) ?? null;
}

export type FileKind = "dacpac" | "sql";

export interface SniffResult {
  ok: boolean;
  kind: FileKind | null;
  error?: string;
}

/**
 * Content-based validation of the first bytes of an upload. Extensions are never trusted:
 * a .dacpac must be a ZIP container, a .sql must be text (no NUL bytes, no known binary magic).
 */
export function sniffFile(fileName: string, head: Uint8Array): SniffResult {
  const ext = fileExtension(fileName);
  if (!ext) return { ok: false, kind: null, error: "Only .dacpac and .sql files are supported." };
  if (head.length === 0) return { ok: false, kind: null, error: "The file is empty." };
  const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (ext === ".dacpac") {
    return isZip ? { ok: true, kind: "dacpac" } : { ok: false, kind: null, error: "This file is not a valid DACPAC (a DACPAC is a ZIP archive)." };
  }
  if (isZip) return { ok: false, kind: null, error: "This looks like a ZIP/DACPAC file but has a .sql extension." };
  const magic = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4e, 0x47], [0x1f, 0x8b]];
  if (magic.some((m) => m.every((b, i) => head[i] === b))) return { ok: false, kind: null, error: "This file is binary, not SQL text." };
  const bom16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!bom16) {
    const sample = head.subarray(0, Math.min(head.length, 8192));
    if (sample.includes(0)) return { ok: false, kind: null, error: "This file contains binary data, not SQL text." };
  }
  return { ok: true, kind: "sql" };
}
