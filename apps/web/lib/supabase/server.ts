import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/lib/env";

/** Server client bound to the request's cookies, so every query runs with the caller's RLS identity. */
export async function createClient() {
  // Reading cookies first marks every caller as request-time (dynamic), even when env is missing at build time.
  const cookieStore = await cookies();
  const cfg = getPublicSupabaseConfig();
  if (!cfg) throw new Error("Supabase is not configured");
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
