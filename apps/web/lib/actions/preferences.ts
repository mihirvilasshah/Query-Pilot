"use server";

import { z } from "zod";
import { DIALECTS } from "@querypilot/shared-validation";
import type { FormState } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ displayName: z.string().trim().min(1).max(80) }).safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) return { error: "Enter a name (max 80 characters)." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", user.id);
  if (error) return { error: "Could not save your profile." };
  revalidatePath("/", "layout");
  return { success: "Profile saved." };
}

export async function updatePreferencesAction(dialect: string): Promise<{ error?: string }> {
  const parsed = z.enum(DIALECTS).safeParse(dialect);
  if (!parsed.success) return { error: "Unknown dialect." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase.from("user_preferences").update({ default_dialect: parsed.data }).eq("user_id", user.id);
  return error ? { error: "Could not save." } : {};
}
