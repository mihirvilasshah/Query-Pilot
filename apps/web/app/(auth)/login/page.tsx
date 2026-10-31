import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/auth-forms";
import { safeNext } from "@/lib/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to your QueryPilot workspace.</p>
      {sp.error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {sp.error === "auth" ? "That link is invalid or has expired. Please try again." : "Something went wrong. Please try again."}
        </p>
      )}
      <LoginForm next={safeNext(sp.next, "")} />
    </>
  );
}
