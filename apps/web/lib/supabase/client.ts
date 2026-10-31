import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/env";

/** Browser client: anon key + the user's session only. RLS protects every row. */
export function createClient() {
  const cfg = getPublicSupabaseConfig();
  if (!cfg) throw new Error("Supabase is not configured");
  return createBrowserClient(cfg.url, cfg.anonKey);
}
