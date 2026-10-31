import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, getServiceRoleKey } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so it must only be used in server code for operations that
 * cannot be expressed with the user's own session (currently: encrypted AI credentials), and every
 * call site must scope its query by the already-authenticated user id.
 */
export function createAdminClient() {
  const cfg = getPublicSupabaseConfig();
  const key = getServiceRoleKey();
  if (!cfg || !key) return null;
  return createClient(cfg.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
