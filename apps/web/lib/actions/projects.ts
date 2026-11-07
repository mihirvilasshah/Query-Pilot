"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { projectInputSchema, uuidSchema, versionLabelSchema } from "@querypilot/shared-validation";
import { fieldErrors, type FormState } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_COOKIE } from "@/lib/data/queries";

async function setProjectCookie(id: string) {
  (await cookies()).set(PROJECT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function selectProjectAction(projectId: string): Promise<void> {
  if (!uuidSchema.safeParse(projectId).success) return;
  const supabase = await createClient();
  // RLS guarantees only the user's own projects are visible; this verifies ownership before trusting the id.
  const { data } = await supabase.from("database_projects").select("id").eq("id", projectId).maybeSingle();
  if (!data) return;
  await setProjectCookie(projectId);
  revalidatePath("/", "layout");
}

export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = projectInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    platform: formData.get("platform"),
  });
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("database_projects").insert({ ...parsed.data, owner_id: user.id }).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: "You already have a project with that name.", fieldErrors: { name: "Name already used" } };
    return { error: "Could not create the project. Please try again." };
  }
  await supabase.from("audit_logs").insert({ owner_id: user.id, action: "project.created", entity_type: "database_project", entity_id: data.id });
  await setProjectCookie(data.id);
  revalidatePath("/", "layout");
  redirect(`/projects/${data.id}`);
}

export async function updateProjectAction(projectId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!uuidSchema.safeParse(projectId).success) return { error: "Invalid project." };
  const parsed = projectInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    platform: formData.get("platform"),
  });
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { error } = await supabase.from("database_projects").update(parsed.data).eq("id", projectId);
  if (error) {
    if (error.code === "23505") return { error: "You already have a project with that name.", fieldErrors: { name: "Name already used" } };
    return { error: "Could not save changes." };
  }
  revalidatePath("/", "layout");
  return { success: "Project saved." };
}

export async function updateVersionLabelAction(versionId: string, formData: FormData): Promise<FormState> {
  if (!uuidSchema.safeParse(versionId).success) return { error: "Invalid version." };
  const parsed = versionLabelSchema.safeParse(formData.get("label") ?? "");
  if (!parsed.success) return { error: "Use at most 120 characters.", fieldErrors: { label: "Use at most 120 characters." } };
  const supabase = await createClient();
  const { error } = await supabase.from("database_versions").update({ label: parsed.data }).eq("id", versionId);
  if (error) return { error: "Could not save the version label." };
  revalidatePath("/", "layout");
  return { success: parsed.data ? "Version label saved." : "Version label cleared." };
}

export async function deleteProjectAction(projectId: string): Promise<{ error?: string }> {
  if (!uuidSchema.safeParse(projectId).success) return { error: "Invalid project." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Remove uploaded files first (secure deletion); DB rows cascade afterwards.
  const { data: versions } = await supabase.from("database_versions").select("storage_path").eq("project_id", projectId);
  const paths = (versions ?? []).map((v) => v.storage_path as string | null).filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from("schema-uploads").remove(paths);

  const { error } = await supabase.from("database_projects").delete().eq("id", projectId);
  if (error) return { error: "Could not delete the project." };
  await supabase.from("audit_logs").insert({ owner_id: user.id, action: "project.deleted", entity_type: "database_project", entity_id: projectId });
  const store = await cookies();
  if (store.get(PROJECT_COOKIE)?.value === projectId) store.delete(PROJECT_COOKIE);
  revalidatePath("/", "layout");
  return {};
}
