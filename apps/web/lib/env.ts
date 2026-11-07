import { z } from "zod";

/**
 * Environment access is centralised here. Public values are read lazily so the app can still render
 * a helpful "not configured" screen (instead of crashing) when Supabase variables are missing.
 */
const publicSchema = z.object({
  url: z.url(),
  anonKey: z.string().min(20),
});

export interface PublicSupabaseConfig {
  url: string;
  anonKey: string;
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const parsed = publicSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return parsed.success ? parsed.data : null;
}

export const isSupabaseConfigured = (): boolean => getPublicSupabaseConfig() !== null;

export function getServiceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, "");
}

export type AiProviderIdEnv = "gemini" | "openrouter" | "groq";

export interface ServerAiEnv {
  defaultProvider: AiProviderIdEnv;
  gemini: { apiKey: string | null; model: string };
  openrouter: { apiKey: string | null; model: string };
  groq: { apiKey: string | null; model: string };
  allowPaidModels: boolean;
}

/** Server-side AI defaults. Keys here are never sent to the browser. */
export function getServerAiEnv(): ServerAiEnv {
  const p = process.env.AI_DEFAULT_PROVIDER;
  return {
    defaultProvider: p === "openrouter" ? "openrouter" : p === "groq" ? "groq" : "gemini",
    gemini: { apiKey: process.env.GEMINI_API_KEY || null, model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
    openrouter: { apiKey: process.env.OPENROUTER_API_KEY || null, model: process.env.OPENROUTER_MODEL || "openrouter/free" },
    groq: { apiKey: process.env.GROQ_API_KEY || null, model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
    allowPaidModels: process.env.AI_ALLOW_PAID_MODELS === "true",
  };
}

export function getCredentialEncryptionKey(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}
