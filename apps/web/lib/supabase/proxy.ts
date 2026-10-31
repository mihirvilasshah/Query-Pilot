import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/auth", "/setup"];
const isPublic = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/** Refreshes the Supabase session cookie and enforces route protection. Used by proxy.ts. */
export async function updateSession(request: NextRequest) {
  const cfg = getPublicSupabaseConfig();
  const path = request.nextUrl.pathname;

  if (!cfg) {
    if (path === "/setup" || path.startsWith("/api/health")) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the JWT with the Auth server; never trust getSession() on the server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(path) && !path.startsWith("/api/")) {
    const url = new URL("/login", request.url);
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/register" || path === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (!user && path === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}
