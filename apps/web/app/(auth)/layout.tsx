import { Database, GitBranch, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/common/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const POINTS = [
  { icon: Database, text: "Import DACPAC or DDL scripts and explore every table, view and procedure." },
  { icon: GitBranch, text: "Trace dependencies and compare schema versions with confidence levels." },
  { icon: Sparkles, text: "AI explanations grounded in your actual metadata - never invented objects." },
  { icon: ShieldCheck, text: "Schema-only, private by default. Uploaded SQL is never executed." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between border-r bg-sidebar p-10 lg:flex">
        <Logo />
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Understand Your Database.</h2>
          <p className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-muted-foreground">Decode Your SQL.</p>
          <p className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-muted-foreground">Make Smarter Engineering Decisions.</p>
          <ul className="mt-10 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-3.5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Schema intelligence · Release 1</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Link href="/" className="lg:hidden">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
