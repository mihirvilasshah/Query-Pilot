import { KeyRound } from "lucide-react";
import { Logo } from "@/components/common/logo";

export const metadata = { title: "Setup required" };

const VARS = [
  ["NEXT_PUBLIC_SUPABASE_URL", "Supabase project URL"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase anon (publishable) key"],
];

export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6">
      <Logo />
      <div className="surface p-6">
        <div className="mb-3 flex items-center gap-2 text-warning">
          <KeyRound className="size-5" />
          <h1 className="text-lg font-semibold text-foreground">Supabase is not configured</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          QueryPilot needs a Supabase project for authentication and storage. Copy <code className="rounded bg-muted px-1">.env.example</code> to{" "}
          <code className="rounded bg-muted px-1">apps/web/.env.local</code>, fill in the values below and restart the server.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {VARS.map(([name, desc]) => (
            <li key={name} className="flex flex-col rounded-md border bg-muted/40 px-3 py-2">
              <code className="font-mono text-xs">{name}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          Then apply the SQL migrations in <code className="rounded bg-muted px-1">supabase/migrations</code>. See docs/LOCAL_DEVELOPMENT.md for the full walkthrough.
        </p>
      </div>
    </main>
  );
}
