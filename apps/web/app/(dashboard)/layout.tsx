import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { getCurrentProject, getProjects } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import type { NotificationJob } from "@/components/layout/notifications";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  const [projects, current, jobsRes, profileRes] = await Promise.all([
    getProjects(),
    getCurrentProject(),
    supabase.from("database_import_jobs").select("id,file_name,status,error_message,created_at,updated_at").order("created_at", { ascending: false }).limit(8),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const displayName = (profileRes.data?.display_name as string | null) ?? user.email?.split("@")[0] ?? "User";

  return (
    <AppShell
      user={{ email: user.email ?? "", displayName }}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      currentProjectId={current?.id ?? null}
      jobs={(jobsRes.data ?? []) as NotificationJob[]}
    >
      {children}
    </AppShell>
  );
}
